// ── Policy Rate Limiter ──────────────────────────────────────────────

import type { EntityUid, EntityJson, Context } from "@cedar-policy/cedar-wasm";
import type { PolicyEvaluator } from "../policies/policy-evaluator.js";
import { ENTITY_TYPES } from "../schema/gateway-schema.js";
import { entityUidEquals } from "../schema/entity-uid.js";
import { LimiterRegistry, type RateLimitTierConfig } from "./limiter-registry.js";
import type { RateLimitResult } from "./strategies.js";

export interface RateLimitDecision {
  result: RateLimitResult;
  tier: string;
}

/**
 * Resolves rate limit configuration from Cedar policies and applies
 * the appropriate limiter.
 */
export class PolicyRateLimiter {
  private registry: LimiterRegistry;
  private tiers: string[];

  constructor(tiers: string[] = ["standard", "premium"]) {
    this.registry = new LimiterRegistry();
    this.tiers = tiers;
  }

  check(
    evaluator: PolicyEvaluator,
    entities: EntityJson[],
    principal: EntityUid,
    context: Context,
    rateLimitKey: string,
  ): RateLimitDecision | null {
    let matchedTier: string | null = null;
    let matchedConfig: RateLimitTierConfig | null = null;

    for (let i = this.tiers.length - 1; i >= 0; i--) {
      const tier = this.tiers[i]!;
      const tierEntityUID: EntityUid = {
        type: ENTITY_TYPES.Endpoint,
        id: `rate-tier:${tier}`,
      };

      const result = evaluator.evaluateRateLimit(principal, tierEntityUID, context);

      if (result.decision === "allow") {
        const tierEntity = entities.find((e) => entityUidEquals(e.uid, tierEntityUID));
        if (!tierEntity) continue;

        const config = extractTierConfig(tierEntity.attrs);
        if (config) {
          matchedTier = tier;
          matchedConfig = config;
          break;
        }
      }
    }

    if (!matchedTier || !matchedConfig) {
      return null;
    }

    const limiter = this.registry.get(matchedConfig);
    const result = limiter.consume(rateLimitKey);

    return { result, tier: matchedTier };
  }

  destroy(): void {
    this.registry.destroy();
  }
}

function extractTierConfig(
  attrs: Record<string, unknown>,
): RateLimitTierConfig | null {
  const strategy = attrs["strategy"];
  const capacity = attrs["capacity"];

  if (typeof strategy !== "string" || typeof capacity !== "number") {
    return null;
  }

  if (strategy !== "token-bucket" && strategy !== "sliding-window") {
    return null;
  }

  const config: RateLimitTierConfig = { strategy, capacity };

  const windowMs = attrs["windowMs"];
  if (typeof windowMs === "number") config.windowMs = windowMs;

  const refillRate = attrs["refillRate"];
  if (typeof refillRate === "number") config.refillRate = refillRate;

  return config;
}
