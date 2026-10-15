// Settings on disk are two files:
//   settings.json            what the person configures (sources, AI, subscriptions…)
//   runtime/jobs-state.json  what refreshes record (status, last result, retry state)
// In memory they are one object, so the rest of the server reads job.status etc.
// as before. Writes go through one queue that always writes the latest state.
import { promises as fs } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "./atomic-files.js";
import { normalizeTags } from "./utils.js";

export const RUNTIME_JOB_FIELDS = [
  "status", "lastRunAt", "lastStartedAt", "lastSuccessAt", "lastError", "lastResult",
  "consecutiveFailures", "nextRetryAt", "circuitOpen", "quarantined", "quarantineReason"
];

// The only subscription fields a client may change.
export const EDITABLE_JOB_FIELDS = ["name", "url", "enabled", "intervalMinutes", "maxItems", "tags", "fetchMode"];

function pick(object, keys) {
  const result = {};
  for (const key of keys) if (object[key] !== undefined) result[key] = object[key];
  return result;
}

function omit(object, keys) {
  const result = { ...object };
  for (const key of keys) delete result[key];
  return result;
}

export function splitSettingsForDisk(settings) {
  const jobs = Array.isArray(settings.refreshJobs) ? settings.refreshJobs : [];
  const runtime = {};
  for (const job of jobs) if (job?.id) runtime[job.id] = pick(job, RUNTIME_JOB_FIELDS);
  return {
    config: { ...settings, refreshJobs: jobs.map((job) => omit(job, RUNTIME_JOB_FIELDS)) },
    runtime: { version: 1, jobs: runtime }
  };
}

// Older settings.json files still carry runtime fields inline; the runtime file wins.
export function mergeRuntimeIntoSettings(saved, runtime) {
  const states = runtime?.jobs && typeof runtime.jobs === "object" ? runtime.jobs : {};
  if (!Array.isArray(saved?.refreshJobs)) return saved;
  return {
    ...saved,
    refreshJobs: saved.refreshJobs.map((job) => (job?.id && states[job.id] ? { ...job, ...pick(states[job.id], RUNTIME_JOB_FIELDS) } : job))
  };
}

/**
 * Applies client edits to existing subscriptions only. Unknown ids are ignored
 * (a stale client cannot bring back a deleted subscription) and runtime fields
 * sent along by the client are dropped.
 */
export function applyClientJobEdits(jobs, edits) {
  const byId = new Map((Array.isArray(edits) ? edits : []).filter((edit) => edit?.id).map((edit) => [String(edit.id), edit]));
  return jobs.map((job) => {
    const edit = byId.get(job.id);
    if (!edit) return job;
    const next = { ...job };
    if (edit.name !== undefined) next.name = String(edit.name).trim() || job.name;
    if (edit.url !== undefined) next.url = String(edit.url).trim() || job.url;
    if (edit.enabled !== undefined) next.enabled = Boolean(edit.enabled);
    if (edit.intervalMinutes !== undefined) next.intervalMinutes = Math.max(5, Number(edit.intervalMinutes) || job.intervalMinutes || 60);
    if (edit.maxItems !== undefined) next.maxItems = Math.max(1, Number(edit.maxItems) || job.maxItems || 50);
    if (edit.tags !== undefined) next.tags = normalizeTags(edit.tags);
    if (edit.fetchMode !== undefined) next.fetchMode = String(edit.fetchMode || job.fetchMode || "");
    return next;
  });
}

export function isRuntimeOnlyPatch(patch) {
  return Object.keys(patch || {}).every((key) => RUNTIME_JOB_FIELDS.includes(key));
}

export async function readSettingsFiles({ settingsPath, runtimePath }) {
  const saved = JSON.parse(await fs.readFile(settingsPath, "utf8"));
  let runtime = null;
  try { runtime = JSON.parse(await fs.readFile(runtimePath, "utf8")); } catch { /* first run after the split */ }
  return mergeRuntimeIntoSettings(saved, runtime);
}

/**
 * Serialized writer. Calls that arrive while a write is still waiting share it;
 * every write uses the settings as they are when it starts, so an older snapshot
 * can never land after a newer one.
 */
export function createSettingsWriter({ settingsPath, runtimePath, getSettings }) {
  let tail = Promise.resolve();
  let pending = null;
  async function write(full) {
    const { config, runtime } = splitSettingsForDisk(getSettings());
    await fs.mkdir(path.dirname(runtimePath), { recursive: true });
    await atomicWriteFile(runtimePath, `${JSON.stringify(runtime)}\n`, { encoding: "utf8", mode: 0o600 });
    if (full) await atomicWriteFile(settingsPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return function persist({ runtimeOnly = false } = {}) {
    if (pending) {
      pending.full ||= !runtimeOnly;
      return pending.promise;
    }
    const entry = { full: !runtimeOnly };
    entry.promise = tail.then(() => {
      pending = null;
      return write(entry.full);
    });
    pending = entry;
    tail = entry.promise.catch((error) => console.warn("Settings write failed:", error.message || error));
    return entry.promise;
  };
}
