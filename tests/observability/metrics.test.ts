import { describe, it, expect } from "vitest";
import { MetricsRegistry } from "../../src/observability/metrics.js";

describe("MetricsRegistry", () => {
  it("serializes counters in Prometheus format", () => {
    const registry = new MetricsRegistry();
    registry.counter("requests_total", { method: "GET" });
    registry.counter("requests_total", { method: "GET" });
    registry.counter("requests_total", { method: "POST" });

    const output = registry.serialize();
    expect(output).toContain("# TYPE requests_total counter");
    expect(output).toContain('requests_total{method="GET"} 2');
    expect(output).toContain('requests_total{method="POST"} 1');
  });

  it("serializes gauges in Prometheus format", () => {
    const registry = new MetricsRegistry();
    registry.gauge("active_connections", 42);

    const output = registry.serialize();
    expect(output).toContain("# TYPE active_connections gauge");
    expect(output).toContain("active_connections 42");
  });

  it("serializes histograms with buckets", () => {
    const registry = new MetricsRegistry([0.1, 0.5, 1.0]);
    registry.histogram("request_duration", 0.05);
    registry.histogram("request_duration", 0.3);
    registry.histogram("request_duration", 0.8);

    const output = registry.serialize();
    expect(output).toContain("# TYPE request_duration histogram");
    expect(output).toContain('request_duration_bucket{le="0.1"} 1');
    expect(output).toContain('request_duration_bucket{le="0.5"} 2');
    expect(output).toContain('request_duration_bucket{le="1"} 3');
    expect(output).toContain('request_duration_bucket{le="+Inf"} 3');
    expect(output).toContain("request_duration_count 3");
  });

  it("handles histograms with labels", () => {
    const registry = new MetricsRegistry([1.0]);
    registry.histogram("duration", 0.5, { action: "route" });
    registry.histogram("duration", 0.5, { action: "access" });

    const output = registry.serialize();
    expect(output).toContain('duration_bucket{action="route",le="1"} 1');
    expect(output).toContain('duration_bucket{action="access",le="1"} 1');
  });

  it("gauge updates replace previous value", () => {
    const registry = new MetricsRegistry();
    registry.gauge("connections", 10);
    registry.gauge("connections", 20);

    const output = registry.serialize();
    expect(output).toContain("connections 20");
    expect(output).not.toContain("connections 10");
  });
});
