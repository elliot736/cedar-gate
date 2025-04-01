// ── Gateway Configuration ────────────────────────────────────────────

export interface GatewayConfig {
  /** Port for the gateway HTTP server */
  port: number;
  /** Separate port for the admin API (optional, defaults to port + 1) */
  adminPort?: number;
  /** Directory containing .cedar policy files */
  policiesDir: string;
  /** JSON file with entity definitions */
  entitiesFile?: string;
  /** Enable file watcher for policy hot-reload */
  hotReload: boolean;
  /** Log level */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Metrics configuration */
  metrics: {
    enabled: boolean;
    /** Path for the Prometheus metrics endpoint (default: /metrics) */
    path: string;
  };
  /** Default backend timeout in milliseconds */
  backendTimeout: number;
}

export const DEFAULT_CONFIG: GatewayConfig = {
  port: 8080,
  adminPort: 8081,
  policiesDir: "./policies",
  hotReload: true,
  logLevel: "info",
  metrics: {
    enabled: true,
    path: "/metrics",
  },
  backendTimeout: 30_000,
};

export function loadConfig(
  overrides: Partial<GatewayConfig> = {},
): GatewayConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    metrics: {
      ...DEFAULT_CONFIG.metrics,
      ...overrides.metrics,
    },
  };
}
