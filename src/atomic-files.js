import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export async function pathExists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

export async function atomicWriteFile(target, content, options = {}) {
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content, options);
    // Syncing the file makes a successful rename durable on platforms that support it.
    const handle = await fs.open(temporary, "r");
    try { await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, target);
    // Best effort: directory fsync is unsupported on some platforms.
    let dirHandle;
    try {
      dirHandle = await fs.open(directory, "r");
      await dirHandle.sync();
    } catch { /* platform does not support opening or syncing directories */ }
    finally { await dirHandle?.close().catch(() => {}); }
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export async function atomicWriteJson(target, value) {
  return atomicWriteFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function replaceDirectory(staged, target) {
  const backup = `${target}.previous-${crypto.randomUUID()}`;
  const hadTarget = await pathExists(target);
  try {
    if (hadTarget) await fs.rename(target, backup);
    await fs.rename(staged, target);
    if (hadTarget) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (!(await pathExists(target)) && hadTarget && await pathExists(backup)) {
      await fs.rename(backup, target).catch(() => {});
    }
    throw error;
  }
}
