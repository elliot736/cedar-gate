// ── Rate Limiting Strategies ─────────────────────────────────────────
// Ported from multiverse with minor adaptations for cedar-gate.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
  limit: number;
}

export interface RateLimiter {
  consume(key: string, tokens?: number): RateLimitResult;
  reset(key: string): void;
  destroy(): void;
}

// ── Token Bucket ────────────────────────────────────────────────────

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number;
}

export class TokenBucketLimiter implements RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  private readonly config: TokenBucketConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: TokenBucketConfig) {
    if (config.capacity <= 0) throw new Error("Token bucket capacity must be positive");
    if (config.refillRate <= 0) throw new Error("Token bucket refill rate must be positive");
    this.config = config;

    this.cleanupTimer = setInterval(() => this.cleanupStale(), 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  consume(key: string, tokens: number = 1): RateLimitResult {
    const bucket = this.getOrCreateBucket(key);
    return bucket.consume(tokens);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private getOrCreateBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.config.capacity, this.config.refillRate);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private cleanupStale(): void {
    const now = Date.now();
    const maxIdleMs = (this.config.capacity / this.config.refillRate) * 1000 * 2;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastAccess > maxIdleMs) {
        this.buckets.delete(key);
      }
    }
  }
}

class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private lastRefill: number;
  public lastAccess: number;

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.lastAccess = Date.now();
  }

  consume(requested: number): RateLimitResult {
    this.refill();
    this.lastAccess = Date.now();

    if (this.tokens >= requested) {
      this.tokens -= requested;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        limit: this.capacity,
      };
    }

    const deficit = requested - this.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillRate) * 1000);

    return {
      allowed: false,
      remaining: Math.floor(this.tokens),
      retryAfterMs,
      limit: this.capacity,
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

// ── Sliding Window ──────────────────────────────────────────────────

export interface SlidingWindowConfig {
  windowMs: number;
  maxRequests: number;
}

export class SlidingWindowLimiter implements RateLimiter {
  private windows = new Map<string, SlidingWindowState>();
  private readonly config: SlidingWindowConfig;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SlidingWindowConfig) {
    if (config.windowMs <= 0) throw new Error("Sliding window duration must be positive");
    if (config.maxRequests <= 0) throw new Error("Sliding window max requests must be positive");
    this.config = config;

    this.cleanupTimer = setInterval(() => this.cleanupStale(), 60_000);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  consume(key: string, tokens: number = 1): RateLimitResult {
    const state = this.getOrCreateState(key);
    const now = Date.now();
    const windowStart = this.getWindowStart(now);

    if (windowStart !== state.currentWindowStart) {
      if (windowStart - state.currentWindowStart >= this.config.windowMs * 2) {
        state.previousCount = 0;
        state.currentCount = 0;
      } else {
        state.previousCount = state.currentCount;
        state.currentCount = 0;
      }
      state.currentWindowStart = windowStart;
    }

    const elapsed = now - windowStart;
    const weight = 1 - elapsed / this.config.windowMs;
    const approximateCount =
      state.currentCount + Math.floor(state.previousCount * weight);

    if (approximateCount + tokens > this.config.maxRequests) {
      const remaining = this.config.maxRequests - approximateCount;
      const retryAfterMs =
        remaining < 0
          ? Math.ceil(this.config.windowMs - elapsed)
          : Math.ceil(
              ((this.config.windowMs - elapsed) * (tokens - remaining)) /
                (state.previousCount * weight || 1),
            );

      return {
        allowed: false,
        remaining: Math.max(0, this.config.maxRequests - approximateCount),
        retryAfterMs: Math.max(1, Math.min(retryAfterMs, this.config.windowMs)),
        limit: this.config.maxRequests,
      };
    }

    state.currentCount += tokens;

    return {
      allowed: true,
      remaining: Math.max(
        0,
        this.config.maxRequests - approximateCount - tokens,
      ),
      limit: this.config.maxRequests,
    };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private getOrCreateState(key: string): SlidingWindowState {
    let state = this.windows.get(key);
    if (!state) {
      state = {
        currentWindowStart: this.getWindowStart(Date.now()),
        currentCount: 0,
        previousCount: 0,
      };
      this.windows.set(key, state);
    }
    return state;
  }

  private getWindowStart(now: number): number {
    return Math.floor(now / this.config.windowMs) * this.config.windowMs;
  }

  private cleanupStale(): void {
    const now = Date.now();
    const staleThreshold = now - this.config.windowMs * 3;
    for (const [key, state] of this.windows) {
      if (state.currentWindowStart < staleThreshold) {
        this.windows.delete(key);
      }
    }
  }
}

interface SlidingWindowState {
  currentWindowStart: number;
  currentCount: number;
  previousCount: number;
}
