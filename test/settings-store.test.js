import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyClientJobEdits, createSettingsWriter, isRuntimeOnlyPatch, mergeRuntimeIntoSettings, readSettingsFiles, splitSettingsForDisk } from "../src/settings-store.js";

const job = (id, extra = {}) => ({ id, name: id, url: `https://x/${id}`, enabled: true, intervalMinutes: 60, maxItems: 50, tags: [], status: "idle", lastResult: null, ...extra });

test("runtime fields are stored apart from config and merged back on read", async () => {
  const settings = { ai: { model: "m" }, refreshJobs: [job("a", { status: "running", lastResult: { updatedItemCount: 3 }, consecutiveFailures: 2 })] };
  const { config, runtime } = splitSettingsForDisk(settings);
  assert.equal(config.refreshJobs[0].status, undefined);
  assert.equal(config.refreshJobs[0].lastResult, undefined);
  assert.equal(config.refreshJobs[0].name, "a");
  assert.deepEqual(runtime.jobs.a, { status: "running", lastResult: { updatedItemCount: 3 }, consecutiveFailures: 2 });
  assert.deepEqual(mergeRuntimeIntoSettings(config, runtime).refreshJobs[0], settings.refreshJobs[0]);
  // Older files keep runtime fields inline; without a runtime file they are used as-is.
  assert.equal(mergeRuntimeIntoSettings(settings, null).refreshJobs[0].status, "running");
});

test("client edits only touch editable fields of existing subscriptions", () => {
  const jobs = [job("a", { status: "running", lastResult: { n: 1 } })];
  const next = applyClientJobEdits(jobs, [
    { id: "a", name: "新名字", enabled: false, intervalMinutes: 1, status: "idle", lastResult: null },
    { id: "deleted", name: "should not come back" }
  ]);
  assert.equal(next.length, 1);
  assert.deepEqual([next[0].name, next[0].enabled, next[0].intervalMinutes], ["新名字", false, 5]);
  assert.deepEqual([next[0].status, next[0].lastResult], ["running", { n: 1 }]);
  assert.equal(isRuntimeOnlyPatch({ status: "idle", lastRunAt: "x" }), true);
  assert.equal(isRuntimeOnlyPatch({ status: "idle", name: "x" }), false);
});

test("writer always lands the latest state and shares queued writes", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "settings-store-"));
  const settingsPath = path.join(dir, "settings.json");
  const runtimePath = path.join(dir, "runtime", "jobs-state.json");
  let current = { refreshJobs: [job("a", { status: "idle" })], version: 1 };
  const persist = createSettingsWriter({ settingsPath, runtimePath, getSettings: () => current });
  const first = persist();
  current = { ...current, version: 2 };
  const second = persist({ runtimeOnly: true });
  current = { ...current, version: 3, refreshJobs: [job("a", { status: "running" })] };
  const third = persist({ runtimeOnly: true });
  assert.equal(second, third, "calls waiting behind a running write share one write");
  await Promise.all([first, second, third]);
  const saved = await readSettingsFiles({ settingsPath, runtimePath });
  assert.equal(saved.refreshJobs[0].status, "running");
  assert.equal(JSON.parse(await readFile(settingsPath, "utf8")).refreshJobs[0].status, undefined);
});

test("reading settings without a runtime file keeps inline runtime fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "settings-store-"));
  const settingsPath = path.join(dir, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ refreshJobs: [job("a", { status: "failed" })] }));
  const saved = await readSettingsFiles({ settingsPath, runtimePath: path.join(dir, "runtime", "jobs-state.json") });
  assert.equal(saved.refreshJobs[0].status, "failed");
});
