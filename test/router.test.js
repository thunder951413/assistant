import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRouter } from "../src/router.js";

describe("router", () => {
  it("matches exact routes and decodes named parameters", async () => {
    const router = createRouter();
    let captured = null;
    router.get("/api/items/:id", async ({ params }) => { captured = params; });
    const matched = await router.handle({ method: "GET" }, {}, new URL("http://localhost/api/items/a%20b"));
    assert.equal(matched, true);
    assert.deepEqual(captured, { id: "a b" });
  });

  it("does not match a different method or segment count", async () => {
    const router = createRouter();
    router.get("/api/items/:id", async () => {});
    assert.equal(await router.handle({ method: "POST" }, {}, new URL("http://localhost/api/items/1")), false);
    assert.equal(await router.handle({ method: "GET" }, {}, new URL("http://localhost/api/items/1/tags")), false);
  });
});
