// ── Gateway Orchestrator ─────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayConfig } from "./config.js";
import type { GatewayRequest, GatewayResponse } from "./pipeline/types.js";
import { PolicyStore } from "./policies/policy-store.js";
import { PolicyEvaluator } from "./policies/policy-evaluator.js";
import { evaluateAccess } from "./authz/access-evaluator.js";
import { resolveRoute } from "./routing/router.js";
import { proxyRequest } from "./routing/proxy.js";
import { PolicyRateLimiter } from "./ratelimit/policy-rate-limiter.js";
import {
  buildPrincipal,
  buildEndpointUID,
  buildContext,
} from "./schema/entity-builder.js";
import { MetricsRegistry } from "./observability/metrics.js";
import { generateRequestId, durationSeconds } from "./observability/tracing.js";
import type { Logger } from "pino";

export interface GatewayDeps {
  config: GatewayConfig;
  store: PolicyStore;
  metrics: MetricsRegistry;
  logger: Logger;
}

/**
 * Creates the gateway request handler.
 * Wires together access control, rate limiting, routing, and proxying.
 */
export function createGatewayHandler(deps: GatewayDeps) {
  const { config, store, metrics, logger } = deps;
  const rateLimiter = new PolicyRateLimiter();

  return async function handleRequest(
    rawReq: IncomingMessage,
    rawRes: ServerResponse,
  ): Promise<void> {
    const startTime = process.hrtime.bigint();
    const rawRequestId = rawReq.headers["x-request-id"];
    const requestId =
      typeof rawRequestId === "string" &&
      rawRequestId.length <= 128 &&
      /^[\w\-.:]+$/.test(rawRequestId)
        ? rawRequestId
        : generateRequestId();

    const req: GatewayRequest = {
      raw: rawReq,
      id: requestId,
      method: (rawReq.method ?? "GET").toUpperCase(),
      path: parsePathname(rawReq.url ?? "/"),
      query: parseQuery(rawReq.url ?? "/"),
      headers: rawReq.headers as Record<string, string | string[] | undefined>,
      sourceIp: rawReq.socket.remoteAddress ?? "",
      tenantId: extractTenantId(rawReq),
      startTime,
    };

    const res: GatewayResponse = {
      raw: rawRes,
      statusCode: 200,
      headers: {},
    };

    const reqLogger = logger.child({
      requestId,
      method: req.method,
      path: req.path,
    });

    try {
      // Capture snapshots for this request (atomic)
      const policyText = store.getPolicyText();
      const entities = store.getEntities();
      const evaluator = new PolicyEvaluator(policyText, entities);

      // Build Cedar request context
      const principal = buildPrincipal(req);
      const context = buildContext(req);
      const endpointUID = buildEndpointUID(req.method, req.path);

      // 1. Access Control
      const accessStart = process.hrtime.bigint();
      const access = evaluateAccess(evaluator, principal, endpointUID, context);
      metrics.histogram(
        "gateway_policy_evaluation_seconds",
        durationSeconds(accessStart),
        { action: "access" },
      );

      if (!access.allowed) {
        metrics.counter("gateway_requests_total", {
          method: req.method,
          status: "403",
          tenant: req.tenantId ?? "",
        });
        rawRes.writeHead(403, {
          "content-type": "application/json",
          "x-request-id": requestId,
        });
        rawRes.end(
          JSON.stringify({ error: "Forbidden", reasons: access.reasons }),
        );
        reqLogger.info(
          { status: 403, duration: durationSeconds(startTime) },
          "Access denied",
        );
        return;
      }

      // 2. Rate Limiting
      const rateLimitKey = `${req.tenantId ?? "global"}:${req.method}:${req.path}`;
      const rateStart = process.hrtime.bigint();
      const rateDecision = rateLimiter.check(
        evaluator,
        entities,
        principal,
        context,
        rateLimitKey,
      );
      metrics.histogram(
        "gateway_policy_evaluation_seconds",
        durationSeconds(rateStart),
        { action: "ratelimit" },
      );

      if (rateDecision && !rateDecision.result.allowed) {
        metrics.counter("gateway_rate_limit_hits_total", {
          tenant: req.tenantId ?? "",
          tier: rateDecision.tier,
        });
        rawRes.writeHead(429, {
          "content-type": "application/json",
          "x-request-id": requestId,
          "retry-after": String(
            Math.ceil((rateDecision.result.retryAfterMs ?? 1000) / 1000),
          ),
          "x-ratelimit-limit": String(rateDecision.result.limit),
          "x-ratelimit-remaining": String(rateDecision.result.remaining),
        });
        rawRes.end(
          JSON.stringify({
            error: "Too Many Requests",
            retryAfterMs: rateDecision.result.retryAfterMs,
          }),
        );
        reqLogger.info(
          {
            status: 429,
            tier: rateDecision.tier,
            duration: durationSeconds(startTime),
          },
          "Rate limited",
        );
        return;
      }

      // 3. Routing
      const routeStart = process.hrtime.bigint();
      const route = resolveRoute(
        evaluator,
        entities,
        principal,
        req.method,
        req.path,
        context,
      );
      metrics.histogram(
        "gateway_policy_evaluation_seconds",
        durationSeconds(routeStart),
        { action: "route" },
      );

      if (!route) {
        metrics.counter("gateway_requests_total", {
          method: req.method,
          status: "404",
          tenant: req.tenantId ?? "",
        });
        rawRes.writeHead(404, {
          "content-type": "application/json",
          "x-request-id": requestId,
        });
        rawRes.end(JSON.stringify({ error: "Not Found" }));
        reqLogger.info(
          { status: 404, duration: durationSeconds(startTime) },
          "No route matched",
        );
        return;
      }

      // 4. Proxy
      const proxyStart = process.hrtime.bigint();
      await proxyRequest(rawReq, rawRes, route.backend, {
        requestId,
        timeout: config.backendTimeout,
      });
      metrics.histogram(
        "gateway_backend_request_seconds",
        durationSeconds(proxyStart),
        { backend: route.backend.url },
      );

      const status = String(rawRes.statusCode);
      metrics.counter("gateway_requests_total", {
        method: req.method,
        status,
        tenant: req.tenantId ?? "",
      });
      metrics.histogram(
        "gateway_request_duration_seconds",
        durationSeconds(startTime),
        { method: req.method },
      );
      reqLogger.info(
        {
          status: rawRes.statusCode,
          backend: route.backend.url,
          duration: durationSeconds(startTime),
        },
        "Request proxied",
      );
    } catch (err) {
      metrics.counter("gateway_requests_total", {
        method: req.method,
        status: "500",
        tenant: req.tenantId ?? "",
      });
      reqLogger.error(
        { err, duration: durationSeconds(startTime) },
        "Request failed",
      );
      if (!rawRes.headersSent) {
        rawRes.writeHead(500, {
          "content-type": "application/json",
          "x-request-id": requestId,
        });
        rawRes.end(JSON.stringify({ error: "Internal Server Error" }));
      }
    }
  };
}

function parsePathname(url: string): string {
  const idx = url.indexOf("?");
  return idx >= 0 ? url.slice(0, idx) : url;
}

function parseQuery(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const params = new URLSearchParams(url.slice(idx + 1));
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    result[key] = value;
  }
  return result;
}

function extractTenantId(req: IncomingMessage): string | undefined {
  const header = req.headers["x-tenant-id"];
  if (typeof header === "string" && header.length > 0) {
    return header;
  }
  return undefined;
}
