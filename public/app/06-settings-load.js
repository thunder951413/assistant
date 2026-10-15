async function loadAgentConfig() {
  const config = await api("/api/agent-config");
  agentRoot.textContent = config.rootDir;
}

async function loadSettings() {
  const { settings } = await api("/api/settings");
  state.settings = settings;
  settingBaseUrl.value = settings.ai.baseUrl || "";
  settingApiKey.value = settings.ai.apiKey || "";
  settingModel.value = settings.ai.model || "";
  if (aiPrivacyNotice) {
    let host = "";
    try { host = new URL(settings.ai.baseUrl || "").hostname; } catch { host = ""; }
    const remote = host && !["localhost", "127.0.0.1", "::1"].includes(host);
    let embeddingHost = "";
    try { embeddingHost = new URL(settings.embedding?.baseUrl || "").hostname; } catch { embeddingHost = ""; }
    const embeddingRemote = Boolean(settings.embedding?.enabled && embeddingHost && !["localhost", "127.0.0.1", "::1"].includes(embeddingHost));
    aiPrivacyNotice.textContent = remote
      ? `当前使用远程 AI：${host}。问答、总结、标题、标签和资料整理会发送相关资料片段。`
      : embeddingRemote ? `当前 Embedding 使用远程服务：${embeddingHost}。资料向量化同样受来源隐私策略限制。`
      : host ? "当前 AI 运行在本机地址。" : "尚未配置 AI 或 Embedding；资料不会发送到模型服务。";
    aiPrivacyNotice.classList.toggle("is-remote", Boolean(remote || embeddingRemote));
  }
  settingShowThinking.checked = settings.chat?.showThinking !== false;
  settingShowToolCalls.checked = settings.chat?.showToolCalls !== false;
  setDoNotDisturbState(Boolean(settings.doNotDisturb?.enabled), { renderOnly: true });
  settingNotificationsEnabled.checked = settings.notifications?.enabled !== false;
  for (const input of notificationSourceInputs) {
    input.checked = settings.notifications?.sources?.[input.dataset.notificationSource] !== false;
  }
  settingRefreshStartTime.value = settings.refreshSchedule?.startTime || "08:00";
  settingRefreshEndTime.value = settings.refreshSchedule?.endTime || "20:00";
  settingEmbeddingEnabled.checked = Boolean(settings.embedding?.enabled);
  settingEmbeddingBaseUrl.value = settings.embedding?.baseUrl || "";
  settingEmbeddingApiKey.value = settings.embedding?.apiKey || "";
  settingEmbeddingModel.value = settings.embedding?.model || "";
  settingEmbeddingDimensions.value = settings.embedding?.dimensions || "";
  for (const field of processingPromptFields) {
    field.value = settings.processingPrompts?.[field.dataset.processingPrompt] || "";
  }
  settingDocumentRoot.value = settings.documentRoot || "";
  fillAutoProcessFields(settings.autoProcess);
  activeDocumentRoot.textContent = settings.activeDocumentRoot || settings.documentRoot || "";
  renderSourceProfiles(settings.sources || {});
  renderRefreshJobs(settings.refreshJobs || []);
  rememberLatestRefreshRun(settings.refreshJobs || []);
  await loadSettingsTags();
  await loadStorageStats();
}

async function loadStorageStats() {
  if (!storageStatsElement) return;
  try {
    const { stats } = await api("/api/storage-stats");
    storageStatsElement.textContent = formatStorageStats(stats);
  } catch (error) {
    storageStatsElement.textContent = `无法读取存储占用：${error.message}`;
  }
}

function formatStorageStats(stats = {}) {
  return `知识库 ${formatBytes(stats.knowledgeBytes)} · 历史快照 ${formatBytes(stats.snapshotBytes)} · WebDriver 登录数据 ${formatBytes(stats.webdriverBytes)}（其中可清理缓存 ${formatBytes(stats.browserCacheBytes)}）`;
}

async function cleanupSnapshots() {
  if (!cleanupSnapshotsButton) return;
  const confirmed = window.confirm("将删除每条资料超过最近 20 个版本的旧快照，并压缩历史快照中的原始抓取内容。当前资料和最近 20 个版本的正文、评论不受影响。是否继续？");
  if (!confirmed) return;
  cleanupSnapshotsButton.disabled = true;
  storageCleanupStatus.textContent = "正在清理并压缩旧快照...";
  try {
    const { result, stats } = await api("/api/storage-cleanup", { method: "POST" });
    storageCleanupStatus.textContent = `已删除 ${result.removedSnapshots} 个旧快照，压缩 ${result.compressedFiles || 0} 个原始文件，释放 ${formatBytes(result.reclaimedBytes)}。`;
    storageStatsElement.textContent = formatStorageStats(stats);
  } catch (error) {
    storageCleanupStatus.textContent = error.message;
  } finally {
    cleanupSnapshotsButton.disabled = false;
  }
}

async function cleanupBrowserCache() {
  if (!cleanupBrowserCacheButton) return;
  const confirmed = window.confirm("将清理 WebDriver 浏览器的页面缓存、脚本缓存和 Service Worker 缓存。Cookie、登录状态和本地存储会保留；正在使用的浏览器窗口会跳过。是否继续？");
  if (!confirmed) return;
  cleanupBrowserCacheButton.disabled = true;
  storageCleanupStatus.textContent = "正在清理浏览器缓存...";
  try {
    const { result, stats } = await api("/api/storage-cleanup-browser", { method: "POST" });
    const skipped = (result.profiles || []).filter((profile) => profile.skipped).map((profile) => profile.profile);
    storageCleanupStatus.textContent = `已释放 ${formatBytes(result.reclaimedBytes)}。${skipped.length ? `正在使用中已跳过：${skipped.join("、")}。` : ""}`;
    storageStatsElement.textContent = formatStorageStats(stats);
  } catch (error) {
    storageCleanupStatus.textContent = error.message;
  } finally {
    cleanupBrowserCacheButton.disabled = false;
  }
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes;
  let index = -1;
  do {
    amount /= 1024;
    index += 1;
  } while (amount >= 1024 && index < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
}

