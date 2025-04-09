import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadPoliciesFromDir, loadEntitiesFromFile } from "../../src/policies/policy-loader.js";

// ── Helpers ──────────────────────────────────────────────────────────

let tempDir: string;

async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cedar-gate-test-"));
}

async function writeCedarFile(dir: string, name: string, content: string) {
  await writeFile(join(dir, name), content, "utf-8");
}

async function writeJsonFile(dir: string, name: string, data: unknown) {
  await writeFile(join(dir, name), JSON.stringify(data), "utf-8");
}

// ── Tests ───────────────────────────────────────────────────────────

describe("loadPoliciesFromDir", () => {
  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads a single valid .cedar file", async () => {
    await writeCedarFile(tempDir, "allow-all.cedar", "permit(principal, action, resource);");

    const result = await loadPoliciesFromDir(tempDir);
    expect(result.policyText).toContain("permit");
    expect(result.errors).toHaveLength(0);
  });

  it("loads multiple .cedar files", async () => {
    await writeCedarFile(tempDir, "a.cedar", "permit(principal, action, resource);");
    await writeCedarFile(tempDir, "b.cedar", "forbid(principal, action, resource);");

    const result = await loadPoliciesFromDir(tempDir);
    expect(result.policyText).toContain("permit");
    expect(result.policyText).toContain("forbid");
    expect(result.errors).toHaveLength(0);
  });

  it("returns empty results for empty directory", async () => {
    const result = await loadPoliciesFromDir(tempDir);
    expect(result.policyText).toBe("");
    expect(result.errors).toHaveLength(0);
  });

  it("ignores non-.cedar files", async () => {
    await writeCedarFile(tempDir, "notes.txt", "not a policy");
    await writeCedarFile(tempDir, "config.json", "{}");
    await writeCedarFile(tempDir, "real.cedar", "permit(principal, action, resource);");

    const result = await loadPoliciesFromDir(tempDir);
    expect(result.policyText).toContain("permit");
    expect(result.errors).toHaveLength(0);
  });

  it("collects parse errors without throwing", async () => {
    await writeCedarFile(tempDir, "bad.cedar", "this is not valid cedar!!!");
    await writeCedarFile(tempDir, "good.cedar", "permit(principal, action, resource);");

    const result = await loadPoliciesFromDir(tempDir);
    expect(result.policyText).toContain("permit");
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]!.file).toBe("bad.cedar");
    expect(result.errors[0]!.error).toBeTruthy();
  });

  it("handles a file with multiple policies", async () => {
    const multi = `
      permit(principal, action, resource);
      forbid(principal, action, resource);
    `;
    await writeCedarFile(tempDir, "multi.cedar", multi);

    const result = await loadPoliciesFromDir(tempDir);
    expect(result.policyText).toContain("permit");
    expect(result.policyText).toContain("forbid");
  });

  it("throws when directory does not exist", async () => {
    await expect(loadPoliciesFromDir("/nonexistent/path/xyz")).rejects.toThrow();
  });
});

describe("loadEntitiesFromFile", () => {
  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads a valid entities JSON file", async () => {
    const entities = [
      { uid: { type: "Gateway::Service", id: "api" }, attrs: { name: "api", url: "http://localhost" }, parents: [] },
    ];
    await writeJsonFile(tempDir, "entities.json", entities);

    const result = await loadEntitiesFromFile(join(tempDir, "entities.json"));
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty("uid");
  });

  it("loads an empty array", async () => {
    await writeJsonFile(tempDir, "entities.json", []);

    const result = await loadEntitiesFromFile(join(tempDir, "entities.json"));
    expect(result).toHaveLength(0);
  });

  it("throws when file contains a non-array", async () => {
    await writeJsonFile(tempDir, "entities.json", { not: "array" });

    await expect(loadEntitiesFromFile(join(tempDir, "entities.json"))).rejects.toThrow(
      "JSON array",
    );
  });

  it("throws when file contains invalid JSON", async () => {
    await writeFile(join(tempDir, "bad.json"), "not json {{{", "utf-8");

    await expect(loadEntitiesFromFile(join(tempDir, "bad.json"))).rejects.toThrow();
  });

  it("throws when file does not exist", async () => {
    await expect(loadEntitiesFromFile(join(tempDir, "missing.json"))).rejects.toThrow();
  });
});
