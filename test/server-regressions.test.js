import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Server behaviour is split across src/*.js and src/sources/*.js; guards read all of it.
async function readServerSource() {
  const files = [];
  for (const dir of ["src", path.join("src", "sources")]) {
    for (const name of (await fs.readdir(path.join(root, dir))).sort()) {
      if (name.endsWith(".js")) files.push(path.join(root, dir, name));
    }
  }
  return (await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).join("\n");
}

describe("server regression guards", () => {
  it("does not destructure phantom response arguments in promise and Teams callbacks", async () => {
    const source = await readServerSource();
    assert.doesNotMatch(source, /\.then\(async\s*\(\{\s*res\s*\}\)/);
    assert.doesNotMatch(source, /const remember = async\s*\(\{\s*res\s*\}\)/);
  });

  it("keeps Teams webdriver sessions warm across refresh batches", async () => {
    const source = await readServerSource();
    assert.match(source, /closeWhenDone:\s*group\.sourceType === "teams" \? false : !session\.manual/);
    assert.match(source, /autoClose:\s*adapter\.sourceType === "teams" \? false : options\.keepSession !== true/);
  });

  it("continues Teams refreshes automatically and locates conversations inside the current page", async () => {
    const [serverSource, appSource] = await Promise.all([
      readServerSource(),
      fs.readFile(path.join(root, "public", "app.js"), "utf8")
    ]);
    // No manual confirmation gate: readiness is detected, sign-in surfaces the window.
    assert.doesNotMatch(serverSource, /waitForTeamsUserConfirmation/);
    assert.doesNotMatch(serverSource, /session\.teamsUserConfirmedAt = "";/);
    assert.match(serverSource, /await waitForTeamsReady\(\{/);
    assert.match(serverSource, /setWebdriverWindowOnScreen\(page, true\)/);
    assert.match(serverSource, /status:\s*"waiting_for_teams_confirmation"/);
    assert.match(serverSource, /headed:\s*group\.sourceType === "teams"/);
    assert.match(serverSource, /manual:\s*group\.sourceType === "teams"/);
    assert.match(serverSource, /--disable-backgrounding-occluded-windows/);
    assert.match(serverSource, /await openTeamsConversationFromUi\(page,/);
    assert.match(serverSource, /data-fui-tree-item-value/);
    assert.match(serverSource, /async function filterTeamsChatList/);
    assert.doesNotMatch(serverSource, /function normalizeTeamsNavigationUrl/);
    assert.match(appSource, /run\.status === "waiting_for_teams_confirmation"/);
  });
});
