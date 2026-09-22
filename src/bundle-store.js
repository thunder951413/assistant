// Safe, server-agnostic import/export for a directory-backed knowledge base.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathExists, replaceDirectory } from "./atomic-files.js";

export async function exportBundle(rootDir) {
  const files = [];
  await collect(rootDir, "", files);
  return { type: "material-organizer-data", version: 1, exportedAt: new Date().toISOString(), files };
}

export async function importBundle(rootDir, bundle, { mode = "merge", validateStage } = {}) {
  const files = validateBundle(bundle);
  const parent = path.dirname(rootDir);
  const staged = path.join(parent, `.${path.basename(rootDir)}.import-${crypto.randomUUID()}`);
  await fs.mkdir(parent, { recursive: true });
  try {
    if (mode === "merge" && await pathExists(rootDir)) {
      await assertNoSymlinks(rootDir);
      await fs.cp(rootDir, staged, { recursive: true, force: true, verbatimSymlinks: true });
    }
    else await fs.mkdir(staged, { recursive: true });
    for (const file of files) {
      const target = path.join(staged, file.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.content);
    }
    await assertNoSymlinks(staged);
    await validateStagedItems(staged);
    if (validateStage) await validateStage(staged);
    // A caller hook may rebuild derived data; retain the same safety checks after it.
    await assertNoSymlinks(staged);
    await validateStagedItems(staged);
    // The staged tree is fully decoded and written before the live tree changes.
    await replaceDirectory(staged, rootDir);
    return { ok: true, mode: mode === "replace" ? "replace" : "merge", writtenFileCount: files.length };
  } catch (error) {
    await fs.rm(staged, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function validateBundle(bundle) {
  if (!bundle || bundle.type !== "material-organizer-data" || !Array.isArray(bundle.files)) throw new Error("数据导入文件格式不正确。");
  const seen = new Set();
  return bundle.files.map((file) => {
    const relative = String(file?.path || "").replace(/\\/g, "/");
    const normalized = path.posix.normalize(relative);
    const unsafeSegment = normalized.split("/").some((segment) => /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment));
    if (!relative || relative.startsWith("/") || relative.includes("\0") || /^[a-z]:/i.test(relative) || /(^|\/)\.{1,2}(\/|$)/.test(relative) || /[:]/.test(relative) || unsafeSegment || normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || seen.has(normalized)) {
      throw new Error(`非法数据文件路径：${file?.path}`);
    }
    seen.add(normalized);
    if (file.encoding === "utf8") return { path: normalized, content: Buffer.from(String(file.content || ""), "utf8") };
    const encoded = String(file.content || "").replace(/\s/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error(`非法数据文件内容：${relative}`);
    return { path: normalized, content: Buffer.from(encoded, "base64") };
  });
}

async function assertNoSymlinks(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) throw new Error(`不允许符号链接：${target}`);
    if (stat.isDirectory()) await assertNoSymlinks(target);
  }
}

async function validateStagedItems(root) {
  const itemRoot = path.join(root, "items");
  if (!(await pathExists(itemRoot))) return;
  for (const entry of await fs.readdir(itemRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(itemRoot, entry.name);
    const metadataPath = path.join(dir, "metadata.json");
    const documentPath = path.join(dir, "document.md");
    if (!(await pathExists(metadataPath)) || !(await pathExists(documentPath))) throw new Error(`资料缺少 metadata 或 document：${entry.name}`);
    let metadata;
    try { metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")); } catch { throw new Error(`资料 metadata 格式不正确：${entry.name}`); }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error(`资料 metadata 格式不正确：${entry.name}`);
    if (metadata.id !== entry.name) throw new Error(`资料 metadata ID 不匹配：${entry.name}`);
    if (!Array.isArray(metadata.tags)) throw new Error(`资料 metadata tags 格式不正确：${entry.name}`);
    if (metadata.rawFileName !== undefined && !/^raw\.[a-z0-9._-]+$/i.test(String(metadata.rawFileName))) {
      throw new Error(`资料 raw 文件名不安全：${entry.name}`);
    }
    const document = await fs.readFile(documentPath, "utf8");
    if (!document.trim()) throw new Error(`资料 document 为空：${entry.name}`);
    const commentsPath = path.join(dir, "comments.jsonl");
    if (await pathExists(commentsPath)) {
      try {
        for (const line of (await fs.readFile(commentsPath, "utf8")).split("\n")) if (line.trim()) JSON.parse(line);
      } catch { throw new Error(`资料 comments 格式不正确：${entry.name}`); }
    }
  }
}

async function collect(root, relative, files) {
  const dir = path.join(root, relative);
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    if (entry.name === ".DS_Store") continue;
    const child = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) await collect(root, child, files);
    else if (entry.isFile()) files.push({ path: child, encoding: "base64", content: (await fs.readFile(path.join(root, child))).toString("base64") });
  }
}
