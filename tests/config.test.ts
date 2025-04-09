import { describe, it, expect } from "vitest";
import { loadConfig, DEFAULT_CONFIG, type GatewayConfig } from "../src/config.js";

describe("DEFAULT_CONFIG", () => {
  it("has expected default values", () => {
    expect(DEFAULT_CONFIG.port).toBe(8080);
    expect(DEFAULT_CONFIG.adminPort).toBe(8081);
    expect(DEFAULT_CONFIG.policiesDir).toBe("./policies");
    expect(DEFAULT_CONFIG.hotReload).toBe(true);
    expect(DEFAULT_CONFIG.logLevel).toBe("info");
    expect(DEFAULT_CONFIG.backendTimeout).toBe(30_000);
  });

  it("has metrics enabled by default", () => {
    expect(DEFAULT_CONFIG.metrics.enabled).toBe(true);
    expect(DEFAULT_CONFIG.metrics.path).toBe("/metrics");
  });
});

describe("loadConfig", () => {
  it("returns defaults when no overrides provided", () => {
    const config = loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns defaults when called with empty object", () => {
    const config = loadConfig({});
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("overrides port", () => {
    const config = loadConfig({ port: 3000 });
    expect(config.port).toBe(3000);
    // Other fields remain default
    expect(config.adminPort).toBe(8081);
    expect(config.policiesDir).toBe("./policies");
  });

  it("overrides adminPort", () => {
    const config = loadConfig({ adminPort: 9090 });
    expect(config.adminPort).toBe(9090);
  });

  it("overrides policiesDir", () => {
    const config = loadConfig({ policiesDir: "/etc/cedar" });
    expect(config.policiesDir).toBe("/etc/cedar");
  });

  it("overrides hotReload to false", () => {
    const config = loadConfig({ hotReload: false });
    expect(config.hotReload).toBe(false);
  });

  it("overrides logLevel", () => {
    const config = loadConfig({ logLevel: "debug" });
    expect(config.logLevel).toBe("debug");
  });

  it("overrides backendTimeout", () => {
    const config = loadConfig({ backendTimeout: 60_000 });
    expect(config.backendTimeout).toBe(60_000);
  });

  it("overrides entitiesFile", () => {
    const config = loadConfig({ entitiesFile: "/data/entities.json" });
    expect(config.entitiesFile).toBe("/data/entities.json");
  });

  it("deep-merges metrics with defaults", () => {
    const config = loadConfig({ metrics: { enabled: false, path: "/metrics" } });
    expect(config.metrics.enabled).toBe(false);
    expect(config.metrics.path).toBe("/metrics");
  });

  it("preserves metrics.enabled when only overriding metrics.path", () => {
    const config = loadConfig({ metrics: { enabled: true, path: "/custom-metrics" } });
    expect(config.metrics.enabled).toBe(true);
    expect(config.metrics.path).toBe("/custom-metrics");
  });

  it("allows multiple overrides at once", () => {
    const config = loadConfig({
      port: 4000,
      logLevel: "error",
      hotReload: false,
      backendTimeout: 10_000,
    });
    expect(config.port).toBe(4000);
    expect(config.logLevel).toBe("error");
    expect(config.hotReload).toBe(false);
    expect(config.backendTimeout).toBe(10_000);
    // Defaults for non-overridden fields
    expect(config.policiesDir).toBe("./policies");
    expect(config.metrics.enabled).toBe(true);
  });

  it("does not mutate DEFAULT_CONFIG", () => {
    const before = { ...DEFAULT_CONFIG, metrics: { ...DEFAULT_CONFIG.metrics } };
    loadConfig({ port: 9999, metrics: { enabled: false, path: "/x" } });
    expect(DEFAULT_CONFIG.port).toBe(before.port);
    expect(DEFAULT_CONFIG.metrics.enabled).toBe(before.metrics.enabled);
  });
});
