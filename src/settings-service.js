// Settings: defaults, merging, loading, saving and the public (redacted) view.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { canUseMaterial } from "./ai-policy.js";
import { defaultAutoProcessSettings, normalizeAutoProcessSettings } from "./ai-processing.js";
import { atomicWriteFile } from "./atomic-files.js";
import { exists } from "./fs-helpers.js";
import { defaultDoNotDisturbSettings, defaultNotificationSettings, defaultProcessingPrompts, defaultRefreshSchedule, defaultSourceProfile, mergeRefreshJobs, mergeSourceProfiles, normalizeDoNotDisturbSettings, normalizeNotificationSettings, normalizeProcessingPrompts, normalizeRefreshSchedule } from "./settings-schema.js";
import { applyClientJobEdits, readSettingsFiles } from "./settings-store.js";
import { normalizeFavoriteTags } from "./topics.js";
import { cleanText } from "./utils.js";
import { promises as fs } from "node:fs";

export function createSettingsService(ctx) {
  // Functions that live elsewhere, resolved when called.
  const defaultDocumentRoot = (...args) => ctx.defaultDocumentRoot(...args);
  const isInvalidTeamsRootRefreshJob = (...args) => ctx.isInvalidTeamsRootRefreshJob(...args);

  function redactSettings(value) {
    const copy = structuredClone(value);
    if (copy.ai) copy.ai.apiKey = "";
    if (copy.embedding) copy.embedding.apiKey = "";
    for (const profile of Object.values(copy.sources || {})) {
      profile.password = "";
      profile.cookie = "";
      profile.token = "";
    }
    return copy;
  }

  async function loadSettings() {
    const defaults = defaultSettings();
    if (!(await exists(ctx.settingsPath))) {
      await fs.mkdir(ctx.configDir, { recursive: true });
      await atomicWriteFile(ctx.settingsPath, `${JSON.stringify(defaults, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await fs.chmod(ctx.settingsPath, 0o600).catch(() => {});
      return defaults;
    }

    const saved = await readSettingsFiles({ settingsPath: ctx.settingsPath, runtimePath: ctx.runtimeJobsPath });
    await fs.chmod(ctx.settingsPath, 0o600).catch(() => {});
    return mergeSettings(defaults, saved);
  }

  function exportFilename(prefix) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${prefix}-${stamp}.json`;
  }

  async function importSettingsBundle(payload) {
    const imported = payload?.settings || payload;
    if (!imported || typeof imported !== "object" || Array.isArray(imported)) {
      throw new Error("设置导入文件格式不正确。");
    }
    ctx.settings = mergeSettings(defaultSettings(), imported);
    await ctx.persistSettings();
    return ctx.settings;
  }

  async function saveSettings(input) {
    // Built from the current in-memory state in one synchronous step, so nothing
    // that changes while the file is being written can be overwritten.
    ctx.settings = settingsFromInput(input);
    await ctx.persistSettings();
    return ctx.settings;
  }

  function settingsFromInput(input) {
    return mergeSettings({ ...ctx.settings, refreshJobs: input.refreshJobs ? applyClientJobEdits(ctx.settings.refreshJobs || [], input.refreshJobs) : ctx.settings.refreshJobs }, {
      ai: {
        baseUrl: cleanText(input.ai?.baseUrl ?? input.baseUrl ?? ctx.settings.ai.baseUrl),
        apiKey: cleanText(input.ai?.apiKey ?? input.apiKey ?? ctx.settings.ai.apiKey),
        model: cleanText(input.ai?.model ?? input.model ?? ctx.settings.ai.model)
      },
      embedding: {
        enabled: Boolean(input.embedding?.enabled ?? ctx.settings.embedding?.enabled ?? false),
        baseUrl: cleanText(input.embedding?.baseUrl ?? ctx.settings.embedding?.baseUrl ?? ""),
        apiKey: cleanText(input.embedding?.apiKey ?? ctx.settings.embedding?.apiKey ?? ""),
        model: cleanText(input.embedding?.model ?? ctx.settings.embedding?.model ?? ""),
        dimensions: Number(input.embedding?.dimensions || ctx.settings.embedding?.dimensions || 0)
      },
      chat: {
        showThinking: Boolean(input.chat?.showThinking ?? ctx.settings.chat?.showThinking ?? true),
        showToolCalls: Boolean(input.chat?.showToolCalls ?? ctx.settings.chat?.showToolCalls ?? true)
      },
      doNotDisturb: normalizeDoNotDisturbSettings(input.doNotDisturb || ctx.settings.doNotDisturb || {}),
      notifications: normalizeNotificationSettings(input.notifications || ctx.settings.notifications || {}),
      refreshSchedule: normalizeRefreshSchedule(input.refreshSchedule || ctx.settings.refreshSchedule || {}),
      processingPrompts: normalizeProcessingPrompts(input.processingPrompts || ctx.settings.processingPrompts || {}),
      autoProcess: normalizeAutoProcessSettings(input.autoProcess || ctx.settings.autoProcess || {}),
      favoriteTags: normalizeFavoriteTags(input.favoriteTags ?? ctx.settings.favoriteTags ?? []),
      documentRoot: cleanText(input.documentRoot ?? ctx.settings.documentRoot),
      sources: mergeSourceProfiles(ctx.settings.sources, input.sources || {}),
      refreshJobs: []
    });
  }

  function defaultSettings() {
    return {
      documentRoot: defaultDocumentRoot(),
      ai: {
        baseUrl: "",
        apiKey: "",
        model: "gpt-4.1-mini"
      },
      embedding: {
        enabled: false,
        baseUrl: "",
        apiKey: "",
        model: "Qwen/Qwen3-Embedding-0.6B",
        dimensions: 1024
      },
      chat: {
        showThinking: true,
        showToolCalls: true
      },
      doNotDisturb: defaultDoNotDisturbSettings(),
      notifications: defaultNotificationSettings(),
      refreshSchedule: defaultRefreshSchedule(),
      processingPrompts: defaultProcessingPrompts(),
      autoProcess: defaultAutoProcessSettings(),
      favoriteTags: [],
      sources: {
        "confluence.amlogic.com": defaultSourceProfile("confluence.amlogic.com", "confluence"),
        "jira.amlogic.com": defaultSourceProfile("jira.amlogic.com", "jira"),
        "roku.atlassian.net": defaultSourceProfile("roku.atlassian.net", "jira"),
        "github.ecodesamsung.com": defaultSourceProfile("github.ecodesamsung.com", "github"),
        "teams.microsoft.com": defaultSourceProfile("teams.microsoft.com", "teams")
      },
      refreshJobs: []
    };
  }

  function mergeSettings(base, patch) {
    return {
      ...base,
      ...patch,
      ai: {
        ...base.ai,
        ...(patch.ai || {})
      },
      embedding: {
        ...base.embedding,
        ...(patch.embedding || {})
      },
      chat: {
        ...base.chat,
        ...(patch.chat || {})
      },
      doNotDisturb: normalizeDoNotDisturbSettings({
        ...(base.doNotDisturb || {}),
        ...(patch.doNotDisturb || {})
      }),
      notifications: normalizeNotificationSettings({
        ...(base.notifications || {}),
        ...(patch.notifications || {})
      }),
      refreshSchedule: normalizeRefreshSchedule({
        ...(base.refreshSchedule || {}),
        ...(patch.refreshSchedule || {})
      }),
      processingPrompts: normalizeProcessingPrompts({
        ...(base.processingPrompts || {}),
        ...(patch.processingPrompts || {})
      }),
      autoProcess: normalizeAutoProcessSettings({
        ...(base.autoProcess || {}),
        ...(patch.autoProcess || {})
      }),
      favoriteTags: normalizeFavoriteTags(patch.favoriteTags ?? base.favoriteTags ?? []),
      sources: mergeSourceProfiles(base.sources || {}, patch.sources || {}),
      refreshJobs: mergeRefreshJobs(base.refreshJobs || [], patch.refreshJobs || [])
    };
  }

  function publicSettings() {
    return {
      documentRoot: ctx.settings.documentRoot,
      activeDocumentRoot: ctx.kbDir,
      ai: {
        baseUrl: ctx.settings.ai.baseUrl,
        apiKey: ctx.settings.ai.apiKey ? "********" : "",
        model: ctx.settings.ai.model
      },
      embedding: {
        enabled: Boolean(ctx.settings.embedding?.enabled),
        baseUrl: ctx.settings.embedding?.baseUrl || "",
        apiKey: ctx.settings.embedding?.apiKey ? "********" : "",
        model: ctx.settings.embedding?.model || "",
        dimensions: Number(ctx.settings.embedding?.dimensions || 0)
      },
      chat: {
        showThinking: ctx.settings.chat?.showThinking !== false,
        showToolCalls: ctx.settings.chat?.showToolCalls !== false
      },
      doNotDisturb: normalizeDoNotDisturbSettings(ctx.settings.doNotDisturb || {}),
      notifications: normalizeNotificationSettings(ctx.settings.notifications || {}),
      refreshSchedule: normalizeRefreshSchedule(ctx.settings.refreshSchedule || {}),
      processingPrompts: normalizeProcessingPrompts(ctx.settings.processingPrompts || {}),
      autoProcess: normalizeAutoProcessSettings(ctx.settings.autoProcess || {}),
      favoriteTags: normalizeFavoriteTags(ctx.settings.favoriteTags || []),
      sources: publicSourceProfiles(),
      refreshJobs: publicRefreshJobs()
    };
  }

  function resolveProcessingPrompt(sourceType) {
    const prompts = normalizeProcessingPrompts(ctx.settings.processingPrompts || {});
    return prompts[sourceType] || prompts.web || defaultProcessingPrompts().web;
  }

  function publicRefreshJobs() {
    return (ctx.settings.refreshJobs || [])
      .filter((job) => !isInvalidTeamsRootRefreshJob(job))
      .map((job) => ({
        ...job,
        running: ctx.refreshRuntime.running.has(job.id)
      }));
  }

  function isRemoteAiAllowed(metadata) {
    return canUseMaterial(metadata, ctx.settings);
  }

  function publicSourceProfiles() {
    return Object.fromEntries(Object.entries(ctx.settings.sources || {}).map(([hostname, profile]) => [
      hostname,
      {
        ...profile,
        password: profile.password ? "********" : "",
        cookie: profile.cookie ? "********" : "",
        token: profile.token ? "********" : ""
      }
    ]));
  }

  return { loadSettings, exportFilename, importSettingsBundle, saveSettings, publicSettings, resolveProcessingPrompt, publicRefreshJobs, isRemoteAiAllowed, publicSourceProfiles, redactSettings };
}
