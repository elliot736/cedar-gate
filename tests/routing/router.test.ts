import { describe, it, expect } from "vitest";
import type { EntityJson } from "@cedar-policy/cedar-wasm";
import { PolicyEvaluator } from "../../src/policies/policy-evaluator.js";
import { resolveRoute } from "../../src/routing/router.js";
import { ENTITY_TYPES } from "../../src/schema/gateway-schema.js";
import { buildEndpointEntity, buildServiceEntity } from "../../src/schema/entity-builder.js";

function setup(policyText: string) {
  const service = buildServiceEntity("api", "http://localhost:3001");
  const endpoint = buildEndpointEntity("GET", "/api/users", "http://localhost:3001", service.uid);

  const entities: EntityJson[] = [service, endpoint];
  const evaluator = new PolicyEvaluator(policyText, entities);

  return { evaluator, entities };
}

describe("resolveRoute", () => {
  it("resolves a route when policy permits", () => {
    const { evaluator, entities } = setup(`
      permit(
        principal,
        action == Action::"route",
        resource == Gateway::Endpoint::"GET:/api/users"
      );
    `);

    const route = resolveRoute(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "alice" },
      "GET",
      "/api/users",
      {},
    );

    expect(route).not.toBeNull();
    expect(route!.backend.url).toBe("http://localhost:3001");
    expect(route!.matchedPolicies.length).toBeGreaterThan(0);
  });

  it("returns null when no policy permits", () => {
    const { evaluator, entities } = setup(`
      permit(
        principal,
        action == Action::"route",
        resource == Gateway::Endpoint::"GET:/api/users"
      );
    `);

    const route = resolveRoute(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "alice" },
      "DELETE",
      "/api/users",
      {},
    );

    expect(route).toBeNull();
  });

  it("resolves routes via service hierarchy", () => {
    const service = buildServiceEntity("api", "http://localhost:3001");
    const endpoint = buildEndpointEntity("POST", "/api/data", "http://localhost:3001", service.uid);
    const entities: EntityJson[] = [service, endpoint];

    const policyText = `
      permit(
        principal,
        action == Action::"route",
        resource in Gateway::Service::"api"
      );
    `;
    const evaluator = new PolicyEvaluator(policyText, entities);

    const route = resolveRoute(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "alice" },
      "POST",
      "/api/data",
      {},
    );

    expect(route).not.toBeNull();
    expect(route!.backend.url).toBe("http://localhost:3001");
  });
});
