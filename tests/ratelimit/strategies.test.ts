import { describe, it, expect, afterEach } from "vitest";
import { TokenBucketLimiter, SlidingWindowLimiter } from "../../src/ratelimit/strategies.js";

describe("TokenBucketLimiter", () => {
  let limiter: TokenBucketLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  it("allows requests up to capacity", () => {
    limiter = new TokenBucketLimiter({ capacity: 3, refillRate: 1 });
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key1").allowed).toBe(false);
  });

  it("tracks remaining tokens", () => {
    limiter = new TokenBucketLimiter({ capacity: 5, refillRate: 1 });
    const r1 = limiter.consume("key1");
    expect(r1.remaining).toBe(4);
    expect(r1.limit).toBe(5);
  });

  it("returns retryAfterMs when rate limited", () => {
    limiter = new TokenBucketLimiter({ capacity: 1, refillRate: 1 });
    limiter.consume("key1");
    const result = limiter.consume("key1");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates keys", () => {
    limiter = new TokenBucketLimiter({ capacity: 1, refillRate: 1 });
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key2").allowed).toBe(true);
  });

  it("resets a key", () => {
    limiter = new TokenBucketLimiter({ capacity: 1, refillRate: 1 });
    limiter.consume("key1");
    expect(limiter.consume("key1").allowed).toBe(false);
    limiter.reset("key1");
    expect(limiter.consume("key1").allowed).toBe(true);
  });

  it("throws on invalid config", () => {
    expect(() => new TokenBucketLimiter({ capacity: 0, refillRate: 1 })).toThrow();
    expect(() => new TokenBucketLimiter({ capacity: 1, refillRate: 0 })).toThrow();
  });
});

describe("SlidingWindowLimiter", () => {
  let limiter: SlidingWindowLimiter;

  afterEach(() => {
    limiter?.destroy();
  });

  it("allows requests up to maxRequests", () => {
    limiter = new SlidingWindowLimiter({ windowMs: 60000, maxRequests: 3 });
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key1").allowed).toBe(false);
  });

  it("tracks remaining requests", () => {
    limiter = new SlidingWindowLimiter({ windowMs: 60000, maxRequests: 5 });
    const r1 = limiter.consume("key1");
    expect(r1.remaining).toBe(4);
    expect(r1.limit).toBe(5);
  });

  it("isolates keys", () => {
    limiter = new SlidingWindowLimiter({ windowMs: 60000, maxRequests: 1 });
    expect(limiter.consume("key1").allowed).toBe(true);
    expect(limiter.consume("key2").allowed).toBe(true);
  });

  it("throws on invalid config", () => {
    expect(() => new SlidingWindowLimiter({ windowMs: 0, maxRequests: 1 })).toThrow();
    expect(() => new SlidingWindowLimiter({ windowMs: 60000, maxRequests: 0 })).toThrow();
  });
});
