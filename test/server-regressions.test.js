import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("server regression guards", () => {
  it("does not destructure phantom response arguments in promise and Teams callbacks", async () => {
    const source = await fs.readFile(path.join(root, "src", "server.js"), "utf8");
    assert.doesNotMatch(source, /\.then\(async\s*\(\{\s*res\s*\}\)/);
    assert.doesNotMatch(source, /const remember = async\s*\(\{\s*res\s*\}\)/);
  });
});
