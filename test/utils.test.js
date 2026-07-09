import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanText,
  normalizeTags,
  safeHostname,
  safePathname,
  safeSearch,
  slugify,
  uniqueValues
} from "../src/utils.js";

describe("utils", () => {
  it("normalizes text and unique values", () => {
    assert.equal(cleanText(" a\r\nb "), "a\nb");
    assert.deepEqual(uniqueValues(["a", "", "a", "b"]), ["a", "b"]);
  });

  it("parses URLs safely", () => {
    assert.equal(safeHostname("https://Jira.Amlogic.com/issues/?filter=1"), "jira.amlogic.com");
    assert.equal(safePathname("https://jira.amlogic.com/issues/?filter=1"), "/issues/");
    assert.equal(safeSearch("https://jira.amlogic.com/issues/?filter=1"), "?filter=1");
    assert.equal(safeHostname("not a url"), "");
  });

  it("normalizes tags and slugs", () => {
    assert.deepEqual(normalizeTags(" Jira, jira, CI+ , blocked "), ["jira", "ci+", "blocked"]);
    assert.equal(slugify("TV-221322 [CI+]"), "tv-221322-ci");
  });
});
