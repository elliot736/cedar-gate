// ── Hot Reload ───────────────────────────────────────────────────────

import { watch, type FSWatcher } from "node:fs";
import type { Logger } from "pino";
import type { PolicyStore } from "./policy-store.js";
import { loadPoliciesFromDir, loadEntitiesFromFile } from "./policy-loader.js";

export interface HotReloadOptions {
  policiesDir: string;
  entitiesFile?: string;
  debounceMs?: number;
}

/**
 * Watches policy files for changes and atomically reloads them
 * into the PolicyStore. Debounces rapid changes to handle
 * multi-file saves.
 *
 * On parse error, logs the error and keeps the old policies.
 * Never serves with broken config.
 */
export class HotReloader {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private isReloading = false;
  private pendingReload = false;
  private readonly options: Required<HotReloadOptions>;

  constructor(
    private store: PolicyStore,
    private logger: Logger,
    options: HotReloadOptions,
  ) {
    this.options = {
      debounceMs: 300,
      entitiesFile: "",
      ...options,
    };
  }

  start(): void {
    if (this.watcher) return;

    this.watcher = watch(
      this.options.policiesDir,
      { recursive: true },
      (_event, filename) => {
        if (filename && !filename.endsWith(".cedar") && filename !== "entities.json") {
          return;
        }
        this.scheduleReload();
      },
    );

    this.logger.info(
      { dir: this.options.policiesDir },
      "Hot reload: watching for policy changes",
    );
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  async reload(): Promise<{ success: boolean; error?: string }> {
    return this.performReload();
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.performReload().catch((err) => {
        this.logger.error({ err }, "Hot reload: unexpected error during reload");
      });
    }, this.options.debounceMs);
  }

  private async performReload(): Promise<{ success: boolean; error?: string }> {
    if (this.isReloading) {
      this.pendingReload = true;
      return { success: true };
    }
    this.isReloading = true;
    try {
      const { policyText, errors } = await loadPoliciesFromDir(
        this.options.policiesDir,
      );

      if (errors.length > 0) {
        for (const { file, error } of errors) {
          this.logger.error({ file, error }, "Hot reload: parse error, keeping old policies");
        }
        return {
          success: false,
          error: `Parse errors in: ${errors.map((e) => e.file).join(", ")}`,
        };
      }

      if (this.options.entitiesFile) {
        const entities = await loadEntitiesFromFile(this.options.entitiesFile);
        this.store.update(policyText, entities);
      } else {
        this.store.setPolicies(policyText);
      }

      this.logger.info(
        {
          policyCount: this.store.policyCount,
          entityCount: this.store.entityCount,
        },
        "Hot reload: policies reloaded successfully",
      );

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, "Hot reload: failed, keeping old policies");
      return { success: false, error: message };
    } finally {
      this.isReloading = false;
      if (this.pendingReload) {
        this.pendingReload = false;
        this.scheduleReload();
      }
    }
  }
}
