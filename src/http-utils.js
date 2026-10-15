// HTTP response helpers: JSON, downloads, server-sent events and security headers.


export async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  const maxBytes = req.url?.startsWith("/api/import/data") ? 128 * 1024 * 1024 : 16 * 1024 * 1024;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) { const error = new Error("请求内容超过大小限制。"); error.statusCode = 413; throw error; }
    chunks.push(chunk);
  }
  try { const text = Buffer.concat(chunks).toString("utf8"); return text ? JSON.parse(text) : {}; }
  catch { const error = new Error("请求不是有效的 JSON。"); error.statusCode = 400; throw error; }
}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...securityHeaders()
  });
  res.end(JSON.stringify(payload));
}

export function sendJsonDownload(res, filename, payload) {
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    ...securityHeaders()
  });
  res.end(content);
}

// Text download with a UTF-8 file name (RFC 5987) and an ASCII fallback.
export function sendTextDownload(res, filename, content, contentType = "text/markdown; charset=utf-8") {
  const fallback = filename.replace(/[^\x20-\x7e]+/g, "_").replace(/["\\]/g, "_") || "export";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    ...securityHeaders()
  });
  res.end(content);
}

export function startSse(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...securityHeaders()
  });
}

export function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY"
  };
}

export async function withResponseCancellation(res, operation) {
  const controller = new AbortController();
  const abort = () => { if (!res.writableEnded) controller.abort(); };
  res.on("close", abort);
  try { return await operation(controller.signal); }
  finally { res.removeListener("close", abort); }
}
