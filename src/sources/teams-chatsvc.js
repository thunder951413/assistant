// Teams capture through the chatsvc message API that the Teams web client itself
// calls. It needs no UI navigation or scrolling: given a conversation id and the
// auth headers the logged-in web app is already sending, it pages backwards
// (newest first) until it reaches messages that are already stored.
//
// Auth headers are only ever kept in memory on the WebDriver session object.

const CHATSVC_PATH = /^(https:\/\/[^/]+\/api\/chatsvc\/[^/]+\/v1)\//i;
const AUTH_HEADER = /^(authorization|authentication|x-skypetoken|behavioroverride|clientinfo|x-ms-)/i;
export const TEAMS_CHATSVC_PAGE_SIZE = 200;

// Records the latest chatsvc base URL and auth headers seen on any request the
// Teams page makes. Returns a function that detaches the listener.
export function recordChatsvcAuth(context, target) {
  const onRequest = (request) => {
    const match = request.url().match(CHATSVC_PATH);
    if (!match) return;
    const headers = request.headers();
    if (!headers.authorization && !headers.authentication && !headers["x-skypetoken"]) return;
    target.chatsvcAuth = {
      base: match[1],
      headers: Object.fromEntries(Object.entries(headers).filter(([name]) => AUTH_HEADER.test(name))),
      seenAt: Date.now()
    };
  };
  context.on("request", onRequest);
  return () => context.off("request", onRequest);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);
}

