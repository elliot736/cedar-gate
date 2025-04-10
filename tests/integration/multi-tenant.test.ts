import { describe, it, expect, afterEach } from "vitest";
import type { EntityJson } from "@cedar-policy/cedar-wasm";
import { PolicyEvaluator } from "../../src/policies/policy-evaluator.js";
import { PolicyRateLimiter } from "../../src/ratelimit/policy-rate-limiter.js";
import { evaluateAccess } from "../../src/authz/access-evaluator.js";
import { ENTITY_TYPES } from "../../src/schema/gateway-schema.js";
import { buildTenantEntity, buildRateLimitTierEntity, buildUserEntity } from "../../src/schema/entity-builder.js";

function setup() {
  const policyText = `
    // Acme users can access premium endpoints
    permit(
      principal in Gateway::Tenant::"acme",
      action == Action::"access",
      resource
    );

    // Startup users can access basic endpoints
    permit(
      principal in Gateway::Tenant::"startup",
      action == Action::"access",
      resource
    );

    // Everyone gets standard rate limit
    permit(
      principal,
      action == Action::"ratelimit",
      resource == Gateway::Endpoint::"rate-tier:standard"
    );

    // Acme gets premium rate limit
    permit(
      principal in Gateway::Tenant::"acme",
      action == Action::"ratelimit",
      resource == Gateway::Endpoint::"rate-tier:premium"
    );
  `;

  const entities: EntityJson[] = [
    buildTenantEntity("acme", "enterprise", "pro"),
    buildTenantEntity("startup", "standard", "starter"),
    buildUserEntity("alice", "admin", { type: ENTITY_TYPES.Tenant, id: "acme" }),
    buildUserEntity("bob", "viewer", { type: ENTITY_TYPES.Tenant, id: "startup" }),
    buildRateLimitTierEntity("standard", {
      strategy: "sliding-window",
      capacity: 3,
      windowMs: 60000,
    }),
    buildRateLimitTierEntity("premium", {
      strategy: "token-bucket",
      capacity: 100,
      refillRate: 10,
    }),
  ];

  const evaluator = new PolicyEvaluator(policyText, entities);

  return { evaluator, entities };
}

describe("Multi-tenant isolation", () => {
  let rateLimiter: PolicyRateLimiter;

  afterEach(() => {
    rateLimiter?.destroy();
  });

  it("isolates access control by tenant", () => {
    const { evaluator } = setup();

    // Alice (acme tenant) has access
    const aliceAccess = evaluateAccess(
      evaluator,
      { type: ENTITY_TYPES.User, id: "alice" },
      { type: ENTITY_TYPES.Endpoint, id: "GET:/api/data" },
      {},
    );
    expect(aliceAccess.allowed).toBe(true);

    // Bob (startup tenant) also has access
    const bobAccess = evaluateAccess(
      evaluator,
      { type: ENTITY_TYPES.User, id: "bob" },
      { type: ENTITY_TYPES.Endpoint, id: "GET:/api/data" },
      {},
    );
    expect(bobAccess.allowed).toBe(true);

    // Unknown user has no access
    const unknownAccess = evaluateAccess(
      evaluator,
      { type: ENTITY_TYPES.User, id: "eve" },
      { type: ENTITY_TYPES.Endpoint, id: "GET:/api/data" },
      {},
    );
    expect(unknownAccess.allowed).toBe(false);
  });

  it("applies different rate limit tiers per tenant", () => {
    const { evaluator, entities } = setup();
    rateLimiter = new PolicyRateLimiter(["standard", "premium"]);

    // Alice (acme/enterprise) gets premium tier
    const aliceDecision = rateLimiter.check(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "alice" },
      {},
      "acme:GET:/api",
    );
    expect(aliceDecision).not.toBeNull();
    expect(aliceDecision!.tier).toBe("premium");
    expect(aliceDecision!.result.limit).toBe(100);

    // Bob (startup/standard) gets standard tier
    const bobDecision = rateLimiter.check(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "bob" },
      {},
      "startup:GET:/api",
    );
    expect(bobDecision).not.toBeNull();
    expect(bobDecision!.tier).toBe("standard");
    expect(bobDecision!.result.limit).toBe(3);
  });

  it("rate limits are isolated between tenants", () => {
    const { evaluator, entities } = setup();
    rateLimiter = new PolicyRateLimiter(["standard", "premium"]);

    // Exhaust Bob's rate limit (standard tier, capacity 3)
    for (let i = 0; i < 3; i++) {
      rateLimiter.check(evaluator, entities, { type: ENTITY_TYPES.User, id: "bob" }, {}, "startup:GET:/api");
    }

    // Bob should be rate limited
    const bobLimited = rateLimiter.check(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "bob" },
      {},
      "startup:GET:/api",
    );
    expect(bobLimited!.result.allowed).toBe(false);

    // Alice should NOT be rate limited (different tier AND key)
    const aliceOk = rateLimiter.check(
      evaluator,
      entities,
      { type: ENTITY_TYPES.User, id: "alice" },
      {},
      "acme:GET:/api",
    );
    expect(aliceOk!.result.allowed).toBe(true);
  });
});
