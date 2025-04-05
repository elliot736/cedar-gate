// ── Structured Logger ────────────────────────────────────────────────

import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

export function createLogger(level: LogLevel = "info"): pino.Logger {
  return pino({
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}
