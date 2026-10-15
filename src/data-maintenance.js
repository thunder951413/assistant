// Data bundles (export/import), storage statistics and cleanup, service health.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { exportBundle, importBundle } from "./bundle-store.js";
import { safeReaddir } from "./fs-helpers.js";
import { createItemStore } from "./item-store.js";
import { browserCacheSize, cleanupBrowserCaches, directorySize, maintainSnapshots } from "./storage-maintenance.js";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createDataMaintenance(ctx) {
  // Functions that live elsewhere, resolved when called.
  const ensureKnowledgeBase = (...args) => ctx.ensureKnowledgeBase(...args);
  const flushIndexRebuild = (...args) => ctx.flushIndexRebuild(...args);
  const isEmbeddingEnabled = (...args) => ctx.isEmbeddingEnabled(...args);
  const listItems = (...args) => ctx.listItems(...args);
  const publicRefreshJobs = (...args) => ctx.publicRefreshJobs(...args);

  async function serviceHealth() {
    const items = await listItems({ includeLists: true, includeInvalidTeamsRoot: true });
    let disk = { freeBytes: null, totalBytes: null, warning: false };
    try {
      const stat = await fs.statfs(ctx.kbDir);
      disk = { freeBytes: stat.bavail * stat.bsize, totalBytes: stat.blocks * stat.bsize, warning: stat.bavail * stat.bsize < 1024 ** 3 };
    } catch {}
    const jobs = publicRefreshJobs();
    return {
      ok: true,
      version: ctx.APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      knowledgeBase: { root: ctx.kbDir, itemCount: items.length, quarantinedCount: items.filter((item) => item.integrityStatus === "quarantined").length },
      refresh: { jobCount: jobs.length, runningCount: jobs.filter((job) => job.running).length, failedCount: jobs.filter((job) => job.enabled && ["failed", "unreachable"].includes(job.status)).length, circuitOpenCount: jobs.filter((job) => job.enabled && job.circuitOpen).length },
      embeddingIndex: isEmbeddingEnabled() ? { ...ctx.embeddingIndexState } : { status: "disabled" },
      disk
    };
  }

  async function exportDataBundle() {
    await flushIndexRebuild();
    await ensureKnowledgeBase();
    const bundle = await ctx.store.runExclusive(() => exportBundle(ctx.kbDir));
    return { ...bundle, documentRootName: path.basename(ctx.kbDir), fileCount: bundle.files.length };
  }

  async function collectDataFiles(baseDir, relativeDir = "") {
    const dir = path.join(baseDir, relativeDir);
    const names = await safeReaddir(dir);
    const files = [];
    for (const name of names) {
      if (name === ".DS_Store") continue;
      const relativePath = relativeDir ? path.posix.join(relativeDir, name) : name;
      const absolutePath = path.join(baseDir, relativePath);
      const stat = await fs.stat(absolutePath);
      if (stat.isDirectory()) {
        files.push(...await collectDataFiles(baseDir, relativePath));
        continue;
      }
      if (!stat.isFile()) continue;
      const content = await fs.readFile(absolutePath);
      files.push({
        path: relativePath.split(path.sep).join("/"),
        encoding: "base64",
        content: content.toString("base64")
      });
    }
    return files;
  }

  async function storageStats() {
    const [knowledgeBytes, snapshotBytes, webdriverBytes, browserCacheBytes] = await Promise.all([
      directorySize(ctx.kbDir),
      snapshotStorageSize(),
      directorySize(ctx.webdriverRoot),
      browserCacheSize(ctx.webdriverRoot)
    ]);
    return {
      knowledgeBytes,
      snapshotBytes,
      webdriverBytes,
      browserCacheBytes,
      retentionCount: ctx.SNAPSHOT_RETENTION_COUNT
    };
  }

  async function snapshotStorageSize() {
    let total = 0;
    for (const id of await safeReaddir(ctx.itemsDir)) {
      total += await directorySize(path.join(ctx.itemsDir, id, "snapshots"));
    }
    return total;
  }

  // Prunes snapshots beyond the retention count and gzips raw captures written by
  // older versions. Runs under the store lock so it never races an item commit.
  async function cleanupOldSnapshots() {
    return ctx.store.runExclusive(() => maintainSnapshots(ctx.itemsDir, { retention: ctx.SNAPSHOT_RETENTION_COUNT }));
  }

  async function cleanupWebdriverCaches() {
    const activeProfileDirs = [...ctx.webdriverSessions.values()].map((session) => session.userDataDir).filter(Boolean);
    return cleanupBrowserCaches(ctx.webdriverRoot, { activeProfileDirs });
  }

  async function importDataBundle(bundle, options = {}) {
    if (ctx.refreshRuntime.running.size || ctx.refreshRuntime.queued.size || ctx.activeApiOperations > 1 || ctx.embeddingBuilds.size) {
      const error = new Error("请等待当前操作完成或取消同步后再导入资料库。"); error.statusCode = 409; throw error;
    }
    ctx.libraryMaintenance = true;
    try {
      const result = await ctx.store.runExclusive(() => importBundle(ctx.kbDir, bundle, {
        mode: options.mode === "replace" ? "replace" : "merge",
        validateStage: async (root) => {
          const stagedStore = createItemStore(() => ({itemsDir: path.join(root, "items"), tagsDir: path.join(root, "tags"), indexesDir: path.join(root, "indexes")}));
          await fs.mkdir(path.join(root, "items"), { recursive: true });
          await stagedStore.rebuildIndexes();
        }
      }));
      await ensureKnowledgeBase();
      return result;
    } finally { ctx.libraryMaintenance = false; }
  }

  return { exportDataBundle, storageStats, cleanupOldSnapshots, cleanupWebdriverCaches, importDataBundle, serviceHealth };
}
