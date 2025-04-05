// ── Request Tracing ─────────────────────────────────────────────────

let counter = 0;

/**
 * Generate a unique request ID.
 * Uses a timestamp + counter format for sortability.
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const count = (counter++).toString(36).padStart(4, "0");
  const random = Math.random().toString(36).slice(2, 6);
  return `${timestamp}-${count}-${random}`;
}

/**
 * Calculate request duration in seconds from a high-resolution start time.
 */
export function durationSeconds(startTime: bigint): number {
  const elapsed = process.hrtime.bigint() - startTime;
  return Number(elapsed) / 1e9;
}
