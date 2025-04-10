import { describe, it, expect } from "vitest";
import { generateRequestId, durationSeconds } from "../../src/observability/tracing.js";

describe("generateRequestId", () => {
  it("returns a non-empty string", () => {
    const id = generateRequestId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("contains three parts separated by hyphens", () => {
    const id = generateRequestId();
    const parts = id.split("-");
    expect(parts).toHaveLength(3);
  });

  it("generates unique IDs across multiple calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateRequestId());
    }
    expect(ids.size).toBe(1000);
  });

  it("includes a sortable timestamp component", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    // First part is timestamp in base36 - later timestamps should be >= earlier ones
    const ts1 = id1.split("-")[0]!;
    const ts2 = id2.split("-")[0]!;
    expect(parseInt(ts2, 36)).toBeGreaterThanOrEqual(parseInt(ts1, 36));
  });

  it("has a monotonically increasing counter component", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    const counter1 = parseInt(id1.split("-")[1]!, 36);
    const counter2 = parseInt(id2.split("-")[1]!, 36);
    expect(counter2).toBeGreaterThan(counter1);
  });
});

describe("durationSeconds", () => {
  it("returns a positive number", () => {
    const start = process.hrtime.bigint();
    const duration = durationSeconds(start);
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("measures elapsed time in seconds", async () => {
    const start = process.hrtime.bigint();
    // Spin-wait for a tiny amount of time to ensure measurable duration
    const waitUntil = start + BigInt(5_000_000); // 5ms in nanoseconds
    while (process.hrtime.bigint() < waitUntil) {
      // busy wait
    }
    const duration = durationSeconds(start);
    expect(duration).toBeGreaterThanOrEqual(0.004);
    expect(duration).toBeLessThan(1);
  });

  it("returns value in seconds (not milliseconds or nanoseconds)", () => {
    const start = process.hrtime.bigint();
    const duration = durationSeconds(start);
    // Should be a very small fraction of a second, not thousands
    expect(duration).toBeLessThan(1);
  });
});
