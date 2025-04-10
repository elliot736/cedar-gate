import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { handleAdminRequest } from "../../src/admin/admin-handlers.js";
import { PolicyStore } from "../../src/policies/policy-store.js";
import type { MetricsRegistry } from "../../src/observability/metrics.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeStore(policyText?: string) {
  if (policyText) {
    return new PolicyStore(policyText);
  }
  return new PolicyStore();
}

function makeMetrics(): MetricsRegistry {
  return {
    serialize: vi.fn(() => "# HELP fake\nfake_total 42\n"),
  } as unknown as MetricsRegistry;
}

function makeReloader(result: { success: boolean; error?: string } = { success: true }) {
  return {
    reload: vi.fn(async () => result),
  };
}

function makeCtx(overrides: {
  store?: PolicyStore;
  reloader?: ReturnType<typeof makeReloader> | null;
  metrics?: MetricsRegistry;
} = {}) {
  return {
    store: overrides.store ?? makeStore(),
    reloader: overrides.reloader ?? null,
    metrics: overrides.metrics ?? makeMetrics(),
  };
}

// ── Test Server ─────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;
let currentCtx: ReturnType<typeof makeCtx>;

function setCtx(ctx: ReturnType<typeof makeCtx>) {
  currentCtx = ctx;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    handleAdminRequest(req, res, currentCtx).catch((err) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (addr && typeof addr === "object") {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── Tests ───────────────────────────────────────────────────────────

describe("Admin Handlers", () => {
  describe("GET /health", () => {
    it("returns ok with counts", async () => {
      const store = makeStore('permit(principal, action, resource);');
      setCtx(makeCtx({ store }));

      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.policyCount).toBe(1);
      expect(body.entityCount).toBe(0);
    });
  });

  describe("GET /admin/policies", () => {
    it("returns empty when no policies", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/admin/policies`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(0);
      expect(body.policyText).toBe("");
    });

    it("returns policy text and count", async () => {
      const store = makeStore('permit(principal, action, resource);');
      setCtx(makeCtx({ store }));

      const res = await fetch(`${baseUrl}/admin/policies`);
      const body = await res.json();
      expect(body.count).toBe(1);
      expect(body.policyText).toContain("permit");
    });
  });

  describe("POST /admin/policies", () => {
    it("adds a valid policy", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/admin/policies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyText: 'permit(principal, action, resource);' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.added).toBe(true);
      expect(body.policyCount).toBe(1);
    });

    it("returns 400 when policyText is missing", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/admin/policies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wrong: "field" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Missing");
    });

    it("returns 400 when policyText is not a string", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/admin/policies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyText: 123 }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 on parse error", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/admin/policies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyText: "this is not valid cedar syntax!!!" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Policy parse error");
      expect(body.messages).toBeDefined();
    });
  });

  describe("POST /admin/policies/reload", () => {
    it("returns 400 when no reloader is configured", async () => {
      setCtx(makeCtx({ reloader: null }));

      const res = await fetch(`${baseUrl}/admin/policies/reload`, { method: "POST" });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("not configured");
    });

    it("reloads successfully", async () => {
      const reloader = makeReloader({ success: true });
      const store = makeStore('permit(principal, action, resource);');
      setCtx(makeCtx({ reloader, store }));

      const res = await fetch(`${baseUrl}/admin/policies/reload`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reloaded).toBe(true);
      expect(reloader.reload).toHaveBeenCalled();
    });

    it("returns 500 on reload failure", async () => {
      const reloader = makeReloader({ success: false, error: "disk error" });
      setCtx(makeCtx({ reloader }));

      const res = await fetch(`${baseUrl}/admin/policies/reload`, { method: "POST" });
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.reloaded).toBe(false);
      expect(body.error).toBe("disk error");
    });
  });

  describe("GET /admin/entities", () => {
    it("returns empty entities", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/admin/entities`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.count).toBe(0);
      expect(body.entities).toEqual([]);
    });
  });

  describe("PUT /admin/entities", () => {
    it("sets entities from a valid array", async () => {
      const store = makeStore();
      setCtx(makeCtx({ store }));

      const entities = [
        { uid: { type: "Gateway::Service", id: "api" }, attrs: { name: "api", url: "http://localhost" }, parents: [] },
      ];
      const res = await fetch(`${baseUrl}/admin/entities`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entities),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.updated).toBe(true);
      expect(body.count).toBe(1);
      expect(store.entityCount).toBe(1);
    });

    it("returns 400 when body is not an array", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/admin/entities`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ not: "an array" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("JSON array");
    });
  });

  describe("GET /metrics", () => {
    it("returns serialized metrics as text/plain", async () => {
      const metrics = makeMetrics();
      setCtx(makeCtx({ metrics }));

      const res = await fetch(`${baseUrl}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      expect(text).toContain("fake_total 42");
      expect(metrics.serialize).toHaveBeenCalled();
    });
  });

  describe("404 handling", () => {
    it("returns 404 for unknown paths", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/unknown/path`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("Not Found");
    });

    it("returns 404 for wrong method on known path", async () => {
      setCtx(makeCtx());

      const res = await fetch(`${baseUrl}/health`, { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });
});
