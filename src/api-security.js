import { timingSafeEqual } from 'node:crypto';
export function validateApiRequest(req, url, { captureToken = '' } = {}) {
  const fail = (message, statusCode = 403) => { const error = new Error(message); error.statusCode = statusCode; throw error; };
  const host = new URL(`http://${req.headers.host || ''}`).hostname;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) fail('请通过本机地址访问应用。');
  const origin = req.headers.origin;
  const provided = String(req.headers['x-capture-token'] || '');
  const paired = url.pathname === '/api/items/upsert-capture' && Buffer.byteLength(provided) === Buffer.byteLength(captureToken) && provided.length > 0 && timingSafeEqual(Buffer.from(provided), Buffer.from(captureToken));
  if (origin && origin !== `http://${req.headers.host}` && !paired) fail('拒绝来自其他网站的请求。');
  if (['POST','PATCH','PUT'].includes(req.method) && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) fail('请求必须使用 application/json。', 415);
}
