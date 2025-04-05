// ── HTTP Reverse Proxy ───────────────────────────────────────────────

import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { BackendTarget } from "./router.js";

export interface ProxyOptions {
  /** Request trace ID to forward as X-Request-Id */
  requestId: string;
  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Proxy an incoming request to a backend target.
 * Streams the request body and response body without buffering.
 */
export function proxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  target: BackendTarget,
  options: ProxyOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const targetUrl = new URL(req.url ?? "/", target.url);
    const isHttps = targetUrl.protocol === "https:";
    const makeRequest = isHttps ? httpsRequest : httpRequest;

    // Build forwarded headers, filtering hop-by-hop headers
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        headers[key] = value;
      }
    }
    headers["x-request-id"] = options.requestId;

    // Append to X-Forwarded-For rather than overwriting
    const existingXff = req.headers["x-forwarded-for"];
    const clientIp = req.socket.remoteAddress ?? "";
    headers["x-forwarded-for"] = existingXff
      ? `${existingXff}, ${clientIp}`
      : clientIp;

    headers["x-forwarded-proto"] = isHttps ? "https" : "http";
    headers["host"] = targetUrl.host;

    const proxyReq = makeRequest(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers,
        timeout: target.timeout ?? options.timeout,
      },
      (proxyRes) => {
        // Forward status and headers from backend
        res.writeHead(
          proxyRes.statusCode ?? 502,
          filterHopByHopHeaders(proxyRes.headers),
        );
        // Stream response body
        proxyRes.pipe(res);
        proxyRes.on("end", resolve);
        proxyRes.on("error", reject);
      },
    );

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Gateway Timeout" }));
      }
      resolve();
    });

    proxyReq.on("error", () => {
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "Bad Gateway" }));
      }
      resolve();
    });

    // Abort backend request if client disconnects before response is sent
    res.on("close", () => {
      if (!res.writableEnded && !proxyReq.destroyed) {
        proxyReq.destroy();
      }
    });

    // Stream request body to backend
    req.pipe(proxyReq);
  });
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

function filterHopByHopHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const filtered: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
}
