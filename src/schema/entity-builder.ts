// ── Entity Builder ───────────────────────────────────────────────────

import type { EntityJson, EntityUid, CedarValueJson, Context } from "@cedar-policy/cedar-wasm";
import type { GatewayRequest } from "../pipeline/types.js";
import { ENTITY_TYPES } from "./gateway-schema.js";

/**
 * Build a Cedar principal entity UID from a gateway request.
 */
export function buildPrincipal(req: GatewayRequest): EntityUid {
  if (req.principal) {
    return req.principal;
  }
  return { type: ENTITY_TYPES.Anonymous, id: "anonymous" };
}

/**
 * Build a Cedar resource entity UID for the request's endpoint.
 * Format: Gateway::Endpoint::"METHOD:/path"
 */
export function buildEndpointUID(method: string, path: string): EntityUid {
  return {
    type: ENTITY_TYPES.Endpoint,
    id: `${method.toUpperCase()}:${path}`,
  };
}

/**
 * Build a Cedar context record from a gateway request.
 */
export function buildContext(req: GatewayRequest): Context {
  const context: Context = {
    method: req.method,
    path: req.path,
    sourceIp: req.sourceIp,
  };

  if (req.tenantId) {
    context["tenantId"] = req.tenantId;
  }

  const userAgent = req.headers["user-agent"];
  if (typeof userAgent === "string") {
    context["userAgent"] = userAgent;
  }

  const origin = req.headers["origin"];
  if (typeof origin === "string") {
    context["origin"] = origin;
  }

  return context;
}

/**
 * Build an Endpoint entity.
 */
export function buildEndpointEntity(
  method: string,
  path: string,
  backend: string,
  service?: EntityUid,
): EntityJson {
  return {
    uid: buildEndpointUID(method, path),
    attrs: { method: method.toUpperCase(), path, backend },
    parents: service ? [service] : [],
  };
}

/**
 * Build a Service entity.
 */
export function buildServiceEntity(
  name: string,
  url: string,
): EntityJson {
  return {
    uid: { type: ENTITY_TYPES.Service, id: name },
    attrs: { name, url },
    parents: [],
  };
}

/**
 * Build a Tenant entity.
 */
export function buildTenantEntity(
  id: string,
  tier: string,
  plan: string,
): EntityJson {
  return {
    uid: { type: ENTITY_TYPES.Tenant, id },
    attrs: { tier, plan },
    parents: [],
  };
}

/**
 * Build a User entity.
 */
export function buildUserEntity(
  id: string,
  role?: string,
  tenant?: EntityUid,
): EntityJson {
  const attrs: Record<string, CedarValueJson> = {};
  if (role) attrs["role"] = role;
  return {
    uid: { type: ENTITY_TYPES.User, id },
    attrs,
    parents: tenant ? [tenant] : [],
  };
}

/**
 * Build a rate limit tier entity.
 */
export function buildRateLimitTierEntity(
  tierId: string,
  config: {
    strategy: "token-bucket" | "sliding-window";
    capacity: number;
    windowMs?: number;
    refillRate?: number;
  },
): EntityJson {
  const attrs: Record<string, CedarValueJson> = {
    path: "",
    method: "",
    backend: "",
    strategy: config.strategy,
    capacity: config.capacity,
  };
  if (config.windowMs !== undefined) attrs["windowMs"] = config.windowMs;
  if (config.refillRate !== undefined) attrs["refillRate"] = config.refillRate;

  return {
    uid: { type: ENTITY_TYPES.Endpoint, id: `rate-tier:${tierId}` },
    attrs,
    parents: [],
  };
}
