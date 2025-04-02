// ── Entity UID Utilities ─────────────────────────────────────────────

import type { EntityUidJson, TypeAndId } from "@cedar-policy/cedar-wasm";

/**
 * Normalize an EntityUidJson (which can be { type, id } or { __entity: { type, id } })
 * into a simple { type, id } form.
 */
export function normalizeEntityUid(uid: EntityUidJson): TypeAndId {
  if ("__entity" in uid) {
    return uid.__entity;
  }
  return uid;
}

/**
 * Compare two EntityUidJson values for equality.
 */
export function entityUidEquals(a: EntityUidJson, b: EntityUidJson): boolean {
  const na = normalizeEntityUid(a);
  const nb = normalizeEntityUid(b);
  return na.type === nb.type && na.id === nb.id;
}
