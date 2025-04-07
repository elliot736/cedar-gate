// ── Admin API Handlers ───────────────────────────────────────────────

import type { IncomingMessage, ServerResponse } from "node:http";
import { checkParsePolicySet } from "@cedar-policy/cedar-wasm";
import type { PolicyStore } from "../policies/policy-store.js";
import type { HotReloader } from "../policies/hot-reload.js";
import type { MetricsRegistry } from "../observability/metrics.js";

interface AdminContext {
  store: PolicyStore;
  reloader: HotReloader | null;
  metrics: MetricsRegistry;
}

export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AdminContext,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (path === "/admin/policies" && method === "GET") {
    return getPolicies(res, ctx);
  }

  if (path === "/admin/policies" && method === "POST") {
    return addPolicies(req, res, ctx);
  }

  if (path === "/admin/policies/reload" && method === "POST") {
    return reloadPolicies(res, ctx);
  }

  if (path === "/admin/entities" && method === "GET") {
    return getEntities(res, ctx);
  }

  if (path === "/admin/entities" && method === "PUT") {
    return setEntities(req, res, ctx);
  }

  if (path === "/metrics" && method === "GET") {
    return getMetrics(res, ctx);
  }

  if (path === "/health" && method === "GET") {
    json(res, 200, { status: "ok", policyCount: ctx.store.policyCount, entityCount: ctx.store.entityCount });
    return;
  }

  json(res, 404, { error: "Not Found" });
}

function getPolicies(res: ServerResponse, ctx: AdminContext) {
  json(res, 200, {
    count: ctx.store.policyCount,
    policyText: ctx.store.getPolicyText(),
  });
}

async function addPolicies(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AdminContext,
) {
  const body = await readBody(req);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  const policyText = (parsed as Record<string, unknown>)?.policyText;
  if (typeof policyText !== "string") {
    json(res, 400, { error: "Missing 'policyText' string in body" });
    return;
  }

  // Validate the new policy text
  const validation = checkParsePolicySet({ staticPolicies: policyText });
  if (validation.type === "failure") {
    json(res, 400, {
      error: "Policy parse error",
      messages: validation.errors.map((e) => e.message),
    });
    return;
  }

  const existing = ctx.store.getPolicyText();
  const combined = existing ? `${existing}\n${policyText}` : policyText;
  ctx.store.setPolicies(combined);
  json(res, 200, { added: true, policyCount: ctx.store.policyCount });
}

async function reloadPolicies(res: ServerResponse, ctx: AdminContext) {
  if (!ctx.reloader) {
    json(res, 400, { error: "Hot reload not configured" });
    return;
  }

  const result = await ctx.reloader.reload();
  if (result.success) {
    json(res, 200, {
      reloaded: true,
      policyCount: ctx.store.policyCount,
      entityCount: ctx.store.entityCount,
    });
  } else {
    json(res, 500, { reloaded: false, error: result.error });
  }
}

function getEntities(res: ServerResponse, ctx: AdminContext) {
  const entities = ctx.store.getEntities();
  json(res, 200, { count: entities.length, entities });
}

async function setEntities(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AdminContext,
) {
  const body = await readBody(req);

  let entities: unknown;
  try {
    entities = JSON.parse(body);
  } catch {
    json(res, 400, { error: "Invalid JSON" });
    return;
  }

  if (!Array.isArray(entities)) {
    json(res, 400, { error: "Body must be a JSON array of entities" });
    return;
  }

  ctx.store.setEntities(entities);
  json(res, 200, { updated: true, count: entities.length });
}

function getMetrics(res: ServerResponse, ctx: AdminContext) {
  const body = ctx.metrics.serialize();
  res.writeHead(200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8",
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

class BodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "BodyTooLargeError";
  }
}
