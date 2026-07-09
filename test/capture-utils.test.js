import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areCaptureTitlesConsistent,
  isSupportedCaptureContentType,
  normalizeComparableTitle,
  paginate
} from "../src/capture-utils.js";

describe("capture utilities", () => {
  it("normalizes refresh job names and detects Teams cross-conversation titles", () => {
    assert.equal(normalizeComparableTitle("  Roku Announced refresh "), "roku announced");
    assert.equal(areCaptureTitlesConsistent("Roku Announced refresh", "Roku Announced"), true);
    assert.equal(areCaptureTitlesConsistent("Roku Announced refresh", "Samsung Announce Channel"), false);
  });

  it("paginates without losing totals", () => {
    assert.deepEqual(paginate([1, 2, 3, 4, 5], 2, 2), {
      items: [3, 4], total: 5, page: 2, pageSize: 2
    });
  });

  it("allows document responses and rejects binary captures", () => {
    assert.equal(isSupportedCaptureContentType("text/html; charset=utf-8"), true);
    assert.equal(isSupportedCaptureContentType("application/json"), true);
    assert.equal(isSupportedCaptureContentType("application/octet-stream"), false);
  });
});
