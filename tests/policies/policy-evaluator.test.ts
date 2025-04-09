import { describe, it, expect } from "vitest";
import type { EntityJson } from "@cedar-policy/cedar-wasm";
import { PolicyEvaluator } from "../../src/policies/policy-evaluator.js";
import { ENTITY_TYPES } from "../../src/schema/gateway-schema.js";

function makeEvaluator(policyText: string, entities: EntityJson[] = []) {
  return new PolicyEvaluator(policyText, entities);
}

describe("PolicyEvaluator", () => {
  describe("evaluateAccess", () => {
    it("allows when permit policy matches", () => {
      const evaluator = makeEvaluator(`
        permit(
          principal is Gateway::User,
          action == Action::"access",
          resource
        );
      `);

      const result = evaluator.evaluateAccess(
        { type: ENTITY_TYPES.User, id: "alice" },
        { type: ENTITY_TYPES.Endpoint, id: "GET:/api/users" },
        {},
      );

      expect(result.decision).toBe("allow");
    });

    it("denies when no permit policy matches", () => {
      const evaluator = makeEvaluator(`
        permit(
          principal is Gateway::User,
          action == Action::"access",
          resource
        ) when { principal.role == "admin" };
      `, [{
        uid: { type: ENTITY_TYPES.User, id: "alice" },
        attrs: { role: "viewer" },
        parents: [],
      }]);

      const result = evaluator.evaluateAccess(
        { type: ENTITY_TYPES.User, id: "alice" },
        { type: ENTITY_TYPES.Endpoint, id: "GET:/api/admin" },
        {},
      );

      expect(result.decision).toBe("deny");
    });

    it("forbid overrides permit", () => {
      const evaluator = makeEvaluator(`
        permit(principal, action == Action::"access", resource);
        forbid(principal, action == Action::"access", resource)
          when { context.blocked == true };
      `);

      const result = evaluator.evaluateAccess(
        { type: ENTITY_TYPES.User, id: "alice" },
        { type: ENTITY_TYPES.Endpoint, id: "GET:/api/users" },
        { blocked: true },
      );

      expect(result.decision).toBe("deny");
    });
  });

  describe("evaluateRoute", () => {
    it("allows routing when policy matches", () => {
      const evaluator = makeEvaluator(`
        permit(
          principal,
          action == Action::"route",
          resource == Gateway::Endpoint::"GET:/api/users"
        );
      `);

      const result = evaluator.evaluateRoute(
        { type: ENTITY_TYPES.User, id: "alice" },
        { type: ENTITY_TYPES.Endpoint, id: "GET:/api/users" },
        {},
      );

      expect(result.decision).toBe("allow");
    });

    it("denies routing when no policy matches", () => {
      const evaluator = makeEvaluator(`
        permit(
          principal,
          action == Action::"route",
          resource == Gateway::Endpoint::"GET:/api/users"
        );
      `);

      const result = evaluator.evaluateRoute(
        { type: ENTITY_TYPES.User, id: "alice" },
        { type: ENTITY_TYPES.Endpoint, id: "DELETE:/api/users" },
        {},
      );

      expect(result.decision).toBe("deny");
    });
  });

  describe("evaluateRateLimit", () => {
    it("allows rate limit tier when policy matches", () => {
      const evaluator = makeEvaluator(`
        permit(
          principal,
          action == Action::"ratelimit",
          resource == Gateway::Endpoint::"rate-tier:standard"
        );
      `);

      const result = evaluator.evaluateRateLimit(
        { type: ENTITY_TYPES.User, id: "alice" },
        { type: ENTITY_TYPES.Endpoint, id: "rate-tier:standard" },
        {},
      );

      expect(result.decision).toBe("allow");
    });
  });
});
