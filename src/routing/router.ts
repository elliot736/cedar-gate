// ── Policy-Driven Router ─────────────────────────────────────────────

import type { EntityUid, EntityJson, Context } from "@cedar-policy/cedar-wasm";
import type { PolicyEvaluator } from "../policies/policy-evaluator.js";
import { buildEndpointUID } from "../schema/entity-builder.js";
import { entityUidEquals } from "../schema/entity-uid.js";

export interface BackendTarget {
  url: string;
  timeout?: number;
}

export interface ResolvedRoute {
  backend: BackendTarget;
  endpoint: EntityUid;
  matchedPolicies: string[];
}

/**
 * Resolve a route by evaluating Cedar routing policies.
 */
export function resolveRoute(
  evaluator: PolicyEvaluator,
  entities: EntityJson[],
  principal: EntityUid,
  method: string,
  path: string,
  context: Context,
): ResolvedRoute | null {
  const endpointUID = buildEndpointUID(method, path);
  const result = evaluator.evaluateRoute(principal, endpointUID, context);

  if (result.decision !== "allow") {
    return null;
  }

  // Find the endpoint entity to get the backend URL
  const entity = entities.find((e) => entityUidEquals(e.uid, endpointUID));
  if (!entity) {
    return null;
  }

  const backend = entity.attrs["backend"];
  if (typeof backend !== "string") {
    return null;
  }

  return {
    backend: { url: backend },
    endpoint: endpointUID,
    matchedPolicies: result.reasons,
  };
}
