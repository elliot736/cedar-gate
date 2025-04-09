import { describe, it, expect } from "vitest";
import type { EntityJson } from "@cedar-policy/cedar-wasm";
import { PolicyEvaluator } from "../../src/policies/policy-evaluator.js";
import { evaluateAccess } from "../../src/authz/access-evaluator.js";
import { ENTITY_TYPES } from "../../src/schema/gateway-schema.js";

function makeEvaluator(policyText: string, entities: EntityJson[] = []) {
  return new PolicyEvaluator(policyText, entities);
}

describe("evaluateAccess", () => {
  it("returns allowed: true with matching reasons", () => {
    const evaluator = makeEvaluator('permit(principal, action == Action::"access", resource);');
    const result = evaluateAccess(
      evaluator,
      { type: ENTITY_TYPES.User, id: "alice" },
      { type: ENTITY_TYPES.Endpoint, id: "test" },
      {},
    );
    expect(result.allowed).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("returns allowed: false when denied", () => {
    const evaluator = makeEvaluator('forbid(principal, action == Action::"access", resource);');
    const result = evaluateAccess(
      evaluator,
      { type: ENTITY_TYPES.User, id: "alice" },
      { type: ENTITY_TYPES.Endpoint, id: "test" },
      {},
    );
    expect(result.allowed).toBe(false);
  });

  it("respects entity hierarchy for tenant-scoped access", () => {
    const tenant = { type: ENTITY_TYPES.Tenant, id: "acme" };
    const evaluator = makeEvaluator(
      `permit(
        principal in Gateway::Tenant::"acme",
        action == Action::"access",
        resource
      );`,
      [
        { uid: tenant, attrs: { tier: "enterprise", plan: "pro" }, parents: [] },
        { uid: { type: ENTITY_TYPES.User, id: "alice" }, attrs: {}, parents: [tenant] },
      ],
    );

    const allowed = evaluateAccess(
      evaluator,
      { type: ENTITY_TYPES.User, id: "alice" },
      { type: ENTITY_TYPES.Endpoint, id: "test" },
      {},
    );
    expect(allowed.allowed).toBe(true);

    // User not in tenant should be denied
    const denied = evaluateAccess(
      evaluator,
      { type: ENTITY_TYPES.User, id: "bob" },
      { type: ENTITY_TYPES.Endpoint, id: "test" },
      {},
    );
    expect(denied.allowed).toBe(false);
  });
});
