// Disk maintenance for history snapshots and WebDriver browser profiles.
// Readable files (document.md, metadata.json, comments.jsonl) stay plain text so
// diffs and manual inspection keep working; only bulky raw captures are gzipped.
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const RAW_FILE_PATTERN = /^raw\.[a-z0-9._-]+$/i;

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

async function safeReaddir(dir) {
  try { return await fs.readdir(dir); } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  }
}

export async function directorySize(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return 0;
    throw error;
  }
  let total = 0;
  for (const entry of entries) {
    const target = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += await directorySize(target);
      else if (entry.isFile()) total += (await fs.stat(target)).size;
    } catch (error) {
      if (error.code !== "ENOENT") throw error; // a browser may delete cache files mid-walk
    }
  }
  return total;
}

export function isRawSnapshotFile(name) {
  return RAW_FILE_PATTERN.test(name) && !name.endsWith(".gz");
}

// Writes one snapshot directory. Text files are copied verbatim; the raw capture is
// gzipped (raw HTML typically shrinks about 10x).
export async function writeItemSnapshot(itemDir, metadata, timestamp, { retention = 20 } = {}) {
  const snapshotsRoot = path.join(itemDir, "snapshots");
  const snapshotDir = path.join(snapshotsRoot, String(timestamp).replace(/[:.]/g, "-"));
  await fs.mkdir(snapshotDir, { recursive: true });
  for (const file of ["document.md", "metadata.json", "comments.jsonl"]) {
    const sourcePath = path.join(itemDir, file);
    if (await exists(sourcePath)) await fs.copyFile(sourcePath, path.join(snapshotDir, file));
  }
  const rawName = RAW_FILE_PATTERN.test(String(metadata?.rawFileName || "")) ? metadata.rawFileName : "raw.html";
  const rawPath = path.join(itemDir, rawName);
  if (await exists(rawPath)) {
    await fs.writeFile(path.join(snapshotDir, `${rawName}.gz`), await gzip(await fs.readFile(rawPath), { level: 9 }));
  }
  return pruneSnapshots(snapshotsRoot, retention);
}

export async function pruneSnapshots(snapshotsRoot, retention = 20) {
  let removedSnapshots = 0;
  let reclaimedBytes = 0;
  const snapshots = (await safeReaddir(snapshotsRoot)).filter((name) => !name.startsWith(".")).sort().reverse();
  for (const stale of snapshots.slice(Math.max(1, retention))) {
    const target = path.join(snapshotsRoot, stale);
    reclaimedBytes += await directorySize(target);
    await fs.rm(target, { recursive: true, force: true });
    removedSnapshots += 1;
  }
  return { removedSnapshots, reclaimedBytes };
}

// Compresses raw captures left by older versions in place. Safe to re-run; a
// partially written .gz never replaces the original before it is fully written.
export async function compressSnapshotDirectory(snapshotDir) {
  let compressedFiles = 0;
  let reclaimedBytes = 0;
  for (const name of await safeReaddir(snapshotDir)) {
    if (!isRawSnapshotFile(name)) continue;
    const source = path.join(snapshotDir, name);
    const stat = await fs.stat(source);
    if (!stat.isFile()) continue;
    const packed = await gzip(await fs.readFile(source), { level: 9 });
    const target = `${source}.gz`;
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, packed);
    await fs.rename(temporary, target);
    await fs.rm(source, { force: true });
    compressedFiles += 1;
    reclaimedBytes += Math.max(0, stat.size - packed.length);
  }
  return { compressedFiles, reclaimedBytes };
}

export async function maintainSnapshots(itemsDir, { retention = 20 } = {}) {
  const totals = { removedSnapshots: 0, compressedFiles: 0, reclaimedBytes: 0, retentionCount: retention };
  for (const id of await safeReaddir(itemsDir)) {
    if (id.startsWith(".")) continue;
    const root = path.join(itemsDir, id, "snapshots");
    const pruned = await pruneSnapshots(root, retention);
    totals.removedSnapshots += pruned.removedSnapshots;
    totals.reclaimedBytes += pruned.reclaimedBytes;
    for (const snapshot of await safeReaddir(root)) {
      if (snapshot.startsWith(".")) continue;
      const compressed = await compressSnapshotDirectory(path.join(root, snapshot));
      totals.compressedFiles += compressed.compressedFiles;
      totals.reclaimedBytes += compressed.reclaimedBytes;
    }
  }
  return totals;
}

