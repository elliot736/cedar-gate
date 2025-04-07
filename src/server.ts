#!/usr/bin/env node
// ── Cedar Gate Server ───────────────────────────────────────────────

import { createServer } from "node:http";
import { loadConfig, type GatewayConfig } from "./config.js";
import { PolicyStore } from "./policies/policy-store.js";
import {
  loadPoliciesFromDir,
  loadEntitiesFromFile,
} from "./policies/policy-loader.js";
import { HotReloader } from "./policies/hot-reload.js";
import { createGatewayHandler } from "./gateway.js";
import { createAdminServer } from "./admin/admin-router.js";
import { createLogger } from "./observability/logger.js";
import { MetricsRegistry } from "./observability/metrics.js";
import type { EntityJson } from "@cedar-policy/cedar-wasm";

async function main() {
  const config = loadConfig({
    port: parseInt(process.env["PORT"] ?? "8080", 10),
    adminPort: parseInt(process.env["ADMIN_PORT"] ?? "8081", 10),
    policiesDir: process.env["POLICIES_DIR"] ?? "./policies",
    entitiesFile: process.env["ENTITIES_FILE"] ?? undefined,
    hotReload: process.env["HOT_RELOAD"] !== "false",
    logLevel: (process.env["LOG_LEVEL"] ?? "info") as GatewayConfig["logLevel"],
  });

  const logger = createLogger(config.logLevel);
  const metrics = new MetricsRegistry();

  // Load initial policies
  const { policyText, errors } = await loadPoliciesFromDir(config.policiesDir);
  if (errors.length > 0) {
    for (const { file, error } of errors) {
      logger.error({ file, error }, "Failed to parse policy file");
    }
  }

  if (!policyText) {
    logger.warn(
      "No valid policies loaded — all requests will be denied by default",
    );
  }

  // Load initial entities
  let entities: EntityJson[] = [];
  if (config.entitiesFile) {
    try {
      entities = await loadEntitiesFromFile(config.entitiesFile);
    } catch (err) {
      logger.error(
        { err, file: config.entitiesFile },
        "Failed to load entities file",
      );
    }
  }

  const store = new PolicyStore(policyText, entities);
  logger.info(
    { policyCount: store.policyCount, entityCount: store.entityCount },
    "Policies loaded",
  );

  // Track policy changes in metrics
  store.onChange(() => {
    metrics.gauge("gateway_policy_count", store.policyCount);
    metrics.gauge("gateway_entity_count", store.entityCount);
    metrics.counter("gateway_policy_reload_total");
  });
  metrics.gauge("gateway_policy_count", store.policyCount);
  metrics.gauge("gateway_entity_count", store.entityCount);

  // Set up hot reload
  let reloader: HotReloader | null = null;
  if (config.hotReload) {
    reloader = new HotReloader(store, logger, {
      policiesDir: config.policiesDir,
      entitiesFile: config.entitiesFile,
    });
    reloader.start();
  }

  // Create gateway handler
  const handler = createGatewayHandler({ config, store, metrics, logger });

  // Start gateway server
  const server = createServer(handler);
  server.listen(config.port, () => {
    logger.info({ port: config.port }, "Cedar Gate listening");
  });

  // Start admin server
  const adminServer = createAdminServer({
    port: config.adminPort ?? config.port + 1,
    store,
    reloader,
    metrics,
    logger,
  });

  // Graceful shutdown — wait for in-flight requests to drain
  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Shutting down — draining connections...");
    reloader?.stop();

    let closed = 0;
    const onClose = () => {
      closed++;
      if (closed >= 2) {
        logger.info("Shutdown complete");
        process.exit(0);
      }
    };
    server.close(onClose);
    adminServer.close(onClose);

    setTimeout(() => {
      logger.warn("Force shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