// Converts a Teams RichText/Html body to readable text that keeps line structure,
// code blocks, list items, quoted replies and link targets.
export function teamsHtmlToText(html) {
  let text = String(html || "");
  text = text.replace(/<blockquote[^>]*itemtype="[^"]*Reply"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) =>
    `\n${teamsHtmlToText(inner).split("\n").map((line) => `> ${line}`).join("\n")}\n`);
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => `\n\`\`\`\n${decodeEntities(inner.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))}\n\`\`\`\n`);
  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, (_, alt) => `[${decodeEntities(alt) || "图片"}]`);
  text = text.replace(/<img[^>]*>/gi, "[图片]");
  text = text.replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const plain = decodeEntities(label.replace(/<[^>]+>/g, "")).trim();
    const url = decodeEntities(href);
    return !plain || plain === url ? url : `${plain} (${url})`;
  });
  text = text
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(p|div|ul|ol|h[1-6]|tr|table)(\s[^>]*)?>/gi, "\n")
    .replace(/<\/(p|div|ul|ol|h[1-6]|tr|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t");
  text = decodeEntities(text.replace(/<[^>]+>/g, ""));
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SYSTEM_LABELS = {
  "ThreadActivity/AddMember": "成员加入",
  "ThreadActivity/DeleteMember": "成员离开",
  "ThreadActivity/TopicUpdate": "群名称更新",
  "ThreadActivity/PictureUpdate": "群头像更新",
  "ThreadActivity/HistoryDisclosedUpdate": "聊天记录可见范围更新",
  "ThreadActivity/MemberJoined": "成员加入",
  "ThreadActivity/MemberLeft": "成员离开",
  "Event/Call": "通话"
};

function isoTime(value) {
  const text = String(value ?? "").trim();
  const time = /^\d{12,14}$/.test(text) ? Number(text) : Date.parse(text);
  return Number.isNaN(time) || !text ? "" : new Date(time).toISOString();
}

function systemMessageText(message) {
  const label = SYSTEM_LABELS[message.messagetype] || message.messagetype;
  const content = String(message.content || "");
  const names = [...content.matchAll(/<friendlyname>([^<]*)<\/friendlyname>/gi)].map((m) => decodeEntities(m[1])).filter(Boolean);
  const topic = content.match(/<value>([^<]*)<\/value>/i)?.[1];
  const detail = names.length ? `：${names.join("、")}` : topic && /Topic/i.test(message.messagetype) ? `：${decodeEntities(topic)}` : "";
  return `[${label}${detail}]`;
}

// Maps one chatsvc message to the stored comment shape. Returns null for messages
// that carry nothing to keep (typing indicators, control signals).
export function chatsvcMessageToComment(message, conversationUrl = "") {
  if (!message || message.type && message.type !== "Message") return null;
  const id = String(message.id || "").trim();
  if (!id) return null;
  const type = String(message.messagetype || "");
  const deleted = Boolean(message.properties?.deletetime);
  let body = "";
  if (/^RichText\/Html$/i.test(type)) body = teamsHtmlToText(message.content);
  else if (/^(Text|RichText)$/i.test(type)) body = teamsHtmlToText(message.content);
  else if (/^(ThreadActivity|Event)\//i.test(type)) body = systemMessageText(message);
  else if (/^RichText\/Media_|^RichText\/UriObject/i.test(type)) body = "[附件]";
  else if (/^Control\//i.test(type)) return null;
  else body = teamsHtmlToText(message.content);
  const author = String(message.imdisplayname || message.fromDisplayNameInToken || "").trim();
  const comment = {
    id,
    author: /^(ThreadActivity|Event)\//i.test(type) ? "" : author,
    createdAt: isoTime(message.composetime || message.originalarrivaltime),
    // A deleted message keeps the text captured earlier (merge never erases a body).
    body: deleted ? "" : body,
    url: conversationUrl
  };
  if (deleted) comment.deletedAt = isoTime(message.properties.deletetime);
  if (message.properties?.edittime) comment.editedAt = isoTime(message.properties.edittime);
  if (message.properties?.subject) comment.subject = String(message.properties.subject);
  return comment;
}

export function chatsvcMessagesUrl(base, conversationId, pageSize = TEAMS_CHATSVC_PAGE_SIZE) {
  return `${base}/users/ME/conversations/${encodeURIComponent(conversationId)}/messages?view=msnp24Equivalent|supportsMessageProperties&pageSize=${pageSize}&startTime=1`;
}

// Pages backwards from the newest message. Stops once a page reaches an already
// stored message (incremental refresh), at the start of the conversation, or at
// maxPages. `requestJson(url)` must resolve to { status, json }.
export async function collectChatsvcMessages({ requestJson, base, conversationId, conversationUrl = "", knownIds = new Set(), maxPages = 30, firstCaptureMaxPages = 15, signal }) {
  const comments = new Map();
  let url = chatsvcMessagesUrl(base, conversationId);
  let pages = 0;
  let reachedPrevious = false;
  let reachedStart = false;
  const hasPrevious = knownIds.size > 0;
  const pageLimit = hasPrevious ? maxPages : firstCaptureMaxPages;
  while (url && pages < pageLimit) {
    if (signal?.aborted) throw new DOMException("Teams capture canceled.", "AbortError");
    const { status, json } = await requestJson(url);
    if (status !== 200 || !json) {
      const error = new Error(`Teams 消息接口返回 ${status}`);
      error.status = status;
      throw error;
    }
    pages += 1;
    for (const message of json.messages || []) {
      if (message.conversationid && message.conversationid !== conversationId) {
        throw new Error(`Teams 接口返回的会话 ID 与目标不一致：${message.conversationid}`);
      }
      const comment = chatsvcMessageToComment(message, conversationUrl);
      if (!comment) continue;
      // Stored ids come from the page (data-mid), which equals the chatsvc id; the
      // millisecond time is checked too so a format difference cannot hide overlap.
      if (knownIds.has(comment.id) || (comment.createdAt && knownIds.has(comment.createdAt))) reachedPrevious = true;
      comments.set(comment.id, comment);
    }
    const next = json._metadata?.backwardLink || "";
    if (!next) { reachedStart = true; break; }
    if (reachedPrevious) break;
    url = next;
  }
  const list = [...comments.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const gap = hasPrevious && !reachedPrevious && !reachedStart;
  return {
    comments: list,
    completeness: reachedStart ? "complete" : "partial",
    coverage: {
      method: "chatsvc", pages, observedCount: list.length, reachedPrevious, reachedStart, gap,
      stoppedBy: reachedStart ? "no-more-history" : reachedPrevious ? "previous-overlap" : "limit",
      oldestObservedAt: list[0]?.createdAt || ""
    }
  };
}

// Conversation topic (group chat name); one-to-one chats have none.
export async function fetchChatsvcTopic({ requestJson, base, conversationId }) {
  try {
    const { status, json } = await requestJson(`${base}/users/ME/conversations/${encodeURIComponent(conversationId)}?view=msnp24Equivalent`);
    if (status !== 200) return "";
    return String(json?.threadProperties?.topic || "").trim();
  } catch {
    return "";
  }
}
