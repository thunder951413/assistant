#!/usr/bin/env node
// Second-stage Teams diagnostics:
//  1. runs the app's conversation locator against every Teams subscription and
//     records how each was found (or why not);
//  2. probes the chatsvc message API the Teams web client itself uses: which auth
//     header names it sends (values stay in memory, never written), and what a
//     messages page looks like (count, order, paging fields, message keys).
//
//   npm run service:stop
//   node scripts/teams-diagnose-api.js [--limit 12]
//
// The report (no message text) is written to reports/teams-diagnose-api-*.json.
import { chromium } from "playwright";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openTeamsConversationFromUi, extractTeamsConversationId, waitForTeamsConversation } from "../src/sources/teams-page.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const limit = Number(args[args.indexOf("--limit") + 1]) || 12;
const configDir = process.env.ASSISTANT_CONFIG_DIR || path.join(root, ".config");
const profileDir = path.join(configDir, "webdriver", "teams-microsoft-com");
const settings = JSON.parse(await fs.readFile(path.join(configDir, "settings.json"), "utf8"));
const jobs = (settings.refreshJobs || [])
  .filter((job) => /teams\.(microsoft\.com|cloud\.microsoft)/.test(job.url || "") && /\/l\/chat\//.test(job.url || ""))
  .map((job) => ({ name: String(job.name || "").replace(/\s+refresh$/i, "").trim(), url: job.url }))
  .filter((job, index, all) => all.findIndex((other) => other.url === job.url) === index)
  .slice(0, limit);

for (const lock of ["SingletonLock", "SingletonSocket", "lockfile"]) {
  try { await fs.lstat(path.join(profileDir, lock)); console.error("Teams 浏览器配置正在被使用，请先 npm run service:stop 或关闭应用打开的 Teams 窗口。"); process.exit(2); } catch {}
}

const auth = { headerNames: new Set(), headers: null, base: "" };
const context = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: { width: 1280, height: 860 }, args: ["--disable-blink-features=AutomationControlled"] });
context.on("request", (request) => {
  const url = request.url();
  const match = url.match(/^(https:\/\/[^/]+\/api\/chatsvc\/[^/]+\/v1)\//);
  if (!match) return;
  const headers = request.headers();
  for (const name of Object.keys(headers)) auth.headerNames.add(name);
  if (/authentication|authorization|x-skypetoken/i.test(Object.keys(headers).join(" "))) {
    auth.headers = Object.fromEntries(Object.entries(headers).filter(([name]) => /^(authentication|authorization|x-skypetoken|x-ms-|behavioroverride|clientinfo|ms-ic3)/i.test(name)));
    auth.base = match[1];
  }
});
const page = context.pages()[0] || await context.newPage();
await page.goto("https://teams.microsoft.com/", { waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
console.log("等待 Teams 加载（如需登录请在窗口中完成）……");
for (let i = 0; i < 180 && !(await page.locator("[data-fui-tree-item-value]").count().catch(() => 0)); i += 1) await page.waitForTimeout(1000);

const located = [];
for (const job of jobs) {
  const started = Date.now();
  try {
    const result = await openTeamsConversationFromUi(page, { title: job.name, url: job.url, onProgress: (text) => console.log("  ", text) });
    await waitForTeamsConversation(page).catch(() => {});
    located.push({ name: job.name, ok: true, locatedBy: result.locatedBy, verifiedById: result.identityVerifiedById, header: result.title, ms: Date.now() - started });
  } catch (error) {
    located.push({ name: job.name, ok: false, error: String(error.message || error).slice(0, 200), ms: Date.now() - started });
  }
  console.log(located.at(-1).ok ? `✓ ${job.name} (${located.at(-1).locatedBy})` : `✗ ${job.name}: ${located.at(-1).error}`);
}

const probes = [];
if (auth.headers) {
  for (const job of jobs.slice(0, 4)) {
    const id = extractTeamsConversationId(job.url);
    const url = `${auth.base}/users/ME/conversations/${encodeURIComponent(id)}/messages?view=msnp24Equivalent|supportsMessageProperties&pageSize=50&startTime=1`;
    try {
      const response = await context.request.get(url, { headers: auth.headers, timeout: 30000 });
      const json = response.ok() ? await response.json() : null;
      const list = json?.messages || [];
      const times = list.map((message) => message.composetime || message.originalarrivaltime).filter(Boolean);
      const next = json?._metadata || {};
      probes.push({
        name: job.name, status: response.status(), count: list.length,
        newest: times[0] || "", oldest: times.at(-1) || "", order: times.length > 1 ? (times[0] > times.at(-1) ? "newest-first" : "oldest-first") : "",
        metadataKeys: Object.keys(next), backwardLink: next.backwardLink ? next.backwardLink.replace(/(19:|19%3A)[^/&?]+/gi, "$1<id>").slice(0, 200) : "",
        messageTypes: [...new Set(list.map((message) => message.messagetype))],
        messageKeys: list[0] ? Object.keys(list[0]) : [],
        hasDisplayName: list.filter((message) => message.imdisplayname).length,
        edited: list.filter((message) => message.properties?.edittime).length,
        deleted: list.filter((message) => message.properties?.deletetime).length
      });
      if (next.backwardLink) {
        const older = await context.request.get(next.backwardLink, { headers: auth.headers, timeout: 30000 });
        const olderJson = older.ok() ? await older.json() : null;
        probes.at(-1).backwardPage = { status: older.status(), count: olderJson?.messages?.length || 0, oldest: olderJson?.messages?.at(-1)?.composetime || "" };
      }
    } catch (error) {
      probes.push({ name: job.name, error: String(error.message || error).slice(0, 200) });
    }
  }
}

const out = path.join(root, "reports", `teams-diagnose-api-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify({
  generatedAt: new Date().toISOString(),
  located,
  chatsvc: { base: auth.base, authHeaderSeen: Boolean(auth.headers), requestHeaderNames: [...auth.headerNames].sort(), replayHeaderNames: Object.keys(auth.headers || {}) },
  probes
}, null, 2));
console.log(`\n已写入：${out}\n定位成功 ${located.filter((entry) => entry.ok).length}/${located.length}，接口探测 ${probes.length} 个。`);
await context.close();
