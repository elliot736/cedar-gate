// ── Access Control Evaluator ─────────────────────────────────────────

import type { EntityUid, Context } from "@cedar-policy/cedar-wasm";
import type { PolicyEvaluator } from "../policies/policy-evaluator.js";

export interface AccessResult {
  allowed: boolean;
  reasons: string[];
}

/**
 * Evaluates Cedar access control policies for incoming requests.
 */
export function evaluateAccess(
  evaluator: PolicyEvaluator,
  principal: EntityUid,
  resource: EntityUid,
  context: Context,
): AccessResult {
  const result = evaluator.evaluateAccess(principal, resource, context);
  return {
    allowed: result.decision === "allow",
    reasons: result.reasons,
  };
}
