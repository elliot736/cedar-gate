import { describe, it, expect } from "vitest";
import type { IncomingMessage } from "node:http";
import {
  buildPrincipal,
  buildEndpointUID,
  buildContext,
  buildEndpointEntity,
  buildServiceEntity,
  buildTenantEntity,
  buildUserEntity,
  buildRateLimitTierEntity,
} from "../../src/schema/entity-builder.js";
import { ENTITY_TYPES } from "../../src/schema/gateway-schema.js";
import type { GatewayRequest } from "../../src/pipeline/types.js";

function makeRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    raw: {} as IncomingMessage,
    id: "test-123",
    method: "GET",
    path: "/api/users",
    query: {},
    headers: {},
    sourceIp: "127.0.0.1",
    startTime: 0n,
    ...overrides,
  } as GatewayRequest;
}

describe("buildPrincipal", () => {
  it("returns the request principal when set", () => {
    const principal = { type: ENTITY_TYPES.User, id: "alice" };
    const req = makeRequest({ principal });
    expect(buildPrincipal(req)).toEqual(principal);
  });

  it("returns Anonymous when no principal is set", () => {
    const req = makeRequest();
    expect(buildPrincipal(req)).toEqual({
      type: ENTITY_TYPES.Anonymous,
      id: "anonymous",
    });
  });
});

describe("buildEndpointUID", () => {
  it("creates a UID with METHOD:path format", () => {
    const uid = buildEndpointUID("GET", "/api/users");
    expect(uid).toEqual({
      type: ENTITY_TYPES.Endpoint,
      id: "GET:/api/users",
    });
  });

  it("uppercases the method", () => {
    const uid = buildEndpointUID("post", "/api/users");
    expect(uid.id).toBe("POST:/api/users");
  });
});

describe("buildContext", () => {
  it("includes method, path, and sourceIp", () => {
    const req = makeRequest({ method: "POST", path: "/api/data", sourceIp: "10.0.0.1" });
    const ctx = buildContext(req);
    expect(ctx["method"]).toBe("POST");
    expect(ctx["path"]).toBe("/api/data");
    expect(ctx["sourceIp"]).toBe("10.0.0.1");
  });

  it("includes tenantId when present", () => {
    const req = makeRequest({ tenantId: "acme" });
    const ctx = buildContext(req);
    expect(ctx["tenantId"]).toBe("acme");
  });

  it("omits tenantId when not present", () => {
    const req = makeRequest();
    const ctx = buildContext(req);
    expect(ctx["tenantId"]).toBeUndefined();
  });
});

describe("entity builders", () => {
  it("builds endpoint entity", () => {
    const service = { type: ENTITY_TYPES.Service, id: "api" };
    const entity = buildEndpointEntity("GET", "/users", "http://localhost:3000", service);
    expect(entity.uid.type).toBe(ENTITY_TYPES.Endpoint);
    expect(entity.uid.id).toBe("GET:/users");
    expect(entity.attrs["backend"]).toBe("http://localhost:3000");
    expect(entity.parents).toEqual([service]);
  });

  it("builds service entity", () => {
    const entity = buildServiceEntity("api", "http://localhost:3000");
    expect(entity.uid).toEqual({ type: ENTITY_TYPES.Service, id: "api" });
    expect(entity.attrs["url"]).toBe("http://localhost:3000");
    expect(entity.parents).toEqual([]);
  });

  it("builds tenant entity", () => {
    const entity = buildTenantEntity("acme", "enterprise", "pro");
    expect(entity.uid).toEqual({ type: ENTITY_TYPES.Tenant, id: "acme" });
    expect(entity.attrs["tier"]).toBe("enterprise");
    expect(entity.attrs["plan"]).toBe("pro");
  });

  it("builds user entity with tenant parent", () => {
    const tenant = { type: ENTITY_TYPES.Tenant, id: "acme" };
    const entity = buildUserEntity("alice", "admin", tenant);
    expect(entity.uid).toEqual({ type: ENTITY_TYPES.User, id: "alice" });
    expect(entity.attrs["role"]).toBe("admin");
    expect(entity.parents).toEqual([tenant]);
  });

  it("builds rate limit tier entity", () => {
    const entity = buildRateLimitTierEntity("standard", {
      strategy: "sliding-window",
      capacity: 100,
      windowMs: 60000,
    });
    expect(entity.uid.id).toBe("rate-tier:standard");
    expect(entity.attrs["strategy"]).toBe("sliding-window");
    expect(entity.attrs["capacity"]).toBe(100);
    expect(entity.attrs["windowMs"]).toBe(60000);
  });
});
