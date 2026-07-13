#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(rootDir, "build", "playwright-browsers");

mkdirSync(browsersPath, { recursive: true });

const result = spawnSync(process.execPath, [
  path.join(rootDir, "node_modules", "playwright", "cli.js"),
  "install",
  "chromium"
], {
  cwd: rootDir,
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  },
  stdio: "inherit"
});

process.exit(result.status ?? 1);
