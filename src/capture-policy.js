// Capture facts shared by HTTP, API, and user-initiated capture paths.
// A partial observation may add or edit messages, but can never imply deletion.

export function normalizeCaptureCompleteness(value, fallback = "unknown") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["complete", "partial", "unknown"].includes(normalized) ? normalized : fallback;
}

export function prepareListCapture(capture = {}, maxItems = 50, extractEntries = () => []) {
  const sourceEntries = Array.isArray(capture.entries) ? capture.entries : extractEntries();
  const limit = Math.max(1, Number(maxItems) || 50);
  const links = sourceEntries.slice(0, limit);
  const truncatedByLimit = sourceEntries.length > links.length;
  const completeness = truncatedByLimit
    ? "partial"
    : normalizeCaptureCompleteness(capture.completeness, "unknown");
  return {
    links,
    completeness,
    coverage: {
      ...(capture.coverage && typeof capture.coverage === "object" ? capture.coverage : {}),
      observedCount: sourceEntries.length,
      processedCount: links.length,
      maxItems: limit,
      truncatedByLimit
    }
  };
}

export function nextDueCaptureSlot(job, now = new Date(), schedule = {}) {
  const intervalMinutes = Math.max(5, Number(job.intervalMinutes) || 60);
  const start = parseTime(schedule?.startTime || "08:00", "08:00");
  const end = parseTime(schedule?.endTime || "20:00", "20:00");
  const startAt = new Date(now);
  startAt.setHours(start.hours, start.minutes, 0, 0);
  const endAt = new Date(now);
  endAt.setHours(end.hours, end.minutes, 0, 0);
  if (endAt < startAt) {
    if (now <= endAt) startAt.setDate(startAt.getDate() - 1);
    else endAt.setDate(endAt.getDate() + 1);
  }
  if (now < startAt || now > endAt) return null;
  const slotIndex = Math.floor((now.getTime() - startAt.getTime()) / 60000 / intervalMinutes);
  const dueAt = new Date(startAt.getTime() + slotIndex * intervalMinutes * 60000);
  if (dueAt > endAt) return null;
  const lastRunAt = job.lastRunAt ? new Date(job.lastRunAt) : null;
  return lastRunAt && lastRunAt >= dueAt ? null : dueAt;
}

