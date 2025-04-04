// ── Limiter Registry ─────────────────────────────────────────────────

import {
  TokenBucketLimiter,
  SlidingWindowLimiter,
  type RateLimiter,
} from "./strategies.js";

export interface RateLimitTierConfig {
  strategy: "token-bucket" | "sliding-window";
  capacity: number;
  windowMs?: number;
  refillRate?: number;
}

/**
 * Caches RateLimiter instances by tier configuration.
 * Avoids creating a new limiter per request — limiters are shared
 * across requests that resolve to the same rate limit tier.
 */
export class LimiterRegistry {
  private limiters = new Map<string, RateLimiter>();

  /**
   * Get or create a RateLimiter for the given tier config.
   */
  get(config: RateLimitTierConfig): RateLimiter {
    const key = this.configKey(config);
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = this.createLimiter(config);
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  /**
   * Destroy all limiter instances and clear the registry.
   */
  destroy(): void {
    for (const limiter of this.limiters.values()) {
      limiter.destroy();
    }
    this.limiters.clear();
  }

  private createLimiter(config: RateLimitTierConfig): RateLimiter {
    switch (config.strategy) {
      case "token-bucket":
        return new TokenBucketLimiter({
          capacity: config.capacity,
          refillRate: config.refillRate ?? Math.ceil(config.capacity / 60),
        });
      case "sliding-window":
        return new SlidingWindowLimiter({
          maxRequests: config.capacity,
          windowMs: config.windowMs ?? 60_000,
        });
    }
  }

  private configKey(config: RateLimitTierConfig): string {
    return `${config.strategy}:${config.capacity}:${config.windowMs ?? 0}:${config.refillRate ?? 0}`;
  }
}
