// ── Admin API Router ─────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Logger } from "pino";
import type { PolicyStore } from "../policies/policy-store.js";
import type { HotReloader } from "../policies/hot-reload.js";
import type { MetricsRegistry } from "../observability/metrics.js";
import { handleAdminRequest } from "./admin-handlers.js";

export interface AdminServerOptions {
  port: number;
  store: PolicyStore;
  reloader: HotReloader | null;
  metrics: MetricsRegistry;
  logger: Logger;
}

/**
 * Create and start the admin API server on a separate port.
 */
export function createAdminServer(options: AdminServerOptions) {
  const { port, store, reloader, metrics, logger } = options;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await handleAdminRequest(req, res, { store, reloader, metrics });
    } catch (err) {
      if (err instanceof Error && err.name === "BodyTooLargeError") {
        if (!res.headersSent) {
          res.writeHead(413, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Request body too large" }));
        }
        return;
      }
      logger.error({ err }, "Admin API error");
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
  });

  server.listen(port, () => {
    logger.info({ port }, "Admin API server listening");
  });

  return server;
}
