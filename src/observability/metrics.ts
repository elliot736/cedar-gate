// ── Prometheus Metrics Registry ──────────────────────────────────────
// Custom implementation — no external dependency needed.

interface CounterEntry {
  value: number;
}

interface HistogramEntry {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

interface GaugeEntry {
  value: number;
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelsKey(labels: Record<string, string>): string {
  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}="${v}"`).join(",");
}

function formatLabels(labels: Record<string, string>): string {
  const key = labelsKey(labels);
  return key ? `{${key}}` : "";
}

export class MetricsRegistry {
  private counters = new Map<string, CounterEntry>();
  private histograms = new Map<string, HistogramEntry>();
  private gauges = new Map<string, GaugeEntry>();
  private histogramBuckets: number[];

  constructor(buckets: number[] = DEFAULT_BUCKETS) {
    this.histogramBuckets = buckets;
  }

  counter(name: string, labels: Record<string, string> = {}): void {
    const key = `${name}|${labelsKey(labels)}`;
    const entry = this.counters.get(key);
    if (entry) {
      entry.value++;
    } else {
      this.counters.set(key, { value: 1 });
    }
  }

  histogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    const key = `${name}|${labelsKey(labels)}`;
    let entry = this.histograms.get(key);
    if (!entry) {
      entry = {
        count: 0,
        sum: 0,
        buckets: new Map(this.histogramBuckets.map((b) => [b, 0])),
      };
      this.histograms.set(key, entry);
    }
    entry.count++;
    entry.sum += value;
    for (const bucket of this.histogramBuckets) {
      if (value <= bucket) {
        entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + 1);
      }
    }
  }

  gauge(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    const key = `${name}|${labelsKey(labels)}`;
    this.gauges.set(key, { value });
  }

  /**
   * Serialize all metrics in Prometheus text exposition format.
   */
  serialize(): string {
    const lines: string[] = [];

    // Counters
    const counterNames = new Set<string>();
    for (const [key, entry] of this.counters) {
      const [name, labelStr] = splitKey(key);
      if (!counterNames.has(name!)) {
        lines.push(`# TYPE ${name} counter`);
        counterNames.add(name!);
      }
      const labels = labelStr ? `{${labelStr}}` : "";
      lines.push(`${name}${labels} ${entry.value}`);
    }

    // Gauges
    const gaugeNames = new Set<string>();
    for (const [key, entry] of this.gauges) {
      const [name, labelStr] = splitKey(key);
      if (!gaugeNames.has(name!)) {
        lines.push(`# TYPE ${name} gauge`);
        gaugeNames.add(name!);
      }
      const labels = labelStr ? `{${labelStr}}` : "";
      lines.push(`${name}${labels} ${entry.value}`);
    }

    // Histograms
    const histogramNames = new Set<string>();
    for (const [key, entry] of this.histograms) {
      const [name, labelStr] = splitKey(key);
      if (!histogramNames.has(name!)) {
        lines.push(`# TYPE ${name} histogram`);
        histogramNames.add(name!);
      }
      const baseLabels = labelStr ? `${labelStr},` : "";
      for (const bucket of this.histogramBuckets) {
        lines.push(`${name}_bucket{${baseLabels}le="${bucket}"} ${entry.buckets.get(bucket) ?? 0}`);
      }
      lines.push(`${name}_bucket{${baseLabels}le="+Inf"} ${entry.count}`);
      lines.push(
        `${name}_sum${labelStr ? `{${labelStr}}` : ""} ${entry.sum}`,
      );
      lines.push(
        `${name}_count${labelStr ? `{${labelStr}}` : ""} ${entry.count}`,
      );
    }

    return lines.join("\n") + "\n";
  }

}

function splitKey(key: string): [string, string] {
  const idx = key.indexOf("|");
  return [key.slice(0, idx), key.slice(idx + 1)];
}
