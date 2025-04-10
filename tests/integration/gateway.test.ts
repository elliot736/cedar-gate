import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { EntityJson } from "@cedar-policy/cedar-wasm";
import { PolicyStore } from "../../src/policies/policy-store.js";
import { createGatewayHandler } from "../../src/gateway.js";
import { MetricsRegistry } from "../../src/observability/metrics.js";
import { createLogger } from "../../src/observability/logger.js";
import { loadConfig } from "../../src/config.js";
import { ENTITY_TYPES } from "../../src/schema/gateway-schema.js";

// ── Backend mock ────────────────────────────────────────────────────

let backend: Server;
let backendPort: number;

function startBackend(): Promise<void> {
  return new Promise((resolve) => {
    backend = createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "ok from backend" }));
    });
    backend.listen(0, () => {
      backendPort = (backend.address() as { port: number }).port;
      resolve();
    });
  });
}

// ── Gateway setup ───────────────────────────────────────────────────

let gateway: Server;
let gatewayPort: number;

function startGateway(
  policyText: string,
  entities: EntityJson[],
): Promise<void> {
  return new Promise((resolve) => {
    const store = new PolicyStore(policyText, entities);
    const config = loadConfig({ backendTimeout: 5000 });
    const metrics = new MetricsRegistry();
    const logger = createLogger("error");

    const handler = createGatewayHandler({ config, store, metrics, logger });
    gateway = createServer(handler);
    gateway.listen(0, () => {
      gatewayPort = (gateway.address() as { port: number }).port;
      resolve();
    });
  });
}

async function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  const res = await fetch(`http://localhost:${gatewayPort}${path}`, {
    method,
    headers,
  });
  const body = await res.text();
  const resHeaders: Record<string, string> = {};
  res.headers.forEach((val, key) => {
    resHeaders[key] = val;
  });
  return { status: res.status, body, headers: resHeaders };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Gateway integration", () => {
  beforeAll(async () => {
    await startBackend();
  });

  afterAll(() => {
    backend?.close();
    gateway?.close();
  });

  it("proxies a request when access and routing policies permit", async () => {
    const entities: EntityJson[] = [
      {
        uid: { type: ENTITY_TYPES.Service, id: "api" },
        attrs: { name: "api", url: `http://localhost:${backendPort}` },
        parents: [],
      },
      {
        uid: { type: ENTITY_TYPES.Endpoint, id: "GET:/api/test" },
        attrs: { path: "/api/test", method: "GET", backend: `http://localhost:${backendPort}` },
        parents: [{ type: ENTITY_TYPES.Service, id: "api" }],
      },
    ];

    await startGateway(
      `
      permit(principal, action == Action::"access", resource);
      permit(principal, action == Action::"route", resource == Gateway::Endpoint::"GET:/api/test");
      `,
      entities,
    );

    const res = await request("GET", "/api/test");
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ message: "ok from backend" });

    gateway.close();
  });

  it("returns 403 when access is denied", async () => {
    await startGateway(
      `
      forbid(principal, action == Action::"access", resource);
      `,
      [],
    );

    const res = await request("GET", "/api/test");
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe("Forbidden");

    gateway.close();
  });

  it("returns 404 when no route matches", async () => {
    await startGateway(
      `
      permit(principal, action == Action::"access", resource);
      `,
      [],
    );

    const res = await request("GET", "/nonexistent");
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error).toBe("Not Found");

    gateway.close();
  });

  it("includes x-request-id in responses", async () => {
    await startGateway(
      'permit(principal, action == Action::"access", resource);',
      [],
    );

    const res = await request("GET", "/test");
    expect(res.headers["x-request-id"]).toBeDefined();

    gateway.close();
  });

  it("forwards x-request-id from client", async () => {
    await startGateway(
      'forbid(principal, action == Action::"access", resource);',
      [],
    );

    const res = await request("GET", "/test", { "x-request-id": "custom-id-123" });
    expect(res.headers["x-request-id"]).toBe("custom-id-123");

    gateway.close();
  });
});
