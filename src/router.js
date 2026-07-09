// Lightweight HTTP route matcher — no dependencies.
// Replaces the 386-line if/else chain in handleApi with a declarative route table.
//
// Usage:
//   import { createRouter } from "./router.js";
//   const api = createRouter();
//   api.get("/api/items", handler);
//   api.post("/api/items/:id/tags", handler);
//   const matched = await api.handle(req, res, url);

export function createRouter() {
  const routes = [];

  const self = {
    get(pattern, handler) {
      routes.push({ method: "GET", pattern, handler });
      return self;
    },
    post(pattern, handler) {
      routes.push({ method: "POST", pattern, handler });
      return self;
    },
    patch(pattern, handler) {
      routes.push({ method: "PATCH", pattern, handler });
      return self;
    },
    delete(pattern, handler) {
      routes.push({ method: "DELETE", pattern, handler });
      return self;
    },

    // Returns true if a route matched, false otherwise.
    async handle(req, res, url) {
      for (const { method, pattern, handler } of routes) {
        if (method !== req.method) continue;
        const params = matchPattern(pattern, url.pathname);
        if (params === null) continue;
        await handler({ req, res, url, params });
        return true;
      }
      return false;
    }
  };

  return self;
}

// Match a pattern like "/api/items/:id/tags" against "/api/items/foo/tags".
// Returns null on mismatch, or an object with decoded param values.
function matchPattern(pattern, pathname) {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");

  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}
