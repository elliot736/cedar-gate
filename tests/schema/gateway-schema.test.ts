import { describe, it, expect } from "vitest";
import { GATEWAY_SCHEMA, ACTIONS, ENTITY_TYPES } from "../../src/schema/gateway-schema.js";

describe("GATEWAY_SCHEMA", () => {
  it("uses the Gateway namespace", () => {
    expect(GATEWAY_SCHEMA).toHaveProperty("Gateway");
  });

  const schema = () => GATEWAY_SCHEMA["Gateway"]!;

  describe("entity types", () => {
    it("defines all expected entity types", () => {
      const types = Object.keys(schema().entityTypes);
      expect(types).toContain("User");
      expect(types).toContain("ApiKey");
      expect(types).toContain("Tenant");
      expect(types).toContain("Anonymous");
      expect(types).toContain("Endpoint");
      expect(types).toContain("Service");
    });

    it("defines exactly 6 entity types", () => {
      expect(Object.keys(schema().entityTypes)).toHaveLength(6);
    });

    describe("User", () => {
      it("has role and tenantId attributes", () => {
        const user = schema().entityTypes.User!;
        const attrs = user.shape.attributes;
        expect(attrs).toHaveProperty("role");
        expect(attrs).toHaveProperty("tenantId");
      });

      it("is a member of Tenant", () => {
        expect(schema().entityTypes.User!.memberOfTypes).toContain("Tenant");
      });

      it("has optional role attribute", () => {
        const role = schema().entityTypes.User!.shape.attributes.role;
        expect(role!.required).toBe(false);
      });
    });

    describe("ApiKey", () => {
      it("has tenantId as required", () => {
        const apiKey = schema().entityTypes.ApiKey!;
        expect(apiKey.shape.attributes.tenantId!.required).toBe(true);
      });

      it("has scopes as an optional Set of Strings", () => {
        const scopes = schema().entityTypes.ApiKey!.shape.attributes.scopes;
        expect(scopes!.required).toBe(false);
        expect(scopes!.type).toBe("Set");
      });

      it("is a member of Tenant", () => {
        expect(schema().entityTypes.ApiKey!.memberOfTypes).toContain("Tenant");
      });
    });

    describe("Tenant", () => {
      it("has tier and plan as required attributes", () => {
        const tenant = schema().entityTypes.Tenant!;
        expect(tenant.shape.attributes.tier!.required).toBe(true);
        expect(tenant.shape.attributes.plan!.required).toBe(true);
      });

      it("has no parent types", () => {
        expect(schema().entityTypes.Tenant!.memberOfTypes).toBeUndefined();
      });
    });

    describe("Anonymous", () => {
      it("has no attributes", () => {
        const anon = schema().entityTypes.Anonymous!;
        expect(Object.keys(anon.shape.attributes)).toHaveLength(0);
      });
    });

    describe("Endpoint", () => {
      it("has path, method, and backend as required attributes", () => {
        const endpoint = schema().entityTypes.Endpoint!;
        expect(endpoint.shape.attributes.path!.required).toBe(true);
        expect(endpoint.shape.attributes.method!.required).toBe(true);
        expect(endpoint.shape.attributes.backend!.required).toBe(true);
      });

      it("is a member of Service", () => {
        expect(schema().entityTypes.Endpoint!.memberOfTypes).toContain("Service");
      });
    });

    describe("Service", () => {
      it("has name and url as required attributes", () => {
        const service = schema().entityTypes.Service!;
        expect(service.shape.attributes.name!.required).toBe(true);
        expect(service.shape.attributes.url!.required).toBe(true);
      });
    });
  });

  describe("actions", () => {
    it("defines access, route, and ratelimit actions", () => {
      const actions = Object.keys(schema().actions);
      expect(actions).toContain("access");
      expect(actions).toContain("route");
      expect(actions).toContain("ratelimit");
    });

    it("defines exactly 3 actions", () => {
      expect(Object.keys(schema().actions)).toHaveLength(3);
    });

    for (const actionName of ["access", "route", "ratelimit"] as const) {
      describe(`action: ${actionName}`, () => {
        it("applies to User, ApiKey, Anonymous, and Tenant as principals", () => {
          const action = schema().actions[actionName]!;
          const principals = action.appliesTo!.principalTypes;
          expect(principals).toContain("User");
          expect(principals).toContain("ApiKey");
          expect(principals).toContain("Anonymous");
          expect(principals).toContain("Tenant");
        });

        it("applies to Endpoint and Service as resources", () => {
          const action = schema().actions[actionName]!;
          const resources = action.appliesTo!.resourceTypes;
          expect(resources).toContain("Endpoint");
          expect(resources).toContain("Service");
        });
      });
    }
  });
});

describe("ACTIONS", () => {
  it("has access action UID", () => {
    expect(ACTIONS.access).toEqual({ type: "Action", id: "access" });
  });

  it("has route action UID", () => {
    expect(ACTIONS.route).toEqual({ type: "Action", id: "route" });
  });

  it("has ratelimit action UID", () => {
    expect(ACTIONS.ratelimit).toEqual({ type: "Action", id: "ratelimit" });
  });
});

describe("ENTITY_TYPES", () => {
  it("maps entity names to namespaced types", () => {
    expect(ENTITY_TYPES.User).toBe("Gateway::User");
    expect(ENTITY_TYPES.ApiKey).toBe("Gateway::ApiKey");
    expect(ENTITY_TYPES.Tenant).toBe("Gateway::Tenant");
    expect(ENTITY_TYPES.Anonymous).toBe("Gateway::Anonymous");
    expect(ENTITY_TYPES.Endpoint).toBe("Gateway::Endpoint");
    expect(ENTITY_TYPES.Service).toBe("Gateway::Service");
  });

  it("has exactly 6 entries", () => {
    expect(Object.keys(ENTITY_TYPES)).toHaveLength(6);
  });
});
