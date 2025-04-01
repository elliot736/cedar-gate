// ── Cedar Schema for Gateway ─────────────────────────────────────────

import type { EntityUid, SchemaJson } from "@cedar-policy/cedar-wasm";

/**
 * The Cedar schema defining entity types and actions for the gateway.
 *
 * Entity hierarchy:
 *   User -> Tenant
 *   ApiKey -> Tenant
 *   Endpoint -> Service
 *
 * Actions:
 *   access    — is this request allowed?
 *   route     — which backend handles this request?
 *   ratelimit — which rate limit tier applies?
 */
export const GATEWAY_SCHEMA: SchemaJson<string> = {
  "Gateway": {
    entityTypes: {
      User: {
        memberOfTypes: ["Tenant"],
        shape: {
          type: "Record",
          attributes: {
            role: { type: "String", required: false },
            tenantId: { type: "String", required: false },
          },
        },
      },
      ApiKey: {
        memberOfTypes: ["Tenant"],
        shape: {
          type: "Record",
          attributes: {
            tenantId: { type: "String", required: true },
            scopes: {
              type: "Set",
              element: { type: "String" },
              required: false,
            },
          },
        },
      },
      Tenant: {
        shape: {
          type: "Record",
          attributes: {
            tier: { type: "String", required: true },
            plan: { type: "String", required: true },
          },
        },
      },
      Anonymous: {
        shape: {
          type: "Record",
          attributes: {},
        },
      },
      Endpoint: {
        memberOfTypes: ["Service"],
        shape: {
          type: "Record",
          attributes: {
            path: { type: "String", required: true },
            method: { type: "String", required: true },
            backend: { type: "String", required: true },
          },
        },
      },
      Service: {
        shape: {
          type: "Record",
          attributes: {
            name: { type: "String", required: true },
            url: { type: "String", required: true },
          },
        },
      },
    },
    actions: {
      access: {
        appliesTo: {
          principalTypes: ["User", "ApiKey", "Anonymous", "Tenant"],
          resourceTypes: ["Endpoint", "Service"],
        },
      },
      route: {
        appliesTo: {
          principalTypes: ["User", "ApiKey", "Anonymous", "Tenant"],
          resourceTypes: ["Endpoint", "Service"],
        },
      },
      ratelimit: {
        appliesTo: {
          principalTypes: ["User", "ApiKey", "Anonymous", "Tenant"],
          resourceTypes: ["Endpoint", "Service"],
        },
      },
    },
  },
};

/** Gateway action entity UIDs */
export const ACTIONS: Record<string, EntityUid> = {
  access: { type: "Action", id: "access" },
  route: { type: "Action", id: "route" },
  ratelimit: { type: "Action", id: "ratelimit" },
} as const;

/** Entity type constants */
export const ENTITY_TYPES = {
  User: "Gateway::User",
  ApiKey: "Gateway::ApiKey",
  Tenant: "Gateway::Tenant",
  Anonymous: "Gateway::Anonymous",
  Endpoint: "Gateway::Endpoint",
  Service: "Gateway::Service",
} as const;
