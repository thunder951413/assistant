// Syntax-checks every JavaScript file of the app (and the assembled browser
// script), so new modules are covered without editing a list.
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppSource } from "../src/app-bundle.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function jsFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFiles(rel));
    else if (/\.(m?js)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const files = (await Promise.all(["src", "public/app", "desktop", "scripts"].map(jsFiles))).flat().sort();
const assembled = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "app-check-")), "app.mjs");
await fs.writeFile(assembled, await readAppSource(path.join(root, "public")));
let failed = 0;
for (const file of [...files, assembled]) {
  const result = spawnSync(process.execPath, ["--check", path.isAbsolute(file) ? file : path.join(root, file)], { encoding: "utf8" });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(`${file}\n${result.stderr}\n`);
  }
}
console.log(failed ? `${failed} file(s) failed the syntax check` : `${files.length} files and the assembled app script pass the syntax check`);
process.exit(failed ? 1 : 0);