export async function readSnapshotRaw(snapshotDir) {
  for (const name of await safeReaddir(snapshotDir)) {
    if (!RAW_FILE_PATTERN.test(name)) continue;
    const content = await fs.readFile(path.join(snapshotDir, name));
    return { name: name.replace(/\.gz$/, ""), content: name.endsWith(".gz") ? await gunzip(content) : content };
  }
  return null;
}

// Chromium profile directories that only hold re-downloadable caches. Cookies,
// Local Storage, IndexedDB and Session Storage (where sign-in state lives) are kept.
export const BROWSER_CACHE_PATHS = Object.freeze([
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "ShaderCache",
  "component_crx_cache",
  "extensions_crx_cache"
]);

export const BROWSER_DISK_CACHE_BYTES = 100 * 1024 * 1024;

export async function cleanupBrowserProfileCaches(profileDir) {
  let reclaimedBytes = 0;
  let removedDirectories = 0;
  for (const relative of BROWSER_CACHE_PATHS) {
    const target = path.join(profileDir, relative);
    if (!(await exists(target))) continue;
    reclaimedBytes += await directorySize(target);
    await fs.rm(target, { recursive: true, force: true });
    removedDirectories += 1;
  }
  // A Service Worker registration whose script cache is gone is re-fetched on the next
  // visit; dropping the registration database avoids Chromium logging stale entries.
  if (!(await exists(path.join(profileDir, "Default/Service Worker/ScriptCache")))) {
    await fs.rm(path.join(profileDir, "Default/Service Worker/Database"), { recursive: true, force: true });
  }
  return { reclaimedBytes, removedDirectories };
}

// Cleans every profile under webdriverRoot except those currently opened by a live
// browser (Chromium holds their files and may rewrite them while we delete).
export async function cleanupBrowserCaches(webdriverRoot, { activeProfileDirs = [] } = {}) {
  const active = new Set(activeProfileDirs.map((dir) => path.resolve(dir)));
  const profiles = [];
  let reclaimedBytes = 0;
  for (const name of await safeReaddir(webdriverRoot)) {
    const profileDir = path.join(webdriverRoot, name);
    let stat;
    try { stat = await fs.stat(profileDir); } catch { continue; }
    if (!stat.isDirectory()) continue;
    if (active.has(path.resolve(profileDir))) {
      profiles.push({ profile: name, skipped: "in-use", reclaimedBytes: 0 });
      continue;
    }
    const result = await cleanupBrowserProfileCaches(profileDir);
    reclaimedBytes += result.reclaimedBytes;
    profiles.push({ profile: name, reclaimedBytes: result.reclaimedBytes });
  }
  return { reclaimedBytes, profiles };
}

// Before launching a profile, trim its caches when they have grown past the budget.
// Checked at most once per interval per profile to avoid walking large trees on every launch.
export async function trimBrowserProfileIfLarge(profileDir, { maxCacheBytes = 512 * 1024 * 1024, intervalMs = 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  const marker = path.join(profileDir, ".assistant-cache-check");
  try {
    const stat = await fs.stat(marker);
    if (now - stat.mtimeMs < intervalMs) return { checked: false, reclaimedBytes: 0 };
  } catch {}
  let cacheBytes = 0;
  for (const relative of BROWSER_CACHE_PATHS) cacheBytes += await directorySize(path.join(profileDir, relative));
  let reclaimedBytes = 0;
  if (cacheBytes > maxCacheBytes) reclaimedBytes = (await cleanupBrowserProfileCaches(profileDir)).reclaimedBytes;
  await fs.mkdir(profileDir, { recursive: true });
  await fs.writeFile(marker, new Date(now).toISOString());
  return { checked: true, cacheBytes, reclaimedBytes };
}

export async function browserCacheSize(webdriverRoot) {
  let total = 0;
  for (const name of await safeReaddir(webdriverRoot)) {
    for (const relative of BROWSER_CACHE_PATHS) total += await directorySize(path.join(webdriverRoot, name, relative));
  }
  return total;
}
