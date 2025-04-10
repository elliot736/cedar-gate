import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { proxyRequest, type ProxyOptions } from "../../src/routing/proxy.js";
import type { BackendTarget } from "../../src/routing/router.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeOptions(overrides: Partial<ProxyOptions> = {}): ProxyOptions {
  return {
    requestId: "test-req-001",
    timeout: 5000,
    ...overrides,
  };
}

function makeTarget(url: string, timeout?: number): BackendTarget {
  return { url, timeout };
}

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// Create a gateway server that proxies to a target
async function startGateway(
  target: BackendTarget,
  options: ProxyOptions,
): Promise<{ server: Server; url: string }> {
  return startServer((req, res) => {
    proxyRequest(req, res, target, options).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("proxyRequest", () => {
  let backend: { server: Server; url: string };
  let gateway: { server: Server; url: string };

  afterAll(async () => {
    if (backend?.server) await closeServer(backend.server);
    if (gateway?.server) await closeServer(gateway.server);
  });

  describe("basic proxying", () => {
    let backendServer: { server: Server; url: string };
    let gatewayServer: { server: Server; url: string };

    beforeAll(async () => {
      backendServer = await startServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json", "x-custom": "hello" });
        res.end(JSON.stringify({
          method: req.method,
          url: req.url,
          requestId: req.headers["x-request-id"],
          forwardedFor: req.headers["x-forwarded-for"],
          forwardedProto: req.headers["x-forwarded-proto"],
        }));
      });

      gatewayServer = await startGateway(
        makeTarget(backendServer.url),
        makeOptions(),
      );
    });

    afterAll(async () => {
      await closeServer(gatewayServer.server);
      await closeServer(backendServer.server);
    });

    it("forwards GET requests and returns response", async () => {
      const res = await fetch(`${gatewayServer.url}/api/test`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.method).toBe("GET");
      expect(body.url).toBe("/api/test");
    });

    it("forwards x-request-id header", async () => {
      const res = await fetch(`${gatewayServer.url}/api/test`);
      const body = await res.json();
      expect(body.requestId).toBe("test-req-001");
    });

    it("sets x-forwarded-proto to http", async () => {
      const res = await fetch(`${gatewayServer.url}/api/test`);
      const body = await res.json();
      expect(body.forwardedProto).toBe("http");
    });

    it("forwards custom response headers", async () => {
      const res = await fetch(`${gatewayServer.url}/api/test`);
      expect(res.headers.get("x-custom")).toBe("hello");
    });
  });

  describe("POST with body", () => {
    let backendServer: { server: Server; url: string };
    let gatewayServer: { server: Server; url: string };

    beforeAll(async () => {
      backendServer = await startServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          const bodyText = Buffer.concat(chunks).toString();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ echo: bodyText, method: req.method }));
        });
      });

      gatewayServer = await startGateway(
        makeTarget(backendServer.url),
        makeOptions(),
      );
    });

    afterAll(async () => {
      await closeServer(gatewayServer.server);
      await closeServer(backendServer.server);
    });

    it("streams request body to backend", async () => {
      const payload = JSON.stringify({ hello: "world" });
      const res = await fetch(`${gatewayServer.url}/api/data`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.echo).toBe(payload);
      expect(body.method).toBe("POST");
    });
  });

  describe("backend error", () => {
    it("returns 502 when backend is unreachable", async () => {
      const gw = await startGateway(
        makeTarget("http://127.0.0.1:19999"),
        makeOptions(),
      );

      try {
        const res = await fetch(`${gw.url}/api/test`);
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toBe("Bad Gateway");
      } finally {
        await closeServer(gw.server);
      }
    });
  });

  describe("hop-by-hop headers", () => {
    let backendServer: { server: Server; url: string };
    let gatewayServer: { server: Server; url: string };

    beforeAll(async () => {
      backendServer = await startServer((req, res) => {
        // Return the connection header presence
        res.writeHead(200, {
          "content-type": "application/json",
          "x-keep": "yes",
        });
        res.end(JSON.stringify({
          hasConnection: !!req.headers["connection"],
          hasKeepAlive: !!req.headers["keep-alive"],
        }));
      });

      gatewayServer = await startGateway(
        makeTarget(backendServer.url),
        makeOptions(),
      );
    });

    afterAll(async () => {
      await closeServer(gatewayServer.server);
      await closeServer(backendServer.server);
    });

    it("preserves non-hop-by-hop response headers", async () => {
      const res = await fetch(`${gatewayServer.url}/test`);
      expect(res.headers.get("x-keep")).toBe("yes");
    });
  });

  describe("streaming response", () => {
    let backendServer: { server: Server; url: string };
    let gatewayServer: { server: Server; url: string };

    beforeAll(async () => {
      backendServer = await startServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.write("chunk1");
        res.write("chunk2");
        res.end("chunk3");
      });

      gatewayServer = await startGateway(
        makeTarget(backendServer.url),
        makeOptions(),
      );
    });

    afterAll(async () => {
      await closeServer(gatewayServer.server);
      await closeServer(backendServer.server);
    });

    it("streams all chunks to client", async () => {
      const res = await fetch(`${gatewayServer.url}/stream`);
      const text = await res.text();
      expect(text).toBe("chunk1chunk2chunk3");
    });
  });
});
