// Defaults and normalization for persisted settings, refresh jobs and source profiles.
// Pure functions: they never read or write the live settings object.
import { cleanText, normalizeTags, slugify } from "./utils.js";

export function parseTimeOfDay(value, fallback) {
  const text = /^\d{1,2}:\d{2}$/.test(cleanText(value)) ? cleanText(value) : fallback;
  const [rawHours, rawMinutes] = text.split(":").map((part) => Number(part));
  return {
    hours: Math.min(23, Math.max(0, rawHours || 0)),
    minutes: Math.min(59, Math.max(0, rawMinutes || 0))
  };
}

export function normalizeWebdriverWindowMode(value) {
  return ["normal", "compact", "minimized"].includes(value) ? value : "compact";
}

export function defaultDoNotDisturbSettings() {
  return {
    enabled: false
  };
}

export function normalizeDoNotDisturbSettings(input = {}) {
  return {
    enabled: Boolean(input.enabled)
  };
}

export function defaultNotificationSettings() {
  return {
    enabled: true,
    sources: {
      confluence: true,
      jira: true,
      github: true,
      teams: true,
      web: false,
      text: false
    }
  };
}

export function defaultRefreshSchedule() {
  return {
    startTime: "08:00",
    endTime: "20:00"
  };
}

export function normalizeRefreshSchedule(input = {}) {
  const defaults = defaultRefreshSchedule();
  return {
    startTime: formatTimeOfDay(input.startTime || defaults.startTime, defaults.startTime),
    endTime: formatTimeOfDay(input.endTime || defaults.endTime, defaults.endTime)
  };
}

export function formatTimeOfDay(value, fallback) {
  const parsed = parseTimeOfDay(value, fallback);
  return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
}

export function normalizeNotificationSettings(input = {}) {
  const defaults = defaultNotificationSettings();
  const sourceTypes = Object.keys(defaults.sources);
  return {
    enabled: input.enabled !== false,
    sources: Object.fromEntries(sourceTypes.map((sourceType) => [
      sourceType,
      input.sources?.[sourceType] ?? defaults.sources[sourceType]
    ]).map(([sourceType, enabled]) => [sourceType, Boolean(enabled)]))
  };
}

export function defaultProcessingPrompts() {
  return {
    text: [
      "你是文本资料整理助手。",
      "请把输入内容整理成可检索、可复用的知识条目。",
      "重点提取主题、关键事实、术语、结论、待确认问题和后续动作。"
    ].join("\n"),
    web: [
      "你是网页资料整理助手。",
      "请过滤导航、页脚、广告和重复内容，保留正文信息。",
      "整理为：一句话结论、关键内容、重要链接/引用、可能需要后续追踪的点。"
    ].join("\n"),
    confluence: [
      "你是 Confluence 文档整理助手。",
      "请提取页面目的、背景、方案/规则、关键步骤、配置项、风险点和待办。",
      "如果内容像需求或设计文档，请按模块和决策点整理。"
    ].join("\n"),
    jira: [
      "你是 Jira 问题进展整理助手。",
      "请重点提取：问题概述、当前状态、负责人/相关人、复现条件、关键进展、阻塞点、评论结论、下一步动作。",
      "评论很多时不要逐条复述，只保留推动问题状态变化的信息。"
    ].join("\n"),
    github: [
      "你是 GitHub issue/PR 讨论整理助手。",
      "请提取问题背景、讨论结论、代码/方案变化、review 关注点、未解决分歧、下一步动作。",
      "对通知列表或多条 issue，请按条目归纳高优先级事项。"
    ].join("\n"),
    teams: [
      "你是 Teams 对话整理助手。",
      "请从聊天记录中提取真正有用的信息：结论、决策、问题、行动项、负责人、时间点和待确认事项。",
      "不要流水账复述寒暄；如果对话只是沟通背景，请压缩成简短背景说明。"
    ].join("\n")
  };
}

export function normalizeProcessingPrompts(prompts) {
  const defaults = defaultProcessingPrompts();
  const sourceTypes = ["text", "web", "confluence", "jira", "github", "teams"];
  return Object.fromEntries(sourceTypes.map((sourceType) => [
    sourceType,
    cleanText(prompts?.[sourceType] || defaults[sourceType])
  ]));
}

export function defaultRefreshJob(id, name, url) {
  return {
    id,
    name,
    url,
    enabled: false,
    intervalMinutes: 60,
    maxItems: 50,
    tags: [],
    fetchMode: "webdriver",
    pageKind: "list",
    status: "idle",
    lastRunAt: "",
    lastStartedAt: "",
    lastError: "",
    lastResult: null,
    consecutiveFailures: 0,
    nextRetryAt: "",
    circuitOpen: false
  };
}

