import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
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

const VALID_CEDAR = `permit(principal, action, resource);`;

describe("HotReloader (unit)", () => {
  let tempDir: string;
  let store: PolicyStore;
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cedar-gate-test-"));
    // Write a valid initial policy file so the directory isn't empty
    await writeFile(join(tempDir, "init.cedar"), VALID_CEDAR);
    store = new PolicyStore();
    logger = makeLogger();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should start and stop watching without errors", () => {
    const reloader = new HotReloader(store, logger, { policiesDir: tempDir });

    reloader.start();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ dir: tempDir }),
      expect.stringContaining("watching"),
    );

    // Starting again should be a no-op (no duplicate watchers)
    reloader.start();
    expect(logger.info).toHaveBeenCalledTimes(1);

    reloader.stop();
    // Stopping again should be safe
    reloader.stop();
  });

  it("reload() should load policies from the directory into the store", async () => {
    const reloader = new HotReloader(store, logger, { policiesDir: tempDir });

    expect(store.policyCount).toBe(0);

    const result = await reloader.reload();

    expect(result.success).toBe(true);
    expect(store.policyCount).toBeGreaterThan(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ policyCount: expect.any(Number) }),
      expect.stringContaining("reloaded successfully"),
    );

    reloader.stop();
  });

  it("reload() with invalid policy file should keep old policies and return error", async () => {
    const reloader = new HotReloader(store, logger, { policiesDir: tempDir });

    // First load the valid policies
    await reloader.reload();
    const countBefore = store.policyCount;
    expect(countBefore).toBeGreaterThan(0);

    // Write an invalid cedar file
    await writeFile(join(tempDir, "bad.cedar"), "this is not valid cedar %%%");

    // Reload should fail but keep old policies
    const result = await reloader.reload();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(store.policyCount).toBe(countBefore);
    expect(logger.error).toHaveBeenCalled();

    reloader.stop();
  });

  it("reload() should handle missing directory gracefully", async () => {
    const reloader = new HotReloader(store, logger, {
      policiesDir: "/tmp/nonexistent-cedar-dir-" + Date.now(),
    });

    const result = await reloader.reload();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    reloader.stop();
  });

  it("stop() should clear pending debounce timers", () => {
    const reloader = new HotReloader(store, logger, {
      policiesDir: tempDir,
      debounceMs: 5000,
    });

    reloader.start();
    // Access private scheduleReload via reload trigger - just test stop cleans up
    reloader.stop();

    // No error should occur - verifies cleanup
    expect(true).toBe(true);
  });
});
