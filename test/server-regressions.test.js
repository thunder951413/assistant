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

  it("keeps Teams webdriver sessions warm across refresh batches", async () => {
    const source = await fs.readFile(path.join(root, "src", "server.js"), "utf8");
    assert.match(source, /closeWhenDone:\s*group\.sourceType === "teams" \? false : !session\.manual/);
    assert.match(source, /autoClose:\s*adapter\.sourceType === "teams" \? false : options\.keepSession !== true/);
    assert.match(source, /session\.teamsUserConfirmedAt = confirmedAt/);
  });

  it("waits for explicit Teams confirmation and locates conversations inside the current page", async () => {
    const [serverSource, appSource] = await Promise.all([
      fs.readFile(path.join(root, "src", "server.js"), "utf8"),
      fs.readFile(path.join(root, "public", "app.js"), "utf8")
    ]);
    assert.match(serverSource, /status:\s*"waiting_for_teams_confirmation"/);
    assert.match(serverSource, /await waitForTeamsUserConfirmation\(page, \{ run, session \}\)/);
    assert.match(serverSource, /headed:\s*group\.sourceType === "teams"/);
    assert.match(serverSource, /manual:\s*group\.sourceType === "teams"/);
    assert.match(serverSource, /await openTeamsConversationFromUi\(page,/);
    assert.match(serverSource, /data-fui-tree-item-value/);
    assert.match(serverSource, /async function filterTeamsChatList/);
    assert.doesNotMatch(serverSource, /function normalizeTeamsNavigationUrl/);
    assert.doesNotMatch(serverSource, /async function searchTeamsConversation/);
    assert.match(appSource, /run\.status === "waiting_for_teams_confirmation"/);
    assert.match(appSource, /\/teams-ready/);
  });
});