export function mergeRefreshJobs(base = [], patch = []) {
  const next = new Map();
  for (const job of base) {
    if (job?.id) next.set(job.id, normalizeRefreshJob(job, job));
  }
  for (const job of patch) {
    if (!job?.id && !job?.url) continue;
    const id = cleanText(job.id || slugify(job.url));
    const previous = next.get(id) || defaultRefreshJob(id, cleanText(job.name || id), cleanText(job.url || ""));
    next.set(id, normalizeRefreshJob(job, previous));
  }
  return [...next.values()];
}

export function normalizeRefreshJob(input, previous = {}) {
  const id = cleanText(input.id || previous.id || slugify(input.url || previous.url || "refresh-job"));
  return {
    ...previous,
    id,
    name: cleanText(input.name ?? previous.name ?? id),
    url: cleanText(input.url ?? previous.url ?? ""),
    enabled: Boolean(input.enabled),
    intervalMinutes: Math.max(5, Number(input.intervalMinutes ?? previous.intervalMinutes ?? 60) || 60),
    maxItems: Math.max(1, Number(input.maxItems ?? previous.maxItems ?? 50) || 50),
    tags: normalizeTags(input.tags ?? previous.tags ?? []),
    fetchMode: cleanText(input.fetchMode ?? previous.fetchMode ?? "webdriver"),
    pageKind: cleanText(input.pageKind ?? previous.pageKind ?? "list"),
    managedBy: cleanText(input.managedBy ?? previous.managedBy ?? ""),
    quarantined: Boolean(input.quarantined ?? previous.quarantined ?? false),
    quarantineReason: cleanText(input.quarantineReason ?? previous.quarantineReason ?? ""),
    status: cleanText(input.status ?? previous.status ?? "idle"),
    lastRunAt: cleanText(input.lastRunAt ?? previous.lastRunAt ?? ""),
    lastStartedAt: cleanText(input.lastStartedAt ?? previous.lastStartedAt ?? ""),
    lastError: cleanText(input.lastError ?? previous.lastError ?? ""),
    lastResult: input.lastResult ?? previous.lastResult ?? null,
    consecutiveFailures: Math.max(0, Number(input.consecutiveFailures ?? previous.consecutiveFailures ?? 0) || 0),
    nextRetryAt: cleanText(input.nextRetryAt ?? previous.nextRetryAt ?? ""),
    circuitOpen: Boolean(input.circuitOpen ?? previous.circuitOpen ?? false)
  };
}

export function refreshFailureState(job) {
  const consecutiveFailures = Math.max(0, Number(job.consecutiveFailures) || 0) + 1;
  const circuitOpen = consecutiveFailures >= 5;
  const delayMinutes = Math.min(24 * 60, 5 * 2 ** Math.min(8, consecutiveFailures - 1));
  return {
    consecutiveFailures,
    circuitOpen,
    nextRetryAt: circuitOpen ? "" : new Date(Date.now() + delayMinutes * 60000).toISOString()
  };
}

export function defaultSourceProfile(hostname, sourceType) {
  return {
    hostname,
    sourceType,
    authMode: "none",
    username: "",
    password: "",
    cookie: "",
    token: "",
    webdriverHeadless: false,
    webdriverWindowMode: "compact",
    allowRemoteAi: true
  };
}

export function mergeSourceProfiles(base = {}, patch = {}) {
  const next = { ...base };
  for (const [hostname, profile] of Object.entries(patch)) {
    const previous = next[hostname] || defaultSourceProfile(hostname, "web");
    next[hostname] = {
      ...previous,
      ...profile,
      hostname,
      webdriverHeadless: Boolean(profile.webdriverHeadless ?? previous.webdriverHeadless),
      allowRemoteAi: Boolean(profile.allowRemoteAi ?? previous.allowRemoteAi ?? true),
      webdriverWindowMode: normalizeWebdriverWindowMode(profile.webdriverWindowMode ?? previous.webdriverWindowMode),
      password: profile.password === "********" ? previous.password : cleanText(profile.password ?? previous.password),
      cookie: profile.cookie === "********" ? previous.cookie : cleanText(profile.cookie ?? previous.cookie),
      token: profile.token === "********" ? previous.token : cleanText(profile.token ?? previous.token)
    };
  }
  return next;
}
