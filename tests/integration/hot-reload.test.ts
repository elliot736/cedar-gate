import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HotReloader } from "../../src/policies/hot-reload.js";
import { PolicyStore } from "../../src/policies/policy-store.js";

function makeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

const VALID_CEDAR_A = `permit(principal, action, resource);`;
const VALID_CEDAR_B = `forbid(principal, action, resource);`;
const INVALID_CEDAR = `this is not valid cedar policy syntax %%%`;

/**
 * Helper: wait for the store to change or a timeout, whichever comes first.
 */
function waitForStoreChange(
  store: PolicyStore,
  timeoutMs = 2000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error("Timed out waiting for store change"));
    }, timeoutMs);

    const unsub = store.onChange(() => {
      clearTimeout(timer);
      unsub();
      resolve();
    });
  });
}

describe("HotReloader (integration)", () => {
  let tempDir: string;
  let store: PolicyStore;
  let logger: ReturnType<typeof makeLogger>;
  let reloader: HotReloader;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cedar-gate-integ-"));
    // Write an initial policy file
    await writeFile(join(tempDir, "base.cedar"), VALID_CEDAR_A);

    store = new PolicyStore();
    logger = makeLogger();
  });

  afterEach(async () => {
    reloader?.stop();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should pick up new .cedar files written to the watched directory", async () => {
    // Load initial policies
    reloader = new HotReloader(store, logger, {
      policiesDir: tempDir,
      debounceMs: 50,
    });

    // Do an initial load so the store has the base policy
    await reloader.reload();
    const initialCount = store.policyCount;
    expect(initialCount).toBe(1);

    // Start watching
    reloader.start();

    // Set up the change listener before writing the file
    const changed = waitForStoreChange(store);

    // Write a new cedar file
    await writeFile(join(tempDir, "extra.cedar"), VALID_CEDAR_B);

    // Wait for the debounced reload to fire and update the store
    await changed;

    expect(store.policyCount).toBe(2);
  });

  it("should keep old policies when an invalid .cedar file is written", async () => {
    reloader = new HotReloader(store, logger, {
      policiesDir: tempDir,
      debounceMs: 50,
    });

    // Load initial valid policies
    await reloader.reload();
    expect(store.policyCount).toBe(1);
    const policyTextBefore = store.getPolicyText();

    // Start watching
    reloader.start();

    // Write an invalid file
    await writeFile(join(tempDir, "broken.cedar"), INVALID_CEDAR);

    // Give the debounce + reload time to execute
    await new Promise((r) => setTimeout(r, 300));

    // The store should still have the original policies (old ones kept)
    expect(store.policyCount).toBe(1);
    expect(store.getPolicyText()).toEqual(policyTextBefore);
    expect(logger.error).toHaveBeenCalled();
  });

  it("should handle rapid successive writes with debouncing", async () => {
    reloader = new HotReloader(store, logger, {
      policiesDir: tempDir,
      debounceMs: 100,
    });

    await reloader.reload();
    expect(store.policyCount).toBe(1);

    reloader.start();

    const changed = waitForStoreChange(store);

    // Write multiple files rapidly - debounce should coalesce them
    await writeFile(join(tempDir, "rapid1.cedar"), VALID_CEDAR_B);
    await writeFile(join(tempDir, "rapid2.cedar"), `permit(principal == User::"alice", action, resource);`);

    await changed;

    // All files should be loaded (base + rapid1 + rapid2 = 3 policies)
    expect(store.policyCount).toBe(3);
  });

  it("should reload policies via the reload() admin API", async () => {
    reloader = new HotReloader(store, logger, { policiesDir: tempDir });

    // Initial state: no policies loaded
    expect(store.policyCount).toBe(0);

    // Manual reload
    const result = await reloader.reload();

    expect(result.success).toBe(true);
    expect(store.policyCount).toBe(1);

    // Add another file and reload manually
    await writeFile(join(tempDir, "admin.cedar"), VALID_CEDAR_B);
    const result2 = await reloader.reload();

    expect(result2.success).toBe(true);
    expect(store.policyCount).toBe(2);
  });

  it("should not change the policy count for non-.cedar file changes", async () => {
    reloader = new HotReloader(store, logger, {
      policiesDir: tempDir,
      debounceMs: 50,
    });

    await reloader.reload();
    expect(store.policyCount).toBe(1);

    reloader.start();

    // Write a non-cedar file
    await writeFile(join(tempDir, "notes.txt"), "just a text file");

    // Wait a bit longer than debounce to ensure any potential reload settles
    await new Promise((r) => setTimeout(r, 300));

    // Even if the watcher fires (macOS may pass null filenames), the policy
    // count should remain unchanged because only .cedar files exist.
    expect(store.policyCount).toBe(1);
  });
});
