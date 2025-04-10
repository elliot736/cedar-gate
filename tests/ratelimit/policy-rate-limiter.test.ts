import { describe, it, expect, afterEach } from "vitest";
import type { EntityJson } from "@cedar-policy/cedar-wasm";
import { PolicyEvaluator } from "../../src/policies/policy-evaluator.js";
import { PolicyRateLimiter } from "../../src/ratelimit/policy-rate-limiter.js";
import { ENTITY_TYPES } from "../../src/schema/gateway-schema.js";
import { buildRateLimitTierEntity, buildTenantEntity } from "../../src/schema/entity-builder.js";

function setup(policyText: string) {
  const standardTier = buildRateLimitTierEntity("standard", {
    strategy: "sliding-window",
    capacity: 5,
    windowMs: 60000,
  });
  const premiumTier = buildRateLimitTierEntity("premium", {
    strategy: "token-bucket",
    capacity: 100,
    refillRate: 10,
  });
  const tenant = buildTenantEntity("acme", "enterprise", "pro");
  const entities: EntityJson[] = [standardTier, premiumTier, tenant];
  const evaluator = new PolicyEvaluator(policyText, entities);
  return { evaluator, entities };
}

describe("PolicyRateLimiter", () => {
  let rateLimiter: PolicyRateLimiter;

  afterEach(() => {
    rateLimiter?.destroy();
  });

  it("resolves the standard tier for regular users", () => {
    const { evaluator, entities } = setup(`
      permit(
        principal,
        action == Action::"ratelimit",
        resource == Gateway::Endpoint::"rate-tier:standard"
      );
    `);

    rateLimiter = new PolicyRateLimiter(["standard", "premium"]);
    const decision = rateLimiter.check(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "alice" },
      {},
      "alice:GET:/api",
    );

    expect(decision).not.toBeNull();
    expect(decision!.tier).toBe("standard");
    expect(decision!.result.allowed).toBe(true);
  });

  it("resolves premium tier for enterprise tenants", () => {
    const policyText = `
      permit(
        principal,
        action == Action::"ratelimit",
        resource == Gateway::Endpoint::"rate-tier:standard"
      );
      permit(
        principal in Gateway::Tenant::"acme",
        action == Action::"ratelimit",
        resource == Gateway::Endpoint::"rate-tier:premium"
      );
    `;

    const standardTier = buildRateLimitTierEntity("standard", {
      strategy: "sliding-window",
      capacity: 5,
      windowMs: 60000,
    });
    const premiumTier = buildRateLimitTierEntity("premium", {
      strategy: "token-bucket",
      capacity: 100,
      refillRate: 10,
    });
    const tenant = buildTenantEntity("acme", "enterprise", "pro");

    // Add user entity that is a member of acme tenant
    const entities: EntityJson[] = [
      standardTier,
      premiumTier,
      tenant,
      {
        uid: { type: ENTITY_TYPES.User, id: "bob" },
        attrs: {},
        parents: [{ type: ENTITY_TYPES.Tenant, id: "acme" }],
      },
    ];

    const evaluator = new PolicyEvaluator(policyText, entities);

    rateLimiter = new PolicyRateLimiter(["standard", "premium"]);
    const decision = rateLimiter.check(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "bob" },
      {},
      "bob:GET:/api",
    );

    expect(decision).not.toBeNull();
    expect(decision!.tier).toBe("premium");
    expect(decision!.result.allowed).toBe(true);
  });

  it("enforces rate limits", () => {
    const { evaluator, entities } = setup(`
      permit(
        principal,
        action == Action::"ratelimit",
        resource == Gateway::Endpoint::"rate-tier:standard"
      );
    `);

    rateLimiter = new PolicyRateLimiter(["standard", "premium"]);
    const key = "alice:GET:/api";

    // Standard tier has capacity 5
    for (let i = 0; i < 5; i++) {
      const d = rateLimiter.check(evaluator, entities, { type: ENTITY_TYPES.User, id: "alice" }, {}, key);
      expect(d!.result.allowed).toBe(true);
    }

    const d = rateLimiter.check(evaluator, entities, { type: ENTITY_TYPES.User, id: "alice" }, {}, key);
    expect(d!.result.allowed).toBe(false);
  });

  it("returns null when no tier matches", () => {
    const { evaluator, entities } = setup(`
      permit(
        principal,
        action == Action::"access",
        resource
      );
    `);

    rateLimiter = new PolicyRateLimiter(["standard", "premium"]);
    const decision = rateLimiter.check(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "alice" },
      {},
      "alice:GET:/api",
    );

    expect(decision).toBeNull();
  });
});
