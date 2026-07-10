import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeSourceHealth, createRunHistory, lineDiff } from "../src/reliability.js";

const roots = [];
after(async () => Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("reliability utilities", () => {
  it("persists newest refresh history first", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "assistant-history-")); roots.push(root);
    const history = createRunHistory(path.join(root, "history.jsonl"));
    await history.append({ id: "one" }); await history.append({ id: "two" });
    assert.deepEqual((await history.list()).map((entry) => entry.id), ["two", "one"]);
  });
  it("computes defects per source", () => {
    const rows = computeSourceHealth([{ sourceType: "teams", title: "", excerpt: "x", quarantined: true }], [{ url: "https://teams.microsoft.com/x", enabled: true, status: "failed" }]);
    assert.equal(rows[0].sourceType, "teams"); assert.equal(rows[0].failedJobs, 1); assert.ok(rows[0].score < 100);
  });
  it("creates a compact readable line diff", () => {
    const diff = lineDiff("a\nb\nc", "a\nB\nc");
    assert.equal(diff.changed, true); assert.match(diff.text, /- b/); assert.match(diff.text, /\+ B/);
  });
});
