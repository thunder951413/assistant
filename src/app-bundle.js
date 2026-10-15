// The browser app is one script, authored as ordered parts in public/app/
// (01-state-and-elements.js … 20-startup.js). They share one scope, exactly as
// if they were a single file, and are joined in file-name order when /app.js is
// requested. index.html gets content-hash versions for app.js and styles.css,
// so a changed file is never served from a stale browser cache.
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const APP_PARTS_DIR = "app";

export async function appPartFiles(publicDir) {
  const dir = path.join(publicDir, APP_PARTS_DIR);
  return (await fs.readdir(dir)).filter((name) => name.endsWith(".js")).sort().map((name) => path.join(dir, name));
}

let cache = null;

export async function readAppSource(publicDir) {
  const files = await appPartFiles(publicDir);
  const stamps = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(file);
    return `${file}:${stat.size}:${stat.mtimeMs}`;
  }));
  const key = stamps.join("|");
  if (cache?.key === key) return cache.source;
  const source = (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("");
  cache = { key, source, hash: createHash("sha1").update(source).digest("hex").slice(0, 12) };
  return source;
}

export async function appVersion(publicDir) {
  await readAppSource(publicDir);
  return cache.hash;
}

// Rewrites the ?v= of app.js and styles.css in index.html to content hashes.
export async function versionedIndexHtml(publicDir, html) {
  const appHash = await appVersion(publicDir);
  const styles = await fs.readFile(path.join(publicDir, "styles.css"));
  const stylesHash = createHash("sha1").update(styles).digest("hex").slice(0, 12);
  return html
    .replace(/(\/app\.js)\?v=[^"']*/g, `$1?v=${appHash}`)
    .replace(/(\/styles\.css)\?v=[^"']*/g, `$1?v=${stylesHash}`);
}
