// ── Policy Store ─────────────────────────────────────────────────────

import type { EntityJson } from "@cedar-policy/cedar-wasm";

export type ChangeListener = () => void;

/**
 * Manages Cedar policy text and entities with atomic swap semantics.
 *
 * The store holds policy source text and an entity array. On hot-reload,
 * both are atomically replaced. In-flight requests that captured the
 * previous snapshot continue with old policies; new requests pick up
 * the new ones. No locks needed — single-threaded event loop guarantees
 * atomic reference swaps.
 */
export class PolicyStore {
  private policyText: string;
  private entities: EntityJson[];
  private listeners: Set<ChangeListener> = new Set();

  constructor(policyText: string = "", entities: EntityJson[] = []) {
    this.policyText = policyText;
    this.entities = entities;
  }

  /**
   * Get a snapshot of the current policy text.
   * Callers should capture this for the duration of a request.
   */
  getPolicyText(): string {
    return this.policyText;
  }

  /**
   * Get a snapshot of the current entities.
   */
  getEntities(): EntityJson[] {
    return this.entities;
  }

  /**
   * Atomically replace all policies.
   */
  setPolicies(policyText: string): void {
    this.policyText = policyText;
    this.notifyListeners();
  }

  /**
   * Atomically replace all entities.
   */
  setEntities(entities: EntityJson[]): void {
    this.entities = entities;
    this.notifyListeners();
  }

  /**
   * Atomically replace both policies and entities.
   */
  update(policyText: string, entities: EntityJson[]): void {
    this.policyText = policyText;
    this.entities = entities;
    this.notifyListeners();
  }

  /**
   * Subscribe to policy/entity changes. Returns an unsubscribe function.
   */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get policyCount(): number {
    // Count policies by splitting on permit/forbid keywords
    const matches = this.policyText.match(/\b(permit|forbid)\s*\(/g);
    return matches ? matches.length : 0;
  }

  get entityCount(): number {
    return this.entities.length;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
