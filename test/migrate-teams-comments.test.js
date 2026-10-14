import { it } from "node:test";
import assert from "node:assert/strict";
import { migrateComments, restoreLegacyBody } from "../scripts/migrate-teams-comments.js";

it("restores bodies, drops date dividers and legacy duplicates, never real Teams ids", () => {
  assert.equal(restoreLegacyBody({ author: "Shaohua Huang", body: "前面调不了... by Shaohua Huang Shaohua Huang 7/3 9:36 AM Translate 前面调不了是什么原因" }), "前面调不了是什么原因");
  assert.equal(restoreLegacyBody({ author: "Changwen Dai", body: "ok by Changwen Dai Changwen Dai 7/29/2025 10:21 AM ok" }), "ok");
  const { comments, stats } = migrateComments([
    { id: "chat-pane-item", author: "", createdAt: "", body: "Friday, December 5, 2025" },
    { id: "chat-pane-item", author: "Hao Zhao", createdAt: "2026-06-08T02:08:27.469Z", body: "x... by Hao Zhao Hao Zhao 6/8 10:08 AM Translate full text" },
    { id: "1780884507469", author: "Hao Zhao", createdAt: "2026-06-08T02:08:27.469Z", body: "full text" },
    { id: "chat-pane-item", author: "Ke Gong", createdAt: "2026-06-08T02:18:12.393Z", body: "a... by Ke Gong Ke Gong 6/8 10:18 AM Translate only legacy" },
    { id: "1784195389360", author: "", createdAt: "", body: "Yan Yan added Xiaoming Sui to the chat." },
    { id: "1784195399999", author: "", createdAt: "", body: "Monday, June 29" }
  ]);
  assert.deepEqual(comments.map((c) => c.body), ["full text", "only legacy", "Yan Yan added Xiaoming Sui to the chat.", "Monday, June 29"]);
  assert.equal(comments.find((c) => c.id === "1784195389360").createdAt, "2026-07-16T09:49:49.360Z");
  assert.deepEqual([stats.dividers, stats.duplicates, stats.timesFilled], [1, 1, 2]);
});
