#!/usr/bin/env node
// Reports Teams items whose captured title does not match the refresh-job name.
//
// Background: refresh batches reused one WebDriver page across multiple Teams
// conversations. Navigating between two `https://teams.microsoft.com/v2/#/l/chat/...`
// URLs is a same-document hash change, so the SPA switched conversations
// asynchronously while the previous conversation's header (and sometimes
// messages) lingered in the DOM — causing captured titles (and content) to
// cross between jobs. The src/server.js fix forces a cross-document reload
// before each Teams navigation; this script only *reports* items already
// mis-captured so they can be re-fetched.
//
// Pass --quarantine to mark mismatched items so they are excluded from AI
// search until a verified refresh repairs them. Re-fetch via the running service:
//   ./ctl --start
//   curl -sX POST http://127.0.0.1:8020/api/refresh-jobs/<jobId>/run
// or batch:
//   curl -sX POST http://127.0.0.1:8020/api/refresh-jobs/run-batch \
//     -H 'Content-Type: application/json' \
//     --data '{"ids":["<jobId1>","<jobId2>"]}'
//
// Usage:
//   node scripts/report-teams-title-mismatches.js

import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const itemsDir = path.join(root, "knowledge-base", "items");
const settingsPath = path.join(root, ".config", "settings.json");

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Consider a title consistent if one is a leading substring of the other after
// normalization; otherwise flag as mismatch.
function isConsistent(title, jobName) {
  const a = normalize(title);
  const b = normalize(jobName);
  if (!a || !b) return true;
  if (a === b) return true;
  return a.startsWith(b) || b.startsWith(a);
}

async function main() {
  const quarantine = process.argv.includes("--quarantine");
  const dirs = await fs.readdir(itemsDir);
  const mismatches = [];
  for (const id of dirs) {
    if (!id.startsWith("teams-")) continue;
    const metaPath = path.join(itemsDir, id, "metadata.json");
    let raw;
    try {
      raw = await fs.readFile(metaPath, "utf8");
    } catch {
      continue;
    }
    const metadata = JSON.parse(raw);
    const title = metadata.title || "";
    const job = metadata.refreshJob || {};
    const jobName = (job.name || "").replace(/\s+refresh$/i, "");
    const jobId = job.id || "";
    if (!isConsistent(title, jobName)) {
      mismatches.push({ id, title, jobName, jobId, url: metadata.url || "", metadata, metaPath });
    }
  }

  if (!mismatches.length) {
    console.log("No Teams title/job-name mismatches found.");
    return;
  }

  console.log(`Found ${mismatches.length} Teams item(s) with title/job-name mismatch:\n`);
  for (const { id, title, jobName, jobId, url } of mismatches) {
    console.log(`  ${id}`);
    console.log(`    captured title: ${title}`);
    console.log(`    refresh job:    ${jobName}`);
    console.log(`    job id:         ${jobId}`);
    console.log(`    url:            ${url}`);
    console.log();
  }

  if (quarantine) {
    for (const mismatch of mismatches) {
      const next = {
        ...mismatch.metadata,
        integrityStatus: "quarantined",
        integrityReason: `Teams conversation title mismatch: captured "${mismatch.title}", expected "${mismatch.jobName}"`,
        integrityCheckedAt: new Date().toISOString()
      };
      await fs.writeFile(mismatch.metaPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      const jobIds = new Set(mismatches.map((item) => item.jobId).filter(Boolean));
      settings.refreshJobs = (settings.refreshJobs || []).map((job) => jobIds.has(job.id) ? {
        ...job,
        enabled: false,
        quarantined: true,
        quarantineReason: "Disabled because the captured Teams title did not match the subscription target. Re-enable after a verified refresh."
      } : job);
      await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.chmod(settingsPath, 0o600);
    } catch (error) {
      console.warn(`Could not disable quarantined refresh jobs: ${error.message}`);
    }
    console.log(`Quarantined ${mismatches.length} mismatched Teams item(s).`);
  }

  console.log("To re-fetch with the navigation fix applied, start the service and run:");
  console.log("  ./ctl --start");
  const ids = mismatches.map((m) => m.jobId).filter(Boolean);
  if (ids.length) {
    console.log("  curl -sX POST http://127.0.0.1:8020/api/refresh-jobs/run-batch \\");
    console.log("    -H 'Content-Type: application/json' \\");
    console.log(`    --data '${JSON.stringify({ ids })}'`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