export async function withWebdriverSessionQueue(session, task) {
  const previous = session.operationQueue || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  session.operationQueue = previous.catch(() => {}).then(() => current);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

export function shouldCloseOwnedWebdriverSession(session, ownsSession) {
  return Boolean(session?.autoClose && (ownsSession || session?.closeWhenIdle) && Number(session.activeOperations || 0) === 0);
}

export function extractTeamsMessagesFromDocument(document = globalThis.document) {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const pickTitle = () => {
    for (const selector of ["[data-tid='channel-name']", "[data-tid='chat-title']", "[data-tid='conversation-header-title']", "h1", "[role='heading']"]) {
      const text = clean(document.querySelector(selector)?.textContent);
      if (text) return text;
    }
    return clean(document.title) || "Microsoft Teams conversation";
  };
  const nearestMessageContainer = (node) => {
    let current = node.parentElement;
    while (current) {
      if (current.matches("[data-tid='chat-pane-item'], [data-tid='message-container'], [data-tid='control-message-renderer']")) return current;
      current = current.parentElement;
    }
    return node;
  };
  const buildMessage = (bodyNode) => {
    const node = nearestMessageContainer(bodyNode);
    const author = clean(node.querySelector("[data-tid*='author'],[data-tid*='sender'],[data-tid*='message-author'],[class*='author'],[class*='sender']")?.textContent) || clean(node.getAttribute("data-author"));
    const createdAt = node.querySelector("time")?.getAttribute("datetime") || node.querySelector("[datetime]")?.getAttribute("datetime") || clean(node.querySelector("[data-tid*='timestamp'],[class*='timestamp'],[aria-label*='sent'],[aria-label*='发送']")?.textContent);
    const attachmentText = [...bodyNode.querySelectorAll("img, a[href]")]
      .map((element) => clean(element.getAttribute("alt") || element.textContent) || (element.tagName === "IMG" ? "图片" : "附件"))
      .filter(Boolean).map((text) => `[${text}]`).filter((text, index, values) => values.indexOf(text) === index).join(" ");
    const body = clean(bodyNode.innerText || bodyNode.textContent) || attachmentText;
    const id = clean(bodyNode.getAttribute("data-mid") || bodyNode.getAttribute("data-message-id") || "");
    return { id, author, createdAt, body, links: [...node.querySelectorAll("a[href]")].map((link) => ({ text: clean(link.textContent), href: link.href })).filter((link) => link.href) };
  };
  const stableNodes = [...document.querySelectorAll("[data-mid], [data-message-id]")]
    .filter((node) => clean(node.getAttribute("data-mid") || node.getAttribute("data-message-id")));
  if (stableNodes.length) return { title: pickTitle(), messages: stableNodes.map(buildMessage).filter((message) => message.body) };
  const fallback = [...document.querySelectorAll("[data-tid='control-message-renderer'], [role='listitem'], [data-tid*='messageBody'], [data-tid*='message-body']")]
    .filter((node) => clean(node.textContent).length > 0 || node.querySelector("img, a[href]"));
  const messages = fallback.map(buildMessage).filter((message) => message.body);
  return { title: pickTitle(), messages };
}

export function mergeTeamsCaptureMessages(messages = []) {
  const byKey = new Map();
  for (const value of messages) {
    const message = normalizeTeamsMessage(value);
    if (!message.body) continue;
    const key = teamsCaptureMessageIdentity(message);
    if (!byKey.has(key) || hasStableTeamsMessageId(message.id)) byKey.set(key, message);
  }
  return [...byKey.values()].sort((a, b) => `${a.createdAt}\n${a.id}\n${a.body}`.localeCompare(`${b.createdAt}\n${b.id}\n${b.body}`));
}

export function teamsCaptureMessageKeys(message) {
  const normalized = normalizeTeamsMessage(message);
  if (!normalized.body) return [];
  return [teamsCaptureMessageIdentity(normalized)];
}

export async function collectVirtualTeamsMessages(options = {}) {
  const maxScrolls = Math.max(0, Number(options.maxScrolls ?? 18));
  const minScrollsBeforeOverlapStop = Math.max(1, Number(options.minScrollsBeforeOverlapStop ?? 2));
  const previous = new Set((options.previousMessages || []).flatMap(teamsCaptureMessageKeys));
  const observed = [];
  const remember = async () => { observed.push(...((await options.readVisible())?.messages || [])); };
  const ensureActive = () => {
    if (options.signal?.aborted) throw new DOMException("Teams capture canceled.", "AbortError");
  };
  ensureActive();
  await options.jumpToLatest?.();
  await remember();
  ensureActive();
  let stableRounds = 0;
  let stoppedBy = "limit";
  for (let index = 0; index < maxScrolls; index += 1) {
    ensureActive();
    const before = mergeTeamsCaptureMessages(observed);
    const moved = await options.scrollOlder();
    ensureActive();
    await options.wait?.();
    ensureActive();
    await remember();
    ensureActive();
    const after = mergeTeamsCaptureMessages(observed);
    const hasOverlap = after.some((message) => teamsCaptureMessageKeys(message).some((key) => previous.has(key)));
    if (index + 1 >= minScrollsBeforeOverlapStop && hasOverlap) { stoppedBy = "previous-overlap"; break; }
    stableRounds = moved || after.length > before.length ? 0 : stableRounds + 1;
    if (stableRounds >= 3) { stoppedBy = "no-more-history"; break; }
  }
  ensureActive();
  await options.returnToLatest?.();
  ensureActive();
  await remember();
  ensureActive();
  const messages = mergeTeamsCaptureMessages(observed);
  return { messages, completeness: "partial", coverage: { observedCount: messages.length, maxScrolls, minScrollsBeforeOverlapStop, stoppedBy } };
}

export function mergeTeamsCommentsByIdentity(existing = [], observed = []) {
  const merged = new Map();
  for (const comment of existing) addComment(merged, comment, false);
  for (const comment of observed) addComment(merged, comment, true);
  return [...merged.values()].sort(compareComments);
}

export async function readResponseBodyLimited(response, maxBytes, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("Fetched response is too large.");
    return text;
  }
  const chunks = [];
  let total = 0;
  const cancelReader = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener?.("abort", cancelReader, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Capture canceled.", "AbortError");
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException("Capture canceled.", "AbortError");
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Fetched response is too large.");
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener?.("abort", cancelReader);
    if (signal?.aborted || total > maxBytes) await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(concatChunks(chunks, total));
}

function concatChunks(chunks, size) {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function parseTime(value, fallback) {
  const text = /^\d{1,2}:\d{2}$/.test(String(value || "").trim()) ? String(value).trim() : fallback;
  const [rawHours, rawMinutes] = text.split(":").map(Number);
  return { hours: Math.min(23, Math.max(0, rawHours || 0)), minutes: Math.min(59, Math.max(0, rawMinutes || 0)) };
}

function normalizeTeamsMessage(value = {}) {
  return {
    id: String(value.id || "").trim(),
    author: String(value.author || "").replace(/\s+/g, " ").trim(),
    createdAt: String(value.createdAt || "").replace(/\s+/g, " ").trim(),
    body: String(value.body || "").replace(/\s+/g, " ").trim(),
    links: Array.isArray(value.links) ? value.links : []
  };
}

function hasStableTeamsMessageId(id) {
  const canonical = canonicalTeamsMessageId(id);
  return Boolean(canonical && !isGenericTeamsDomId(canonical));
}

function teamsCaptureMessageIdentity(message) {
  if (hasStableTeamsMessageId(message.id)) return `id:${canonicalTeamsMessageId(message.id)}`;
  return `observed:${message.author}\n${message.createdAt}\n${message.body}`;
}

function addComment(target, value, replace) {
  const comment = normalizeComment(value);
  if (!comment.body && !comment.id) return;
  const stable = stableMessageId(comment.id);
  // A DOM row ordinal is not an identity.  Use content identity only as a
  // conservative de-duplication key for captures without a server message id.
  const key = stable ? `id:${stable}` : `observed:${comment.author}\n${comment.createdAt}\n${comment.body}`;
  if (!target.has(key) || replace) target.set(key, comment);
}

function normalizeComment(value = {}) {
  return {
    id: String(value.id || "").trim(),
    author: String(value.author || "").trim(),
    createdAt: String(value.createdAt || "").trim(),
    body: String(value.body || "").trim(),
    links: Array.isArray(value.links) ? value.links : [],
    url: String(value.url || "").trim()
  };
}

function stableMessageId(value) {
  const id = canonicalTeamsMessageId(value);
  if (!id || isGenericTeamsDomId(id)) return "";
  return id;
}

function canonicalTeamsMessageId(value) {
  const id = String(value || "").trim();
  return id.match(/^message-body-(.+)$/i)?.[1] || id;
}

function isGenericTeamsDomId(value) {
  return /^(?:teams-(?:visible|message)-\d+|chat-pane-item|message-container|chat-pane-message|messagebodycontent|message-body-\d+|author-\d+|timestamp-\d+)$/i.test(String(value || "").trim());
}

function compareComments(a, b) {
  const aTime = Date.parse(a.createdAt || "");
  const bTime = Date.parse(b.createdAt || "");
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) return aTime - bTime;
  return `${a.createdAt}\n${a.id}\n${a.body}`.localeCompare(`${b.createdAt}\n${b.id}\n${b.body}`);
}
