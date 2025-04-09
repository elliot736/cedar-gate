import { describe, it, expect, vi } from "vitest";
import { PolicyStore } from "../../src/policies/policy-store.js";
import { PolicyEvaluator } from "../../src/policies/policy-evaluator.js";

describe("PolicyStore", () => {
  it("starts empty", () => {
    const store = new PolicyStore();
    expect(store.policyCount).toBe(0);
    expect(store.entityCount).toBe(0);
  });

  it("initializes with policies", () => {
    const store = new PolicyStore('permit(principal, action, resource);');
    expect(store.policyCount).toBe(1);
  });

  it("setPolicies atomically replaces policies", () => {
    const store = new PolicyStore('permit(principal, action, resource);');
    const textBefore = store.getPolicyText();

    store.setPolicies('forbid(principal, action, resource);');
    const textAfter = store.getPolicyText();

    expect(store.policyCount).toBe(1);
    expect(textBefore).not.toBe(textAfter);
  });

  it("setEntities atomically replaces entities", () => {
    const store = new PolicyStore();
    store.setEntities([{
      uid: { type: "Gateway::Service", id: "api" },
      attrs: { name: "api", url: "http://localhost" },
      parents: [],
    }]);
    expect(store.entityCount).toBe(1);
  });

  it("update replaces both policies and entities", () => {
    const store = new PolicyStore();
    store.update(
      'permit(principal, action, resource);',
      [{
        uid: { type: "Gateway::Service", id: "api" },
        attrs: { name: "api", url: "http://localhost" },
        parents: [],
      }],
    );
    expect(store.policyCount).toBe(1);
    expect(store.entityCount).toBe(1);
  });

  it("onChange notifies listeners on setPolicies", () => {
    const store = new PolicyStore();
    const listener = vi.fn();
    store.onChange(listener);

    store.setPolicies('permit(principal, action, resource);');
    expect(listener).toHaveBeenCalledOnce();
  });

  it("onChange returns an unsubscribe function", () => {
    const store = new PolicyStore();
    const listener = vi.fn();
    const unsub = store.onChange(listener);

    unsub();
    store.setPolicies('permit(principal, action, resource);');
    expect(listener).not.toHaveBeenCalled();
  });

  it("in-flight request uses old policy snapshot after reload", () => {
    const permitText = 'permit(principal, action, resource);';
    const forbidText = 'forbid(principal, action, resource);';
    const store = new PolicyStore(permitText);

    // Simulate capturing policy text for an in-flight request
    const capturedText = store.getPolicyText();
    const capturedEntities = store.getEntities();

    // Reload with new policies
    store.setPolicies(forbidText);

    // The captured snapshot should still allow (old policies)
    const oldEvaluator = new PolicyEvaluator(capturedText, capturedEntities);
    const result = oldEvaluator.evaluateAccess(
      { type: "User", id: "test" },
      { type: "Endpoint", id: "test" },
      {},
    );
    expect(result.decision).toBe("allow");

    // The new snapshot should deny
    const newEvaluator = new PolicyEvaluator(store.getPolicyText(), store.getEntities());
    const newResult = newEvaluator.evaluateAccess(
      { type: "User", id: "test" },
      { type: "Endpoint", id: "test" },
      {},
    );
    expect(newResult.decision).toBe("deny");
  });
});
