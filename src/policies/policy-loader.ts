// ── Policy Loader ────────────────────────────────────────────────────

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkParsePolicySet, type EntityJson } from "@cedar-policy/cedar-wasm";

export interface LoadResult {
  policyText: string;
  errors: Array<{ file: string; error: string }>;
}

/**
 * Load all .cedar files from a directory and concatenate them into policy text.
 * Validates each file individually so a single bad file doesn't break everything.
 */
export async function loadPoliciesFromDir(dir: string): Promise<LoadResult> {
  const entries = await readdir(dir);
  const cedarFiles = entries.filter((f) => f.endsWith(".cedar")).sort();

  const segments: string[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of cedarFiles) {
    const filePath = join(dir, file);
    try {
      const content = await readFile(filePath, "utf-8");
      // Validate the policy text
      const result = checkParsePolicySet({
        staticPolicies: content,
      });
      if (result.type === "failure") {
        const errorMessages = result.errors.map((e) => e.message).join("; ");
        errors.push({ file, error: errorMessages });
      } else {
        segments.push(content);
      }
    } catch (err) {
      errors.push({
        file,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { policyText: segments.join("\n"), errors };
}

/**
 * Load entities from a JSON file.
 */
export async function loadEntitiesFromFile(
  filePath: string,
): Promise<EntityJson[]> {
  const content = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("Entities file must contain a JSON array");
  }
  return parsed as EntityJson[];
}
