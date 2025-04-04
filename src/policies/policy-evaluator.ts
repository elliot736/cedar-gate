// ── Policy Evaluator ─────────────────────────────────────────────────

import {
  isAuthorized,
  type AuthorizationAnswer,
  type EntityJson,
  type EntityUid,
  type Context,
} from "@cedar-policy/cedar-wasm";
import { ACTIONS } from "../schema/gateway-schema.js";

export type GatewayAction = "access" | "route" | "ratelimit";

export interface EvaluationResult {
  decision: "allow" | "deny";
  reasons: string[];
}

/**
 * Gateway-specific wrapper around the Cedar WASM authorization engine.
 * Evaluates requests for each of the three gateway actions.
 */
export class PolicyEvaluator {
  constructor(
    private policyText: string,
    private entities: EntityJson[],
  ) {}

  evaluateAccess(
    principal: EntityUid,
    resource: EntityUid,
    context: Context,
  ): EvaluationResult {
    return this.evaluate("access", principal, resource, context);
  }

  evaluateRoute(
    principal: EntityUid,
    resource: EntityUid,
    context: Context,
  ): EvaluationResult {
    return this.evaluate("route", principal, resource, context);
  }

  evaluateRateLimit(
    principal: EntityUid,
    resource: EntityUid,
    context: Context,
  ): EvaluationResult {
    return this.evaluate("ratelimit", principal, resource, context);
  }

  private evaluate(
    action: GatewayAction,
    principal: EntityUid,
    resource: EntityUid,
    context: Context,
  ): EvaluationResult {
    const actionUid = ACTIONS[action]!;
    const answer: AuthorizationAnswer = isAuthorized({
      principal,
      action: actionUid,
      resource,
      context,
      policies: { staticPolicies: this.policyText },
      entities: this.entities,
    });

    if (answer.type === "failure") {
      return { decision: "deny", reasons: [] };
    }

    return {
      decision: answer.response.decision,
      reasons: answer.response.diagnostics.reason,
    };
  }
}
