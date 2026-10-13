// Small filesystem helpers shared by the server modules.
import { promises as fs } from "node:fs";
import path from "node:path";
import { cleanText } from "./utils.js";

export function resolveWritableDir(value, fallback) {
  return path.resolve(cleanText(value) || fallback);
}

export async function readJsonLines(filePath) {
  if (!(await exists(filePath))) return [];
  const text = await fs.readFile(filePath, "utf8");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function safeReaddir(dir) {
  if (!(await exists(dir))) return [];
  return fs.readdir(dir);
}

export async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
