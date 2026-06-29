const state = {
  view: "home",
  items: [],
  tags: [],
  chatSessions: [],
  activeChatId: "",
  importPreview: null,
  refreshJobs: [],
  tagEditor: {
    item: null,
    selected: [],
    recommended: []
  },
  batchProcess: {
    items: [],
    tagAssignments: [],
    tagOptions: [],
    selectedTags: [],
    errors: [],
    cancelRequested: false,
    running: false
  },
  settingsTags: [],
  selectedSettingsTags: new Set(),
  supplementalEntries: [],
  updateCount: 0,
  refreshReloadTimer: null,
  refreshMonitorTimer: null,
  homeSourceRefresh: {
    confirmSource: "",
    runningSource: "",
    runId: "",
    requestToken: "",
    startedAt: "",
    total: 0,
    completed: 0,
    failed: 0,
    message: "",
    pollErrorCount: 0,
    pollTimer: null,
    timeoutAt: 0
  },
  activeRefreshRun: {
    id: "",
    scope: "",
    pollTimer: null
  },
  seenRefreshRunKey: localStorage.getItem("materialOrganizer.seenRefreshRunKey") || "",
  listClassification: null,
  listClassifying: false,
  listClassifier: {
    categories: loadStoredListCategories()
  },
  subscriptionSource: "all",
  settingsTab: "ai",
  detailMode: localStorage.getItem("materialOrganizer.detailMode") || "processed",
  selectedId: null,
  sourceType: "",
  tag: "",
  query: ""
};

const itemList = document.querySelector("#itemList");
const tagList = document.querySelector("#tagList");
const materialsNewBadge = document.querySelector("#materialsNewBadge");
const sidebar = document.querySelector(".sidebar");
const materialSidebar = document.querySelector("#materialSidebar");
const homeTotalItems = document.querySelector("#homeTotalItems");
const homeSourceSummary = document.querySelector("#homeSourceSummary");
const homeUpdateCount = document.querySelector("#homeUpdateCount");
const homeSubscriptionCount = document.querySelector("#homeSubscriptionCount");
const homeSubscriptionStatus = document.querySelector("#homeSubscriptionStatus");
const homeTagCount = document.querySelector("#homeTagCount");
const homeRunningJobs = document.querySelector("#homeRunningJobs");
const homeFailedJobs = document.querySelector("#homeFailedJobs");
const homeEnabledJobs = document.querySelector("#homeEnabledJobs");
const homeRefreshTaskRows = document.querySelector("#homeRefreshTaskRows");
const homeRefreshTaskCount = document.querySelector("#homeRefreshTaskCount");
const homeSourceCounts = {
  confluence: document.querySelector("#homeSourceConfluence"),
  jira: document.querySelector("#homeSourceJira"),
  github: document.querySelector("#homeSourceGithub"),
  teams: document.querySelector("#homeSourceTeams"),
  web: document.querySelector("#homeSourceWeb")
};
const homeSourceNewCounts = {
  confluence: document.querySelector("#homeSourceConfluenceNew"),
  jira: document.querySelector("#homeSourceJiraNew"),
  github: document.querySelector("#homeSourceGithubNew"),
  teams: document.querySelector("#homeSourceTeamsNew"),
  web: document.querySelector("#homeSourceWebNew")
};
const filterTabs = [...document.querySelectorAll("[data-filter-tab]")];
const filterPanels = [...document.querySelectorAll("[data-filter-panel]")];
const homeView = document.querySelector("#homeView");
const chatView = document.querySelector("#chatView");
const materialsView = document.querySelector("#materialsView");
const importView = document.querySelector("#importView");
const supplementalView = document.querySelector("#supplementalView");
const subscriptionsView = document.querySelector("#subscriptionsView");
const settingsView = document.querySelector("#settingsView");
const detailPanel = document.querySelector("#detailPanel");
const materialsTitle = document.querySelector("#materialsTitle");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const classifyListButton = document.querySelector("#classifyListButton");
const batchProcessButton = document.querySelector("#batchProcessButton");
const agentRoot = document.querySelector("#agentRoot");
const chatSessionTitle = document.querySelector("#chatSessionTitle");
const chatHistoryList = document.querySelector("#chatHistoryList");
const newChatButton = document.querySelector("#newChatButton");
const clearChatHistoryButton = document.querySelector("#clearChatHistoryButton");
const chatMessages = document.querySelector("#chatMessages");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const importForm = document.querySelector("#importForm");
const importContent = document.querySelector("#importContent");
const importSourceType = document.querySelector("#importSourceType");
const importFetchMode = document.querySelector("#importFetchMode");
const importPageKind = document.querySelector("#importPageKind");
const importUrl = document.querySelector("#importUrl");
const dropZone = document.querySelector("#dropZone");
const previewStatus = document.querySelector("#previewStatus");
const previewBadge = document.querySelector("#previewBadge");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmTags = document.querySelector("#confirmTags");
const previewContent = document.querySelector("#previewContent");
const summarizeButton = document.querySelector("#summarizeButton");
const summaryStatus = document.querySelector("#summaryStatus");
const summaryContent = document.querySelector("#summaryContent");
const confirmImportButton = document.querySelector("#confirmImportButton");
const clearImportButton = document.querySelector("#clearImportButton");
const copyPreviewButton = document.querySelector("#copyPreviewButton");
const settingsForm = document.querySelector("#settingsForm");
const settingsTabs = [...document.querySelectorAll("[data-settings-tab]")];
const settingsPanels = [...document.querySelectorAll("[data-settings-panel]")];
const settingBaseUrl = document.querySelector("#settingBaseUrl");
const settingApiKey = document.querySelector("#settingApiKey");
const settingModel = document.querySelector("#settingModel");
const settingShowThinking = document.querySelector("#settingShowThinking");
const settingShowToolCalls = document.querySelector("#settingShowToolCalls");
const settingNotificationsEnabled = document.querySelector("#settingNotificationsEnabled");
const notificationSourceInputs = [...document.querySelectorAll("[data-notification-source]")];
const settingRefreshStartTime = document.querySelector("#settingRefreshStartTime");
const settingRefreshEndTime = document.querySelector("#settingRefreshEndTime");
const settingEmbeddingEnabled = document.querySelector("#settingEmbeddingEnabled");
const settingEmbeddingBaseUrl = document.querySelector("#settingEmbeddingBaseUrl");
const settingEmbeddingApiKey = document.querySelector("#settingEmbeddingApiKey");
const settingEmbeddingModel = document.querySelector("#settingEmbeddingModel");
const settingEmbeddingDimensions = document.querySelector("#settingEmbeddingDimensions");
const processingPromptFields = [...document.querySelectorAll("[data-processing-prompt]")];
const settingDocumentRoot = document.querySelector("#settingDocumentRoot");
const activeDocumentRoot = document.querySelector("#activeDocumentRoot");
const settingsStatus = document.querySelector("#settingsStatus");
const exportSettingsButton = document.querySelector("#exportSettingsButton");
const importSettingsButton = document.querySelector("#importSettingsButton");
const exportDataButton = document.querySelector("#exportDataButton");
const importDataButton = document.querySelector("#importDataButton");
const settingsImportFile = document.querySelector("#settingsImportFile");
const dataImportFile = document.querySelector("#dataImportFile");
const replaceDataOnImport = document.querySelector("#replaceDataOnImport");
const importExportStatus = document.querySelector("#importExportStatus");
const sourceProfiles = document.querySelector("#sourceProfiles");
const webdriverStatus = document.querySelector("#webdriverStatus");
const subscriptionTabs = document.querySelector("#subscriptionTabs");
const runAllSubscriptionsButton = document.querySelector("#runAllSubscriptionsButton");
const saveSubscriptionsButton = document.querySelector("#saveSubscriptionsButton");
const refreshJobs = document.querySelector("#refreshJobs");
const refreshJobStatus = document.querySelector("#refreshJobStatus");
const newTagInput = document.querySelector("#newTagInput");
const addTagButton = document.querySelector("#addTagButton");
const tagManagerStatus = document.querySelector("#tagManagerStatus");
const selectAllTagsButton = document.querySelector("#selectAllTagsButton");
const clearTagSelectionButton = document.querySelector("#clearTagSelectionButton");
const deleteSelectedTagsButton = document.querySelector("#deleteSelectedTagsButton");
const settingsTagList = document.querySelector("#settingsTagList");
const tagDialog = document.querySelector("#tagDialog");
const tagDialogForm = document.querySelector("#tagDialogForm");
const tagDialogSubtitle = document.querySelector("#tagDialogSubtitle");
const closeTagDialogButton = document.querySelector("#closeTagDialogButton");
const cancelTagDialogButton = document.querySelector("#cancelTagDialogButton");
const tagManualInput = document.querySelector("#tagManualInput");
const addManualTagButton = document.querySelector("#addManualTagButton");
const selectedTagChips = document.querySelector("#selectedTagChips");
const existingTagChips = document.querySelector("#existingTagChips");
const recommendedTagChips = document.querySelector("#recommendedTagChips");
const recommendTagsButton = document.querySelector("#recommendTagsButton");
const tagRecommendStatus = document.querySelector("#tagRecommendStatus");
const supplementalSummary = document.querySelector("#supplementalSummary");
const supplementalList = document.querySelector("#supplementalList");
const supplementalStatus = document.querySelector("#supplementalStatus");
const saveSupplementalButton = document.querySelector("#saveSupplementalButton");
const suggestSupplementalButton = document.querySelector("#suggestSupplementalButton");
const addSupplementalEntryButton = document.querySelector("#addSupplementalEntryButton");
const batchProcessDialog = document.querySelector("#batchProcessDialog");
const batchProcessForm = document.querySelector("#batchProcessForm");
const closeBatchProcessButton = document.querySelector("#closeBatchProcessButton");
const cancelBatchProcessButton = document.querySelector("#cancelBatchProcessButton");
const startBatchProcessButton = document.querySelector("#startBatchProcessButton");
const applyBatchTagsButton = document.querySelector("#applyBatchTagsButton");
const batchProcessTagsToggle = document.querySelector("#batchProcessTagsToggle");
const batchProcessTagMode = document.querySelector("#batchProcessTagMode");
const batchProcessForceToggle = document.querySelector("#batchProcessForceToggle");
const batchProcessConcurrency = document.querySelector("#batchProcessConcurrency");
const batchProcessStatus = document.querySelector("#batchProcessStatus");
const batchProcessCount = document.querySelector("#batchProcessCount");
const batchProcessProgress = document.querySelector("#batchProcessProgress");
const batchProcessSubtitle = document.querySelector("#batchProcessSubtitle");
const batchTagReview = document.querySelector("#batchTagReview");
const batchTagGroups = document.querySelector("#batchTagGroups");
const classifyListDialog = document.querySelector("#classifyListDialog");
const classifyListForm = document.querySelector("#classifyListForm");
const closeClassifyListButton = document.querySelector("#closeClassifyListButton");
const cancelClassifyListButton = document.querySelector("#cancelClassifyListButton");
const runClassifyListButton = document.querySelector("#runClassifyListButton");
const classifyCategoryInput = document.querySelector("#classifyCategoryInput");
const addClassifyCategoryButton = document.querySelector("#addClassifyCategoryButton");
const classificationCategoryChips = document.querySelector("#classificationCategoryChips");
const classificationStatus = document.querySelector("#classificationStatus");
const classificationCount = document.querySelector("#classificationCount");
const classificationProgress = document.querySelector("#classificationProgress");
const classifyListSubtitle = document.querySelector("#classifyListSubtitle");

chatForm.addEventListener("submit", sendChatMessage);
newChatButton.addEventListener("click", () => createChatSession({ activate: true }));
clearChatHistoryButton.addEventListener("click", clearChatHistory);
importForm.addEventListener("submit", previewImport);
confirmImportButton.addEventListener("click", confirmImport);
clearImportButton.addEventListener("click", resetImport);
copyPreviewButton.addEventListener("click", copyPreview);
summarizeButton.addEventListener("click", summarizePreview);
settingsForm.addEventListener("submit", saveSettings);
exportSettingsButton.addEventListener("click", () => downloadExport("/api/export/settings"));
exportDataButton.addEventListener("click", () => downloadExport("/api/export/data"));
importSettingsButton.addEventListener("click", () => settingsImportFile.click());
importDataButton.addEventListener("click", () => dataImportFile.click());
settingsImportFile.addEventListener("change", importSettingsFile);
dataImportFile.addEventListener("change", importDataFile);
saveSubscriptionsButton.addEventListener("click", saveSubscriptions);
runAllSubscriptionsButton.addEventListener("click", runAllRefreshJobs);
settingsTabs.forEach((button) => {
  button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab));
});
tagDialogForm.addEventListener("submit", saveTagDialog);
closeTagDialogButton.addEventListener("click", closeTagDialog);
cancelTagDialogButton.addEventListener("click", closeTagDialog);
addManualTagButton.addEventListener("click", addManualTag);
recommendTagsButton.addEventListener("click", recommendTagsForCurrentItem);
saveSupplementalButton.addEventListener("click", saveSupplementalContext);
suggestSupplementalButton.addEventListener("click", suggestSupplementalContext);
addSupplementalEntryButton.addEventListener("click", addSupplementalEntry);
batchProcessButton.addEventListener("click", openBatchProcessDialog);
classifyListButton.addEventListener("click", openClassifyListDialog);
closeClassifyListButton.addEventListener("click", closeClassifyListDialog);
cancelClassifyListButton.addEventListener("click", closeClassifyListDialog);
addClassifyCategoryButton.addEventListener("click", addClassificationCategory);
classifyCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addClassificationCategory();
  }
});
runClassifyListButton.addEventListener("click", classifyCurrentList);
classifyListForm.addEventListener("submit", (event) => event.preventDefault());
closeBatchProcessButton.addEventListener("click", closeBatchProcessDialog);
cancelBatchProcessButton.addEventListener("click", closeBatchProcessDialog);
startBatchProcessButton.addEventListener("click", startBatchProcess);
applyBatchTagsButton.addEventListener("click", applyBatchTags);
batchProcessTagsToggle.addEventListener("change", updateBatchProcessCandidates);
batchProcessTagMode.addEventListener("change", updateBatchProcessCandidates);
batchProcessForceToggle.addEventListener("change", updateBatchProcessCandidates);
batchProcessForm.addEventListener("submit", (event) => event.preventDefault());
addTagButton.addEventListener("click", addSettingsTags);
selectAllTagsButton.addEventListener("click", () => {
  state.selectedSettingsTags = new Set(state.settingsTags.map((tag) => tag.name));
  renderSettingsTags();
});
clearTagSelectionButton.addEventListener("click", () => {
  state.selectedSettingsTags.clear();
  renderSettingsTags();
});
deleteSelectedTagsButton.addEventListener("click", deleteSelectedSettingsTags);
newTagInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addSettingsTags();
});
tagManualInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addManualTag();
});
document.querySelectorAll("[data-webdriver-url]").forEach((button) => {
  button.addEventListener("click", () => openWebdriver(button.dataset.webdriverUrl));
});
document.querySelectorAll("[data-save-cookie-url]").forEach((button) => {
  button.addEventListener("click", () => saveWebdriverCookies(button.dataset.saveCookieUrl));
});
importContent.addEventListener("paste", () => setTimeout(() => autoPreviewImport(), 50));
importUrl.addEventListener("paste", () => setTimeout(() => autoPreviewImport(), 50));
dropZone.addEventListener("dragover", handleDragOver);
dropZone.addEventListener("dragleave", handleDragLeave);
dropZone.addEventListener("drop", handleDrop);

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", async () => {
    await switchView(button.dataset.view);
  });
});

sidebar?.addEventListener("mouseleave", resetSidebarScroll);
sidebar?.addEventListener("focusout", () => {
  requestAnimationFrame(() => {
    if (!sidebar.matches(":focus-within")) {
      resetSidebarScroll();
    }
  });
});

document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
  button.addEventListener("click", async () => {
    await switchView(button.dataset.viewShortcut);
  });
});

document.querySelectorAll("[data-source-shortcut]").forEach((button) => {
  button.addEventListener("click", async () => {
    await switchView("materials");
    document.querySelectorAll(".source-item").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.source === button.dataset.sourceShortcut);
    });
    state.sourceType = button.dataset.sourceShortcut;
    state.tag = "";
    await loadItems();
    renderTags();
  });
});

document.querySelectorAll(".source-item").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".source-item").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.sourceType = button.dataset.source;
    state.tag = "";
    await loadItems();
    renderTags();
  });
});

filterTabs.forEach((button) => {
  button.addEventListener("click", () => setFilterTab(button.dataset.filterTab));
});

searchInput.addEventListener("input", debounce(async () => {
  state.query = searchInput.value.trim();
  await loadItems();
}, 200));

await loadAgentConfig();
await loadSettings();
startRefreshJobMonitor();
await loadMaterialUpdateCount();
await loadHomeOverview();
loadChatSessions();
renderView();

async function loadAll() {
  await Promise.all([loadTags(), loadItems(), loadMaterialUpdateCount()]);
}

function renderView() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.view === state.view);
  });

  chatView.hidden = state.view !== "chat";
  homeView.hidden = state.view !== "home";
  materialsView.hidden = state.view !== "materials";
  importView.hidden = state.view !== "import";
  supplementalView.hidden = state.view !== "supplemental";
  subscriptionsView.hidden = state.view !== "subscriptions";
  settingsView.hidden = state.view !== "settings";
  materialSidebar.hidden = state.view !== "materials";
  materialsTitle.textContent = "资料整理";
  if (state.view === "settings") {
    setSettingsTab(state.settingsTab);
  }
  renderMaterialsNewBadge();
}

function resetSidebarScroll() {
  if (!sidebar) return;
  sidebar.scrollTop = 0;
}

function setFilterTab(tabName) {
  const next = tabName === "tag" ? "tag" : "source";
  filterTabs.forEach((button) => {
    const active = button.dataset.filterTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  filterPanels.forEach((panel) => {
    const active = panel.dataset.filterPanel === next;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
}

function setSettingsTab(tabName) {
  const next = ["ai", "capture", "tags", "storage", "notify"].includes(tabName) ? tabName : "ai";
  state.settingsTab = next;
  settingsTabs.forEach((button) => {
    const active = button.dataset.settingsTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  settingsPanels.forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== next;
  });
}

async function switchView(view) {
  state.view = view;
  renderView();
  if (state.view === "home") {
    await loadHomeOverview();
  }
  if (state.view === "materials") {
    await loadAll();
  }
  if (state.view === "settings") {
    await loadSettings();
  }
  if (state.view === "subscriptions") {
    await loadSettings();
  }
  if (state.view === "supplemental") {
    await loadSupplementalContext();
  }
}

async function loadItems() {
  const params = new URLSearchParams();
  if (state.sourceType) params.set("sourceType", state.sourceType);
  if (state.tag) params.set("tag", state.tag);
  if (state.query) params.set("q", state.query);

  const { items } = await api(`/api/items?${params}`);
  state.items = items;
  syncMaterialUpdateCountFromItems(items);
  state.listClassification = null;
  renderItems();
  renderMaterialsNewBadge();
}

async function loadTags() {
  const { tags } = await api("/api/tags");
  state.tags = tags;
  renderTags();
}

async function loadMaterialUpdateCount() {
  try {
    const { items } = await api("/api/items?updates=1");
    state.updateCount = items?.length || 0;
    renderMaterialsNewBadge();
    renderHomeOverview();
  } catch (error) {
    console.warn("Failed to load material update count:", error);
  }
}

function syncMaterialUpdateCountFromItems(items) {
  const visibleUpdates = (items || []).filter((item) => item.contentUpdatedAt).length;
  if (visibleUpdates || !state.sourceType && !state.tag && !state.query) {
    state.updateCount = visibleUpdates;
  }
}

function renderMaterialsNewBadge() {
  if (!materialsNewBadge) return;
  materialsNewBadge.hidden = !state.updateCount;
  materialsNewBadge.title = state.updateCount ? `${state.updateCount} 条资料有新内容` : "";
}

async function loadHomeOverview() {
  if (!homeTotalItems) return;
  try {
    const [{ items }, { tags }] = await Promise.all([
      api("/api/items"),
      api("/api/tags")
    ]);
    state.homeOverview = {
      items: items || [],
      tags: tags || []
    };
    renderHomeOverview();
  } catch (error) {
    console.warn("Failed to load home overview:", error);
  }
}

function renderHomeOverview() {
  if (!homeTotalItems) return;
  const items = state.homeOverview?.items || [];
  const tags = state.homeOverview?.tags || [];
  const sourceCounts = countSources(items);
  const sourceNewCounts = countNewSources(items);
  const refreshJobsList = state.refreshJobs || [];
  const enabledJobs = refreshJobsList.filter((job) => job.enabled).length;
  const runningJobs = refreshJobsList.filter((job) => job.running).length;
  const failedJobs = refreshJobsList.filter((job) => ["failed", "unreachable"].includes(job.status)).length;

  homeTotalItems.textContent = String(items.length);
  homeUpdateCount.textContent = String(state.updateCount || 0);
  homeSubscriptionCount.textContent = String(refreshJobsList.length);
  homeTagCount.textContent = String(tags.length);
  homeRunningJobs.textContent = String(runningJobs);
  homeFailedJobs.textContent = String(failedJobs);
  homeEnabledJobs.textContent = String(enabledJobs);
  homeSubscriptionStatus.textContent = failedJobs
    ? `${failedJobs} 个任务需要检查`
    : enabledJobs
      ? `${enabledJobs} 个任务已启用`
      : "还没有启用刷新任务";

  for (const [source, element] of Object.entries(homeSourceCounts)) {
    if (element) element.textContent = String(sourceCounts.get(source) || 0);
  }
  for (const [source, element] of Object.entries(homeSourceNewCounts)) {
    if (!element) continue;
    const newCount = sourceNewCounts.get(source) || 0;
    element.textContent = `新 ${newCount}`;
    element.hidden = newCount <= 0;
    element.closest("button")?.classList.toggle("has-new-content", newCount > 0);
  }

  const topSources = [...sourceCounts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([source, count]) => `${sourceLabel(source)} ${count}`);
  homeSourceSummary.textContent = topSources.length ? topSources.join(" · ") : "暂无资料来源";
  renderHomeRefreshTasks(refreshJobsList);
}

function renderHomeRefreshTasks(jobs) {
  if (!homeRefreshTaskRows) return;
  const summaries = summarizeRefreshSources(jobs || []);
  if (homeRefreshTaskCount) {
    homeRefreshTaskCount.textContent = `共 ${summaries.length} 个数据源 · ${(jobs || []).length} 个任务`;
  }
  if (!summaries.length) {
    homeRefreshTaskRows.innerHTML = `
      <tr>
        <td colspan="8">还没有刷新任务。</td>
      </tr>
    `;
    return;
  }

  homeRefreshTaskRows.innerHTML = summaries.map((summary) => {
    const isConfirming = state.homeSourceRefresh.confirmSource === summary.source;
    const isRunning = state.homeSourceRefresh.runningSource === summary.source;
    const summaryRunning = !isRunning && summary.status.kind === "running";
    const runningTotal = Math.max(1, Number(state.homeSourceRefresh.total || summary.total || 0));
    const runningCompleted = Math.min(runningTotal, Number(state.homeSourceRefresh.completed || 0));
    const progress = isRunning
      ? Math.round((runningCompleted / runningTotal) * 100)
      : summary.progress;
    const progressText = isRunning
      ? `${runningCompleted}/${runningTotal}${state.homeSourceRefresh.failed ? ` · 失败 ${state.homeSourceRefresh.failed}` : ""}`
      : summaryRunning ? "运行中" : `${summary.progress}%`;
    const trackClass = isRunning ? "is-running" : summaryRunning ? "is-indeterminate" : "";
    const barStyle = (isRunning || summaryRunning) ? "" : `width: ${escapeHtml(String(progress))}%`;
    const status = isRunning
      ? { kind: state.homeSourceRefresh.failed ? "warning" : "running", label: state.homeSourceRefresh.message || "运行中" }
      : summary.status;
    return `
      <tr>
        <td>
          <div class="home-task-name">
            <span class="home-source-icon home-source-${escapeHtml(summary.source)}">${escapeHtml(sourceIcon(summary.source))}</span>
            <strong>${escapeHtml(subscriptionSourceLabel(summary.source))}</strong>
          </div>
        </td>
        <td>${escapeHtml(`${summary.enabled}/${summary.total} 已启用`)}</td>
        <td><span class="task-status task-status-${escapeHtml(status.kind)}">${escapeHtml(status.label)}</span></td>
        <td>${escapeHtml(summary.latestRunAt ? relativeTime(summary.latestRunAt) : "未运行")}</td>
        <td>${escapeHtml(`${summary.successRate}%`)}</td>
        <td>
          <div class="task-progress-cell">
            <span>${escapeHtml(progressText)}</span>
            <div class="task-progress-track ${trackClass}"><i style="${barStyle}"></i></div>
          </div>
        </td>
        <td><span class="${summary.updated > 0 ? "task-delta-hot" : ""}">${escapeHtml(`${summary.updated} / ${summary.totalResult}`)}</span></td>
        <td>
          <div class="source-refresh-actions">
            ${isConfirming ? `
              <button type="button" class="source-refresh-confirm" data-source-refresh-confirm="${escapeHtml(summary.source)}">确认刷新</button>
              <button type="button" class="source-refresh-all" data-source-refresh-all="${escapeHtml(summary.source)}">刷新所有</button>
              <button type="button" class="task-icon-button" data-source-refresh-cancel aria-label="取消刷新">×</button>
            ` : `
              <button
                type="button"
                class="source-refresh-button"
                data-source-refresh="${escapeHtml(summary.source)}"
                ${isRunning ? "disabled" : ""}
              >${isRunning ? "刷新中" : "刷新"}</button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  homeRefreshTaskRows.querySelectorAll("[data-source-refresh]").forEach((button) => {
    button.addEventListener("click", () => {
      state.homeSourceRefresh.confirmSource = button.dataset.sourceRefresh;
      renderHomeOverview();
    });
  });
  homeRefreshTaskRows.querySelectorAll("[data-source-refresh-confirm]").forEach((button) => {
    button.addEventListener("click", () => refreshHomeSource(button.dataset.sourceRefreshConfirm));
  });
  homeRefreshTaskRows.querySelectorAll("[data-source-refresh-all]").forEach((button) => {
    button.addEventListener("click", () => refreshHomeSource(button.dataset.sourceRefreshAll, { clearFirst: true }));
  });
  homeRefreshTaskRows.querySelectorAll("[data-source-refresh-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      state.homeSourceRefresh.confirmSource = "";
      renderHomeOverview();
    });
  });
}

function countNewSources(items) {
  const counts = new Map();
  for (const item of items || []) {
    if (!isNewContentItem(item)) continue;
    const source = item.sourceType || "text";
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return counts;
}

function isNewContentItem(item) {
  return Boolean(item?.contentUpdatedAt || item?.pendingContentUpdatedAt || item?.processedStale);
}

function summarizeRefreshSources(jobs) {
  const groups = new Map();
  for (const job of jobs || []) {
    const source = sourceTypeForSubscription(job);
    if (!groups.has(source)) {
      groups.set(source, {
        source,
        total: 0,
        enabled: 0,
        running: 0,
        failed: 0,
        warning: 0,
        succeeded: 0,
        latestRunAt: "",
        progressSum: 0,
        updated: 0,
        totalResult: 0
      });
    }
    const group = groups.get(source);
    const status = homeRefreshJobStatus(job);
    const progress = homeRefreshJobProgress(job);
    const delta = homeRefreshJobDelta(job);
    group.total += 1;
    group.enabled += job.enabled ? 1 : 0;
    group.running += status.kind === "running" ? 1 : 0;
    group.failed += status.kind === "failed" ? 1 : 0;
    group.warning += status.kind === "warning" ? 1 : 0;
    group.succeeded += status.kind === "success" ? 1 : 0;
    group.progressSum += progress.percent;
    group.updated += delta.updated;
    group.totalResult += delta.total;
    if (job.lastRunAt && (!group.latestRunAt || job.lastRunAt > group.latestRunAt)) {
      group.latestRunAt = job.lastRunAt;
    }
  }

  return [...groups.values()]
    .map((group) => {
      const status = sourceSummaryStatus(group);
      const finished = group.succeeded + group.failed + group.warning;
      const successRate = finished ? Math.round((group.succeeded / finished) * 100) : 0;
      return {
        ...group,
        status,
        successRate,
        progress: group.total ? Math.round(group.progressSum / group.total) : 0
      };
    })
    .sort((a, b) => {
      const order = { running: 0, failed: 1, warning: 2, success: 3, idle: 4, skipped: 5 };
      return (order[a.status.kind] ?? 9) - (order[b.status.kind] ?? 9)
        || subscriptionSourceLabel(a.source).localeCompare(subscriptionSourceLabel(b.source));
    });
}

function sourceSummaryStatus(group) {
  if (group.running) return { kind: "running", label: `${group.running} 运行中` };
  if (group.failed) return { kind: "failed", label: `${group.failed} 失败` };
  if (group.warning) return { kind: "warning", label: `${group.warning} 警告` };
  if (group.succeeded) return { kind: "success", label: "正常" };
  if (!group.enabled) return { kind: "skipped", label: "未启用" };
  return { kind: "idle", label: "空闲" };
}

async function refreshHomeSource(source, options = {}) {
  const jobsToRun = (state.refreshJobs || []).filter((job) => sourceTypeForSubscription(job) === source);
  const startedAt = new Date().toISOString();
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  state.homeSourceRefresh.confirmSource = "";
  state.homeSourceRefresh.runningSource = source;
  state.homeSourceRefresh.requestToken = token;
  state.homeSourceRefresh.startedAt = startedAt;
  state.homeSourceRefresh.total = jobsToRun.length;
  state.homeSourceRefresh.completed = 0;
  state.homeSourceRefresh.failed = 0;
  state.homeSourceRefresh.message = "启动刷新中";
  state.homeSourceRefresh.pollErrorCount = 0;
  state.homeSourceRefresh.timeoutAt = Date.now() + 10 * 60 * 1000;
  renderHomeOverview();
  if (!jobsToRun.length) {
    resetHomeSourceRefreshState(token);
    renderHomeOverview();
    return;
  }

  try {
    if (options.clearFirst) {
      const { jobs } = await api(`/api/refresh-jobs/source/${encodeURIComponent(source)}/items`, { method: "DELETE" });
      if (state.homeSourceRefresh.requestToken !== token) return;
      state.refreshJobs = jobs || state.refreshJobs;
      renderHomeOverview();
    }
    const { run, jobs } = await api("/api/refresh-jobs/run-batch?background=1", {
      method: "POST",
      body: JSON.stringify({
        ids: jobsToRun.map((job) => job.id),
        sourceType: source,
        background: true
      })
    });
    if (state.homeSourceRefresh.requestToken !== token) return;
    state.homeSourceRefresh.runId = run?.id || "";
    state.homeSourceRefresh.message = "运行中";
    state.refreshJobs = jobs || state.refreshJobs;
    startHomeSourceRefreshPolling(source, startedAt, jobsToRun.length, token, run?.id || "");
    renderHomeOverview();
  } catch (error) {
    if (state.homeSourceRefresh.requestToken !== token) return;
    console.warn(`Failed to refresh ${source}:`, error);
    state.homeSourceRefresh.message = error.message || "刷新启动失败";
    state.homeSourceRefresh.failed = jobsToRun.length;
    await loadSettings();
    resetHomeSourceRefreshState(token);
    renderHomeOverview();
  }
}

function startHomeSourceRefreshPolling(source, startedAt, total, token = state.homeSourceRefresh.requestToken, runId = state.homeSourceRefresh.runId) {
  stopHomeSourceRefreshPolling();
  state.homeSourceRefresh.pollTimer = setInterval(async () => {
    if (state.homeSourceRefresh.requestToken !== token) return stopHomeSourceRefreshPolling();
    try {
      const payload = runId ? await api(`/api/refresh-runs/${encodeURIComponent(runId)}`) : await api("/api/refresh-jobs");
      const run = payload.run || null;
      const jobs = run?.jobs || payload.jobs || state.refreshJobs;
      state.refreshJobs = jobs || state.refreshJobs;
      const sourceJobs = (state.refreshJobs || []).filter((job) => sourceTypeForSubscription(job) === source);
      const completed = run ? Number(run.completedJobs || 0) : sourceJobs.filter((job) => job.lastRunAt && job.lastRunAt >= startedAt).length;
      const failed = run ? Number(run.failedJobs || 0) : sourceJobs.filter((job) => ["failed", "unreachable"].includes(job.status) && job.lastRunAt && job.lastRunAt >= startedAt).length;
      const active = sourceJobs.some((job) => job.running);
      state.homeSourceRefresh.total = run?.totalJobs || total || sourceJobs.length;
      state.homeSourceRefresh.completed = completed;
      state.homeSourceRefresh.failed = failed;
      state.homeSourceRefresh.pollErrorCount = 0;
      state.homeSourceRefresh.message = runStatusText(run) || (active ? "运行中" : failed ? "有失败" : "刷新完成");
      renderRefreshJobs(state.refreshJobs);
      renderHomeOverview();
      const terminal = run && ["completed", "failed", "canceled"].includes(run.status);
      if (terminal || (!active && completed + failed >= Math.max(1, Number(state.homeSourceRefresh.total || 0)))) {
        await loadMaterialUpdateCount();
        resetHomeSourceRefreshState(token);
        renderHomeOverview();
      } else if (Date.now() > state.homeSourceRefresh.timeoutAt) {
        state.homeSourceRefresh.message = "已切换后台监控";
        resetHomeSourceRefreshState(token, { keepJobs: true });
        renderHomeOverview();
      }
    } catch (error) {
      state.homeSourceRefresh.pollErrorCount += 1;
      state.homeSourceRefresh.message = "进度同步失败";
      console.warn(`Failed to poll ${source} refresh progress:`, error);
      if (state.homeSourceRefresh.pollErrorCount >= 5) {
        resetHomeSourceRefreshState(token, { keepJobs: true });
        renderHomeOverview();
      } else {
        renderHomeOverview();
      }
    }
  }, 1000);
}

function stopHomeSourceRefreshPolling() {
  if (!state.homeSourceRefresh.pollTimer) return;
  clearInterval(state.homeSourceRefresh.pollTimer);
  state.homeSourceRefresh.pollTimer = null;
}

function resetHomeSourceRefreshState(token = state.homeSourceRefresh.requestToken, options = {}) {
  if (token && state.homeSourceRefresh.requestToken && token !== state.homeSourceRefresh.requestToken) return;
  stopHomeSourceRefreshPolling();
  state.homeSourceRefresh.runningSource = "";
  state.homeSourceRefresh.runId = "";
  state.homeSourceRefresh.requestToken = "";
  state.homeSourceRefresh.startedAt = "";
  state.homeSourceRefresh.total = 0;
  state.homeSourceRefresh.completed = 0;
  state.homeSourceRefresh.failed = 0;
  state.homeSourceRefresh.pollErrorCount = 0;
  state.homeSourceRefresh.timeoutAt = 0;
  if (!options.keepJobs) state.homeSourceRefresh.message = "";
}

function runStatusText(run) {
  if (!run) return "";
  if (run.status === "queued") return "排队中";
  if (run.status === "running") return run.currentJobName ? `运行中：${run.currentJobName}` : "运行中";
  if (run.status === "canceling") return "正在取消";
  if (run.status === "canceled") return "已取消";
  if (run.status === "failed") return run.error || "刷新失败";
  if (run.status === "completed") return "刷新完成";
  return run.status || "";
}

function homeRefreshJobProgress(job) {
  if (job.running) return { percent: 0 };
  if (job.status === "failed" || job.status === "unreachable") return { percent: 0 };
  if (job.status === "running" && !job.running) return { percent: 0 };
  if (job.lastResult) {
    const total = Number(job.lastResult.linkCount ?? job.lastResult.issueCount ?? 0);
    const skipped = Number(job.lastResult.skippedItemCount || 0);
    const updated = Number(job.lastResult.updatedItemCount ?? job.lastResult.updatedIssueCount ?? 0);
    if (total > 0) {
      return { percent: Math.max(0, Math.min(100, Math.round(((updated + skipped) / total) * 100))) };
    }
  }
  return { percent: job.lastRunAt ? 100 : 0 };
}

function homeRefreshJobStatus(job) {
  if (job.running) return { kind: "running", label: "运行中" };
  if (job.status === "running") return { kind: "warning", label: "可能中断" };
  if (job.status === "failed" || job.status === "unreachable") return { kind: "failed", label: "失败" };
  if (!job.enabled) return { kind: "skipped", label: "跳过" };
  if (job.lastError) return { kind: "warning", label: "警告" };
  if (job.lastRunAt) return { kind: "success", label: "成功" };
  return { kind: "idle", label: "空闲" };
}

function homeRefreshJobDelta(job) {
  if (job.status === "failed" || job.status === "unreachable" || job.status === "running") {
    return { changed: false, text: "- / -", updated: 0, total: 0 };
  }
  const updated = Number(job.lastResult?.updatedItemCount ?? job.lastResult?.updatedIssueCount ?? 0);
  const total = Number(job.lastResult?.linkCount ?? job.lastResult?.issueCount ?? 0);
  if (!job.lastResult) return { changed: false, text: "- / -", updated: 0, total: 0 };
  return { changed: updated > 0, text: `${updated} / ${total}`, updated, total };
}

function sourceIcon(source) {
  return {
    confluence: "◆",
    github: "●",
    jira: "◆",
    teams: "▣",
    web: "◎"
  }[source] || "□";
}

function relativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "刚刚";
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))} 分钟前`;
  if (diffMs < day) return `${Math.round(diffMs / hour)} 小时前`;
  if (diffMs < day * 2) return `昨天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  return formatDate(value);
}

function countSources(items) {
  const counts = new Map();
  for (const item of items || []) {
    const source = normalizeSourceType(item.sourceType || item.source || "text");
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return counts;
}

function normalizeSourceType(source) {
  const value = String(source || "").toLowerCase();
  if (value.includes("jira") || value.includes("atlassian")) return "jira";
  if (value.includes("github")) return "github";
  if (value.includes("teams")) return "teams";
  if (value.includes("confluence")) return "confluence";
  if (value.includes("web") || value.includes("http")) return "web";
  return value || "text";
}

function sourceLabel(source) {
  const labels = {
    confluence: "Confluence",
    github: "GitHub",
    jira: "Jira",
    teams: "Teams",
    text: "文本",
    web: "网页"
  };
  return labels[source] || source;
}

function renderItems() {
  const classified = state.listClassification?.groups?.length;
  resultCount.textContent = `${state.items.length} 条资料${classified ? ` · ${state.listClassification.groups.length} 个分类` : ""}`;
  classifyListButton.textContent = state.listClassifying
    ? "分类中..."
    : classified
      ? "重新分类"
      : "列表分类";
  classifyListButton.disabled = state.listClassifying || !state.items.length;

  if (!state.items.length) {
    itemList.innerHTML = `<div class="empty-state">还没有符合条件的资料。</div>`;
    return;
  }

  if (classified) {
    renderClassifiedItems();
    return;
  }

  itemList.innerHTML = state.items.map(renderItemCard).join("");

  bindItemCards();
}

function renderItemCard(item) {
  return `
    <button class="item-card ${state.selectedId === item.id ? "is-selected" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="item-card-title">
        <h3>${escapeHtml(item.title)}</h3>
        ${item.contentUpdatedAt ? `<span class="new-badge item-new-badge">NEW!</span>` : ""}
      </div>
    </button>
  `;
}

function bindItemCards() {
  itemList.querySelectorAll(".item-card").forEach((card) => {
    card.addEventListener("click", () => selectItem(card.dataset.id));
  });
}

function renderClassifiedItems() {
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const seen = new Set();
  const groups = (state.listClassification?.groups || []).map((group) => {
    const items = (group.itemIds || [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
    return { ...group, items };
  }).filter((group) => group.items.length);
  const leftovers = state.items.filter((item) => !seen.has(item.id));
  if (leftovers.length) {
    groups.push({ name: "未分类", reason: "AI 分类结果中未覆盖的资料。", items: leftovers });
  }

  itemList.innerHTML = groups.map((group) => `
    <section class="item-group">
      <div class="item-group-header">
        <div>
          <strong>${escapeHtml(group.name || "未命名分类")}</strong>
          ${group.reason ? `<p>${escapeHtml(group.reason)}</p>` : ""}
        </div>
        <span>${group.items.length}</span>
      </div>
      ${group.items.map(renderItemCard).join("")}
    </section>
  `).join("");
  bindItemCards();
}

function openClassifyListDialog() {
  if (!state.items.length) return;
  classifyListSubtitle.textContent = `当前列表 ${state.items.length} 条资料。自定义类别后，AI 会逐条归类。`;
  classificationStatus.textContent = "等待分类。";
  classificationCount.textContent = `0 / ${state.items.length}`;
  classificationProgress.value = 0;
  classificationProgress.max = Math.max(state.items.length, 1);
  renderClassificationCategories();
  classifyListDialog.showModal();
}

function closeClassifyListDialog() {
  if (state.listClassifying) return;
  classifyListDialog.close();
}

function addClassificationCategory() {
  const values = classifyCategoryInput.value
    .split(/[,，\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (!values.length) return;
  state.listClassifier.categories = uniqueValues([
    ...state.listClassifier.categories,
    ...values
  ]).slice(0, 24);
  classifyCategoryInput.value = "";
  saveStoredListCategories();
  renderClassificationCategories();
}

function removeClassificationCategory(category) {
  if (state.listClassifying) return;
  state.listClassifier.categories = state.listClassifier.categories.filter((item) => item !== category);
  saveStoredListCategories();
  renderClassificationCategories();
}

function renderClassificationCategories() {
  const categories = state.listClassifier.categories || [];
  classificationCategoryChips.innerHTML = categories.length
    ? categories.map((category) => `
      <button type="button" class="tag-edit-chip" data-classification-category="${escapeHtml(category)}">
        ${escapeHtml(category)}
        <span>×</span>
      </button>
    `).join("")
    : `<span class="empty-inline">还没有类别。可以手动添加，也可以留空让 AI 自动归纳。</span>`;
  classificationCategoryChips.querySelectorAll("[data-classification-category]").forEach((button) => {
    button.addEventListener("click", () => removeClassificationCategory(button.dataset.classificationCategory));
  });
}

function saveStoredListCategories() {
  localStorage.setItem("materialOrganizer.listCategories", JSON.stringify(state.listClassifier.categories || []));
}

function loadStoredListCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem("materialOrganizer.listCategories") || "[]");
    return Array.isArray(parsed) ? uniqueValues(parsed.map((item) => String(item || "").trim()).filter(Boolean)) : [];
  } catch {
    return [];
  }
}

async function classifyCurrentList() {
  if (!state.items.length || state.listClassifying) return;
  const categories = uniqueValues((state.listClassifier.categories || []).map((category) => category.trim()).filter(Boolean));
  state.listClassifier.categories = categories;
  saveStoredListCategories();
  state.listClassifying = true;
  runClassifyListButton.disabled = true;
  closeClassifyListButton.disabled = true;
  cancelClassifyListButton.disabled = true;
  addClassifyCategoryButton.disabled = true;
  classifyCategoryInput.disabled = true;
  classificationStatus.textContent = categories.length
    ? `正在按 ${categories.length} 个类别分类...`
    : "正在让 AI 自动归纳分类...";
  classificationCount.textContent = `0 / ${state.items.length}`;
  classificationProgress.max = Math.max(state.items.length, 1);
  classificationProgress.value = 0;
  renderItems();
  try {
    if (categories.length) {
      state.listClassification = await classifyCurrentListByCategory(categories);
    } else {
      const result = await api("/api/classify-items", {
        method: "POST",
        body: JSON.stringify({
          ids: state.items.map((item) => item.id),
          categories
        })
      });
      state.listClassification = {
        groups: result.groups || [],
        note: result.note || ""
      };
    }
    classificationProgress.value = state.items.length;
    classificationCount.textContent = `${state.items.length} / ${state.items.length}`;
    classificationStatus.textContent = `分类完成，生成 ${state.listClassification.groups.length} 个分类。`;
    classifyListDialog.close();
  } catch (error) {
    classificationStatus.textContent = `分类失败：${error.message}`;
  } finally {
    state.listClassifying = false;
    runClassifyListButton.disabled = false;
    closeClassifyListButton.disabled = false;
    cancelClassifyListButton.disabled = false;
    addClassifyCategoryButton.disabled = false;
    classifyCategoryInput.disabled = false;
    renderItems();
  }
}

async function classifyCurrentListByCategory(categories) {
  const assignments = [];
  const errors = [];
  let completed = 0;
  for (const item of state.items) {
    classificationStatus.textContent = `正在分类：${item.title}`;
    try {
      const result = await api("/api/classify-item", {
        method: "POST",
        body: JSON.stringify({
          id: item.id,
          categories
        })
      });
      assignments.push({
        id: item.id,
        category: result.category || "未分类",
        reason: result.reason || ""
      });
    } catch (error) {
      errors.push({ id: item.id, title: item.title, error: error.message });
      assignments.push({
        id: item.id,
        category: "未分类",
        reason: `分类失败：${error.message}`
      });
    }
    completed += 1;
    classificationProgress.value = completed;
    classificationCount.textContent = `${completed} / ${state.items.length}`;
  }
  return buildClassificationFromAssignments(assignments, categories, errors);
}

function buildClassificationFromAssignments(assignments, categories, errors = []) {
  const categorySet = new Set(categories);
  const groupsByName = new Map([...categories, "未分类"].map((category) => [category, {
    name: category,
    itemIds: [],
    reason: ""
  }]));
  for (const assignment of assignments) {
    const name = categorySet.has(assignment.category) ? assignment.category : "未分类";
    const group = groupsByName.get(name) || groupsByName.get("未分类");
    group.itemIds.push(assignment.id);
    if (!group.reason && assignment.reason) group.reason = assignment.reason;
  }
  return {
    groups: [...groupsByName.values()].filter((group) => group.itemIds.length),
    note: errors.length ? `${errors.length} 条资料分类失败，已放入未分类。` : ""
  };
}

function openBatchProcessDialog() {
  state.batchProcess = {
    items: [],
    tagAssignments: [],
    tagOptions: [],
    selectedTags: [],
    errors: [],
    cancelRequested: false,
    running: false
  };
  batchProcessForceToggle.checked = false;
  batchProcessForceToggle.disabled = false;
  batchProcessProgress.value = 0;
  batchProcessTagsToggle.checked = false;
  batchProcessTagsToggle.disabled = false;
  batchProcessTagMode.value = "batch";
  batchProcessTagMode.disabled = false;
  batchProcessConcurrency.value = batchProcessConcurrency.value || "2";
  batchProcessConcurrency.disabled = false;
  startBatchProcessButton.hidden = false;
  startBatchProcessButton.textContent = "开始处理";
  cancelBatchProcessButton.textContent = "关闭";
  cancelBatchProcessButton.disabled = false;
  closeBatchProcessButton.disabled = false;
  applyBatchTagsButton.hidden = true;
  batchTagReview.hidden = true;
  batchTagGroups.innerHTML = "";
  updateBatchProcessCandidates();
  batchProcessDialog.showModal();
}

function updateBatchProcessCandidates() {
  if (state.batchProcess.running) return;
  const force = batchProcessForceToggle.checked;
  const includeTags = batchProcessTagsToggle.checked;
  const tagMode = batchProcessTagMode.value;
  const contentCandidates = state.items.filter((item) => item.pageKind !== "list" && (force || !item.hasProcessed));
  const tagOnlyCandidates = includeTags && tagMode === "batch"
    ? state.items.filter((item) => item.pageKind !== "list")
    : [];
  const candidates = uniqueItemsById([...contentCandidates, ...tagOnlyCandidates]);
  state.batchProcess.items = candidates;
  state.batchProcess.contentIds = new Set(contentCandidates.map((item) => item.id));
  state.batchProcess.tagScopeIds = new Set((tagMode === "batch" ? tagOnlyCandidates : contentCandidates).map((item) => item.id));
  batchProcessSubtitle.textContent = describeBatchProcessPlan(force, includeTags, tagMode, contentCandidates.length, state.batchProcess.tagScopeIds.size);
  batchProcessStatus.textContent = candidates.length ? "等待开始。" : "没有需要处理的资料。";
  batchProcessCount.textContent = `0 / ${candidates.length}`;
  batchProcessProgress.max = Math.max(1, candidates.length);
  batchProcessProgress.value = 0;
  startBatchProcessButton.disabled = candidates.length === 0;
}

function describeBatchProcessPlan(force, includeTags, tagMode, contentCount, tagCount) {
  const contentText = force
    ? `重新处理 ${contentCount} 条资料`
    : contentCount
      ? `处理 ${contentCount} 条未整理资料`
      : "不重新处理正文";
  if (!includeTags) return contentCount ? `将${contentText}。` : "当前列表没有未整理资料。";
  const tagText = tagMode === "batch"
    ? `并对当前列表 ${tagCount} 条资料统一整理标签`
    : `并对 ${tagCount} 条未整理资料单独整理标签`;
  if (!contentCount && tagCount) return `将${tagText}。`;
  return `将${contentText}，${tagText}。`;
}

function uniqueItemsById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function closeBatchProcessDialog() {
  if (state.batchProcess.running) {
    stopBatchProcess();
    return;
  }
  batchProcessDialog.close();
}

function stopBatchProcess() {
  if (!state.batchProcess.running) return;
  state.batchProcess.cancelRequested = true;
  batchProcessStatus.textContent = "正在停止，已开始的请求完成后会结束。";
  cancelBatchProcessButton.disabled = true;
  closeBatchProcessButton.disabled = true;
}

async function startBatchProcess() {
  const items = state.batchProcess.items || [];
  if (!items.length || state.batchProcess.running) return;
  state.batchProcess.running = true;
  state.batchProcess.cancelRequested = false;
  state.batchProcess.tagAssignments = [];
  state.batchProcess.tagOptions = [];
  state.batchProcess.selectedTags = [];
  state.batchProcess.errors = [];
  const includeTags = batchProcessTagsToggle.checked;
  const tagMode = batchProcessTagMode.value;
  const concurrency = Math.min(8, Math.max(1, Number(batchProcessConcurrency.value || 2) || 2));
  batchProcessTagsToggle.disabled = true;
  batchProcessTagMode.disabled = true;
  batchProcessForceToggle.disabled = true;
  batchProcessConcurrency.disabled = true;
  startBatchProcessButton.disabled = true;
  cancelBatchProcessButton.textContent = "停止处理";
  cancelBatchProcessButton.disabled = false;
  closeBatchProcessButton.disabled = false;
  applyBatchTagsButton.hidden = true;
  batchTagReview.hidden = true;
  batchTagGroups.innerHTML = "";
  batchProcessProgress.max = items.length;
  batchProcessProgress.value = 0;

  let completed = 0;
  let cursor = 0;
  const processOne = async (item) => {
    if (state.batchProcess.cancelRequested) return;
    const needsContentProcessing = state.batchProcess.contentIds?.has(item.id);
    batchProcessStatus.textContent = needsContentProcessing ? `正在处理：${item.title}` : `准备标签：${item.title}`;
    try {
      let titledItem = { metadata: item };
      let processedItem = { metadata: item };
      if (needsContentProcessing) {
        const titleResponse = await api(`/api/items/${encodeURIComponent(item.id)}/recommend-title`, { method: "POST" });
        titledItem = titleResponse.item;
        const processResponse = await api(`/api/items/${encodeURIComponent(item.id)}/process`, { method: "POST" });
        processedItem = processResponse.item;
      }
      state.batchProcess.tagAssignments.push({
        id: item.id,
        title: processedItem?.metadata?.title || titledItem?.metadata?.title || item.title,
        currentTags: processedItem?.metadata?.tags || item.tags || [],
        recommendedTags: []
      });
    } catch (error) {
      state.batchProcess.errors.push({ id: item.id, title: item.title, error: error.message });
      state.batchProcess.tagAssignments.push({
        id: item.id,
        title: item.title,
        currentTags: item.tags || [],
        recommendedTags: [],
        error: error.message
      });
    }
    completed += 1;
    batchProcessProgress.value = completed;
    batchProcessCount.textContent = `${completed} / ${items.length}`;
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      if (state.batchProcess.cancelRequested) break;
      const item = items[cursor];
      cursor += 1;
      await processOne(item);
    }
  });
  batchProcessStatus.textContent = `处理中，并发 ${Math.min(concurrency, items.length)} 个...`;
  await Promise.all(workers);

  state.batchProcess.running = false;
  const wasCancelled = state.batchProcess.cancelRequested;
  startBatchProcessButton.hidden = true;
  batchProcessTagsToggle.disabled = false;
  batchProcessTagMode.disabled = false;
  batchProcessForceToggle.disabled = false;
  batchProcessConcurrency.disabled = false;
  cancelBatchProcessButton.textContent = "关闭";
  cancelBatchProcessButton.disabled = false;
  closeBatchProcessButton.disabled = false;
  if (includeTags && !wasCancelled) {
    await buildBatchTagOptions(tagMode);
  }
  const errorCount = state.batchProcess.errors.length;
  batchProcessStatus.textContent = wasCancelled
    ? `已停止，完成 ${completed} / ${items.length}。`
    : errorCount
    ? `处理完成，${errorCount} 条失败。`
    : includeTags
      ? "处理完成。请选择要保留的标签。"
      : "处理完成。";
  if (includeTags || errorCount) {
    renderBatchTagReview();
    applyBatchTagsButton.hidden = !includeTags;
  }
  await loadItems();
  if (state.selectedId) {
    await selectItem(state.selectedId);
  }
}

async function buildBatchTagOptions(tagMode) {
  const scopeIds = state.batchProcess.tagScopeIds || new Set();
  const assignments = (state.batchProcess.tagAssignments || [])
    .filter((assignment) => !assignment.error && scopeIds.has(assignment.id));
  if (!assignments.length) return;
  let batchTags = [];
  batchProcessStatus.textContent = tagMode === "batch"
    ? "正在根据全部文档统一生成标签..."
    : "正在为未整理文档单独生成标签...";
  try {
    if (tagMode === "batch") {
      const result = await api("/api/batch-recommend-tags", {
        method: "POST",
        body: JSON.stringify({ ids: assignments.map((assignment) => assignment.id) })
      });
      batchTags = uniqueValues(result.tags || []);
      const assignmentById = new Map((result.assignments || []).map((assignment) => [assignment.id, assignment.tags || []]));
      for (const assignment of assignments) {
        assignment.recommendedTags = uniqueValues(assignmentById.get(assignment.id) || []);
      }
    } else {
      for (const assignment of assignments) {
        const result = await api(`/api/items/${encodeURIComponent(assignment.id)}/recommend-tags`, { method: "POST" });
        assignment.recommendedTags = uniqueValues(result.tags || []);
      }
    }
    const countByTag = new Map();
    for (const assignment of assignments) {
      for (const tag of assignment.recommendedTags || []) {
        countByTag.set(tag, (countByTag.get(tag) || 0) + 1);
      }
    }
    const allTags = uniqueValues([
      ...batchTags,
      ...assignments.flatMap((assignment) => assignment.recommendedTags || [])
    ]);
    state.batchProcess.tagOptions = allTags
      .map((name) => ({ name, count: countByTag.get(name) || 0 }))
      .filter((option) => option.count > 0)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    state.batchProcess.selectedTags = state.batchProcess.tagOptions.map((option) => option.name);
  } catch (error) {
    state.batchProcess.errors.push({ id: "batch-tags", title: "批量标签生成", error: error.message });
    state.batchProcess.tagAssignments.push({
      id: "batch-tags",
      title: "批量标签生成",
      currentTags: [],
      recommendedTags: [],
      error: error.message
    });
  }
}

function renderBatchTagReview() {
  const assignments = state.batchProcess.tagAssignments || [];
  const tagOptions = state.batchProcess.tagOptions || [];
  const selectedTags = state.batchProcess.selectedTags || [];
  const failed = assignments.filter((assignment) => assignment.error);
  batchTagReview.hidden = false;
  batchTagGroups.innerHTML = tagOptions.length || failed.length
    ? `
      ${tagOptions.length ? `
        <section class="batch-tag-group">
          <div>
            <strong>标签筛选</strong>
            <p class="item-meta">重复标签只显示一次；括号中是将被应用到的文档数量。</p>
          </div>
          <div class="tag-editor-chips">
            ${tagOptions.map((option) => `
              <button type="button" class="tag-edit-chip ${selectedTags.includes(option.name) ? "is-selected" : ""}" data-batch-tag="${escapeHtml(option.name)}">
                ${escapeHtml(option.name)}
                <span>${escapeHtml(String(option.count))}</span>
              </button>
            `).join("")}
          </div>
        </section>
      ` : `<div class="empty-inline">没有生成推荐标签。</div>`}
      ${failed.length ? `
        <section class="batch-tag-group">
          <strong>处理失败</strong>
          ${failed.map((group) => `<p class="status-message">${escapeHtml(group.title)}：${escapeHtml(group.error)}</p>`).join("")}
        </section>
      ` : ""}
    `
    : `<div class="empty-inline">没有生成推荐标签。</div>`;

  batchTagGroups.querySelectorAll("[data-batch-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      const tag = button.dataset.batchTag;
      if (state.batchProcess.selectedTags.includes(tag)) {
        state.batchProcess.selectedTags = state.batchProcess.selectedTags.filter((candidate) => candidate !== tag);
      } else {
        state.batchProcess.selectedTags.push(tag);
      }
      renderBatchTagReview();
    });
  });
}

async function applyBatchTags() {
  const selected = new Set(state.batchProcess.selectedTags || []);
  const groups = (state.batchProcess.tagAssignments || []).filter((group) => !group.error);
  applyBatchTagsButton.disabled = true;
  applyBatchTagsButton.textContent = "应用中...";
  try {
    for (const group of groups) {
      const keptGeneratedTags = (group.recommendedTags || []).filter((tag) => selected.has(tag));
      const tags = uniqueValues([...(group.currentTags || []), ...keptGeneratedTags]);
      await api(`/api/items/${encodeURIComponent(group.id)}/tags`, {
        method: "PATCH",
        body: JSON.stringify({ tags })
      });
    }
    batchProcessStatus.textContent = "标签已应用。";
    await loadAll();
    if (state.selectedId) await selectItem(state.selectedId);
  } catch (error) {
    batchProcessStatus.textContent = error.message;
  } finally {
    applyBatchTagsButton.disabled = false;
    applyBatchTagsButton.textContent = "应用标签";
  }
}

function extractMarkdownSection(documentText, marker) {
  const source = String(documentText || "");
  const markerLine = `\n${marker}\n\n`;
  const index = source.indexOf(markerLine);
  if (index !== -1) return unwrapMarkdownFence(source.slice(index + markerLine.length).trim());
  const compactMarker = `${marker}\n\n`;
  if (source.startsWith(compactMarker)) return unwrapMarkdownFence(source.slice(compactMarker.length).trim());
  return unwrapMarkdownFence(source.trim());
}

function unwrapMarkdownFence(markdown) {
  const source = String(markdown || "").trim();
  const match = source.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return match ? match[1].trim() : source;
}

function renderTags() {
  const allButton = `<button class="tag-chip ${state.tag ? "" : "is-active"}" data-tag="">全部</button>`;
  const tagButtons = state.tags.map((tag) => `
    <button class="tag-chip ${state.tag === tag.name ? "is-active" : ""}" data-tag="${escapeHtml(tag.name)}">
      ${escapeHtml(tag.name)} ${tag.count}
    </button>
  `).join("");

  tagList.innerHTML = allButton + tagButtons;
  tagList.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      state.tag = chip.dataset.tag;
      await loadItems();
      renderTags();
    });
  });
}

async function selectItem(id) {
  state.selectedId = id;
  renderItems();
  const { item } = await api(`/api/items/${encodeURIComponent(id)}`);
  if (item.metadata.contentUpdatedAt) {
    const acknowledgedItem = await acknowledgeSelectedItemUpdate(id);
    renderDetail(acknowledgedItem || item);
    return;
  }
  renderDetail(item);
}

async function acknowledgeSelectedItemUpdate(id) {
  try {
    const { item } = await api(`/api/items/${encodeURIComponent(id)}/ack-update`, { method: "POST" });
    if (state.selectedId !== id) return item;
    const index = state.items.findIndex((candidate) => candidate.id === id);
    if (index !== -1) {
      state.items[index] = {
        ...state.items[index],
        contentUpdatedAt: "",
        updateAcknowledgedAt: item.metadata.updateAcknowledgedAt || ""
      };
      state.updateCount = Math.max(0, state.updateCount - 1);
      renderItems();
      renderMaterialsNewBadge();
    } else {
      await loadMaterialUpdateCount();
    }
    return item;
  } catch (error) {
    console.warn("Failed to acknowledge item update:", error);
    return null;
  }
}

function renderDetail(item) {
  const metadata = item.metadata;
  const hasProcessed = Boolean(item.processedDocument?.trim());
  const showProcessed = state.detailMode === "processed";
  const rawDocument = extractMarkdownSection(item.document, "## Content");
  const processedDocument = extractMarkdownSection(item.processedDocument || "", "## AI Organized Content");
  const displayedDocument = showProcessed && hasProcessed ? processedDocument : rawDocument;
  const modeNote = showProcessed && !hasProcessed
    ? `<div class="detail-note">当前资料还没有 AI 整理版，已临时显示原文。点击“生成整理”后可切换查看整理后的内容。</div>`
    : showProcessed && metadata.processedStale
      ? `<div class="detail-note">原文刷新后发生过变化，当前 AI 整理版可能不是最新。点击“更新整理”可重新生成。</div>`
    : "";
  detailPanel.innerHTML = `
    <div class="detail-title">
      <div class="title-editor">
        <div id="detailTitleWrap" class="title-input-wrap">
          <input id="detailTitleInput" value="${escapeHtml(metadata.title)}" />
          <span id="detailTitleMarquee" class="title-marquee-text" aria-hidden="true">${escapeHtml(metadata.title)}</span>
        </div>
      </div>
      <div class="detail-actions">
        <div class="title-editor-actions">
          <button id="saveTitleButton" type="button">保存标题</button>
          <button id="generateTitleButton" type="button">AI 生成标题</button>
        </div>
        <div class="detail-display-control ${hasProcessed ? "" : "is-unavailable"}">
          <span>显示模式</span>
          <label class="detail-mode-switch">
            <span class="mode-choice ${state.detailMode === "raw" ? "is-selected" : ""}">${state.detailMode === "raw" ? "🟢 " : ""}原始内容</span>
            <input id="detailModeSwitch" type="checkbox" ${state.detailMode === "processed" ? "checked" : ""} ${hasProcessed ? "" : "disabled"} />
            <span class="switch-track" aria-hidden="true"></span>
            <span class="mode-choice ${state.detailMode === "processed" ? "is-selected" : ""}">${state.detailMode === "processed" ? "🟢 " : ""}已整理</span>
          </label>
        </div>
        <button id="processItemButton">${hasProcessed ? "重新生成整理" : "生成 AI 整理"}</button>
        <button id="editTagsButton">标签</button>
        <button id="refreshButton">刷新</button>
        <button id="deleteItemButton" class="danger-button">删除</button>
      </div>
      <div class="detail-meta-block">
        <div class="item-meta">${escapeHtml(metadata.sourceType)} · ${escapeHtml(metadata.url || "local input")}</div>
        ${metadata.processedAt ? `<div class="item-meta">AI 整理：${escapeHtml(formatDate(metadata.processedAt))}</div>` : ""}
      </div>
    </div>
    <div class="item-meta">标签：${escapeHtml((metadata.tags || []).join(", ") || "no tags")}</div>
    ${metadata.contentUpdatedAt ? `<div class="item-meta">内容更新：${escapeHtml(formatDate(metadata.contentUpdatedAt))}</div>` : ""}
    <hr />
    ${modeNote}
    <div id="detailContentLayout" class="detail-content-layout">
      <div id="detailTocWrap" class="detail-toc-wrap" hidden>
        <button id="detailTocToggle" type="button" class="detail-toc-toggle" aria-expanded="false">目录</button>
        <aside id="detailToc" class="detail-toc" hidden>
          <div class="detail-toc-title">目录</div>
          <nav id="detailTocList" class="detail-toc-list" aria-label="内容目录"></nav>
        </aside>
      </div>
      <div id="detailDoc" class="detail-doc markdown-body">${renderMarkdown(displayedDocument)}</div>
    </div>
  `;
  setupDetailTitleMarquee();
  setupDetailToc();

  document.querySelector("#detailModeSwitch").addEventListener("change", (event) => {
    state.detailMode = event.target.checked ? "processed" : "raw";
    localStorage.setItem("materialOrganizer.detailMode", state.detailMode);
    renderDetail(item);
  });

  document.querySelector("#saveTitleButton").addEventListener("click", async () => {
    const input = document.querySelector("#detailTitleInput");
    const button = document.querySelector("#saveTitleButton");
    button.disabled = true;
    button.textContent = "保存中...";
    try {
      const { item: nextItem } = await api(`/api/items/${encodeURIComponent(metadata.id)}/title`, {
        method: "PATCH",
        body: JSON.stringify({ title: input.value })
      });
      renderDetail(nextItem);
      await loadItems();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
      button.textContent = "保存标题";
    }
  });

  document.querySelector("#generateTitleButton").addEventListener("click", async () => {
    const button = document.querySelector("#generateTitleButton");
    button.disabled = true;
    button.textContent = "生成中...";
    try {
      const { item: nextItem } = await api(`/api/items/${encodeURIComponent(metadata.id)}/recommend-title`, { method: "POST" });
      renderDetail(nextItem);
      await loadItems();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
      button.textContent = "AI 生成标题";
    }
  });

  document.querySelector("#processItemButton").addEventListener("click", async () => {
    const button = document.querySelector("#processItemButton");
    button.disabled = true;
    button.textContent = "整理中...";
    try {
      const { item: nextItem } = await api(`/api/items/${encodeURIComponent(metadata.id)}/process`, { method: "POST" });
      state.detailMode = "processed";
      localStorage.setItem("materialOrganizer.detailMode", state.detailMode);
      renderDetail(nextItem);
      await loadItems();
    } catch (error) {
      alert(error.message);
      button.disabled = false;
      button.textContent = hasProcessed ? "重新生成整理" : "生成 AI 整理";
    }
  });

  document.querySelector("#editTagsButton").addEventListener("click", () => openTagDialog(item));

  document.querySelector("#refreshButton").addEventListener("click", async () => {
    try {
      await api(`/api/items/${encodeURIComponent(metadata.id)}/refresh`, { method: "POST" });
      await loadAll();
      await selectItem(metadata.id);
    } catch (error) {
      alert(error.message);
    }
  });

  document.querySelector("#deleteItemButton").addEventListener("click", async () => {
    const ok = confirm(`确认删除“${metadata.title}”？该资料的正文、原始文件、评论和快照都会被删除。`);
    if (!ok) return;
    try {
      await api(`/api/items/${encodeURIComponent(metadata.id)}`, { method: "DELETE" });
      state.selectedId = null;
      detailPanel.innerHTML = `<div class="empty-state">资料已删除。</div>`;
      await loadAll();
    } catch (error) {
      alert(error.message);
    }
  });
}

function setupDetailTitleMarquee() {
  const wrap = document.querySelector("#detailTitleWrap");
  const input = document.querySelector("#detailTitleInput");
  const marquee = document.querySelector("#detailTitleMarquee");
  if (!wrap || !input || !marquee) return;

  const update = () => {
    marquee.textContent = input.value || "Untitled material";
    wrap.classList.remove("is-overflowing");
    wrap.style.setProperty("--title-scroll-distance", "0px");
    requestAnimationFrame(() => {
      const overflow = marquee.scrollWidth - wrap.clientWidth;
      if (overflow > 8) {
        wrap.style.setProperty("--title-scroll-distance", `${overflow + 24}px`);
        wrap.classList.add("is-overflowing");
      }
    });
  };

  wrap.addEventListener("click", () => input.focus());
  input.addEventListener("input", update);
  input.addEventListener("focus", () => wrap.classList.add("is-editing"));
  input.addEventListener("blur", () => {
    wrap.classList.remove("is-editing");
    update();
  });
  update();
}

function setupDetailToc() {
  const doc = document.querySelector("#detailDoc");
  const tocWrap = document.querySelector("#detailTocWrap");
  const tocToggle = document.querySelector("#detailTocToggle");
  const toc = document.querySelector("#detailToc");
  const tocList = document.querySelector("#detailTocList");
  const layout = document.querySelector("#detailContentLayout");
  if (!doc || !tocWrap || !tocToggle || !toc || !tocList || !layout) return;

  const headings = [...doc.querySelectorAll("h1, h2, h3, h4")]
    .map((heading, index) => {
      const text = heading.textContent.trim();
      if (!text) return null;
      const id = uniqueHeadingId(slugForHeading(text), index, doc);
      heading.id = id;
      heading.classList.add("toc-heading");
      return {
        id,
        text,
        level: Number(heading.tagName.slice(1))
      };
    })
    .filter(Boolean);

  if (!headings.length) {
    tocWrap.hidden = true;
    toc.hidden = true;
    layout.classList.remove("has-toc");
    return;
  }

  tocWrap.hidden = false;
  toc.hidden = true;
  tocToggle.setAttribute("aria-expanded", "false");
  tocToggle.textContent = "目录";
  layout.classList.add("has-toc");
  tocList.innerHTML = headings.map((heading) => `
    <button type="button" class="detail-toc-link level-${heading.level}" data-heading-id="${escapeHtml(heading.id)}">
      ${escapeHtml(heading.text)}
    </button>
  `).join("");

  tocList.querySelectorAll("[data-heading-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.headingId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      toc.hidden = true;
      tocToggle.setAttribute("aria-expanded", "false");
      tocToggle.textContent = "目录";
    });
  });
  tocToggle.addEventListener("click", () => {
    const nextOpen = toc.hidden;
    toc.hidden = !nextOpen;
    tocToggle.setAttribute("aria-expanded", String(nextOpen));
    tocToggle.textContent = nextOpen ? "隐藏" : "目录";
  });
}

function slugForHeading(value) {
  const slug = String(value || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "heading";
}

function uniqueHeadingId(base, index, root) {
  let id = `doc-${base}`;
  let counter = index + 1;
  while (root.querySelector(`#${CSS.escape(id)}`)) {
    id = `doc-${base}-${counter}`;
    counter += 1;
  }
  return id;
}

async function openTagDialog(item) {
  state.tagEditor = {
    item,
    selected: [...(item.metadata.tags || [])],
    recommended: []
  };
  if (!state.tags.length) {
    await loadTags();
  }
  tagDialogSubtitle.textContent = item.metadata.title;
  tagManualInput.value = "";
  tagRecommendStatus.textContent = "可根据文档内容生成推荐标签。";
  renderTagDialog();
  tagDialog.showModal();
}

function closeTagDialog() {
  tagDialog.close();
}

function renderTagDialog() {
  const selected = state.tagEditor.selected || [];
  const recommended = state.tagEditor.recommended || [];
  const existing = state.tags || [];

  selectedTagChips.innerHTML = selected.length
    ? selected.map((tag) => `
        <button type="button" class="tag-edit-chip is-selected" data-remove-tag="${escapeHtml(tag)}">
          ${escapeHtml(tag)}
          <span aria-hidden="true">×</span>
        </button>
      `).join("")
    : `<div class="empty-inline">还没有选择标签。</div>`;

  existingTagChips.innerHTML = existing.length
    ? existing.map((tag) => `
        <button type="button" class="tag-edit-chip ${selected.includes(tag.name) ? "is-selected" : ""}" data-toggle-existing-tag="${escapeHtml(tag.name)}">
          ${escapeHtml(tag.name)}
          <small>${escapeHtml(String(tag.count || 0))}</small>
        </button>
      `).join("")
    : `<div class="empty-inline">资料库里还没有已有标签。</div>`;

  recommendedTagChips.innerHTML = recommended.length
    ? recommended.map((tag) => `
        <button type="button" class="tag-edit-chip ${selected.includes(tag) ? "is-selected" : ""}" data-toggle-tag="${escapeHtml(tag)}">
          ${escapeHtml(tag)}
        </button>
      `).join("")
    : `<div class="empty-inline">暂无推荐标签。</div>`;

  selectedTagChips.querySelectorAll("[data-remove-tag]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tagEditor.selected = state.tagEditor.selected.filter((tag) => tag !== button.dataset.removeTag);
      renderTagDialog();
    });
  });

  recommendedTagChips.querySelectorAll("[data-toggle-tag]").forEach((button) => {
    button.addEventListener("click", () => toggleSelectedTag(button.dataset.toggleTag));
  });

  existingTagChips.querySelectorAll("[data-toggle-existing-tag]").forEach((button) => {
    button.addEventListener("click", () => toggleSelectedTag(button.dataset.toggleExistingTag));
  });
}

function addManualTag() {
  const values = tagManualInput.value.split(",").map((tag) => slugTagClient(tag)).filter(Boolean);
  if (!values.length) return;
  state.tagEditor.selected = uniqueValues([...state.tagEditor.selected, ...values]);
  tagManualInput.value = "";
  renderTagDialog();
}

function toggleSelectedTag(tag) {
  if (!tag) return;
  if (state.tagEditor.selected.includes(tag)) {
    state.tagEditor.selected = state.tagEditor.selected.filter((value) => value !== tag);
  } else {
    state.tagEditor.selected = uniqueValues([...state.tagEditor.selected, tag]);
  }
  renderTagDialog();
}

async function recommendTagsForCurrentItem() {
  const item = state.tagEditor.item;
  if (!item) return;
  tagRecommendStatus.textContent = "正在生成推荐标签...";
  recommendTagsButton.disabled = true;
  try {
    const result = await api(`/api/items/${encodeURIComponent(item.metadata.id)}/recommend-tags`, { method: "POST" });
    state.tagEditor.recommended = uniqueValues(result.tags || []);
    tagRecommendStatus.textContent = result.note || "推荐标签已生成。";
    renderTagDialog();
  } catch (error) {
    tagRecommendStatus.textContent = error.message;
  } finally {
    recommendTagsButton.disabled = false;
  }
}

async function saveTagDialog(event) {
  event.preventDefault();
  const item = state.tagEditor.item;
  if (!item) return;
  const nextTags = uniqueValues(state.tagEditor.selected.map((tag) => slugTagClient(tag)).filter(Boolean));
  await api(`/api/items/${encodeURIComponent(item.metadata.id)}/tags`, {
    method: "PATCH",
    body: JSON.stringify({ tags: nextTags })
  });
  closeTagDialog();
  await loadAll();
  await selectItem(item.metadata.id);
}

function slugTagClient(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

async function loadAgentConfig() {
  const config = await api("/api/agent-config");
  agentRoot.textContent = config.rootDir;
}

async function loadSettings() {
  const { settings } = await api("/api/settings");
  settingBaseUrl.value = settings.ai.baseUrl || "";
  settingApiKey.value = settings.ai.apiKey || "";
  settingModel.value = settings.ai.model || "";
  settingShowThinking.checked = settings.chat?.showThinking !== false;
  settingShowToolCalls.checked = settings.chat?.showToolCalls !== false;
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
  activeDocumentRoot.textContent = settings.activeDocumentRoot || settings.documentRoot || "";
  renderSourceProfiles(settings.sources || {});
  renderRefreshJobs(settings.refreshJobs || []);
  rememberLatestRefreshRun(settings.refreshJobs || []);
  await loadSettingsTags();
}

async function loadSupplementalContext() {
  supplementalStatus.textContent = "正在载入补充资料...";
  try {
    const { entries, path } = await api("/api/supplemental-context");
    state.supplementalEntries = normalizeSupplementalEntriesClient(entries || []);
    renderSupplementalEntries();
    supplementalStatus.textContent = `保存位置：${path}`;
  } catch (error) {
    supplementalStatus.textContent = error.message;
  }
}

async function saveSupplementalContext() {
  saveSupplementalButton.disabled = true;
  supplementalStatus.textContent = "正在保存补充资料...";
  try {
    syncSupplementalEntriesFromDom();
    const { entries, path } = await api("/api/supplemental-context", {
      method: "PATCH",
      body: JSON.stringify({ entries: state.supplementalEntries })
    });
    state.supplementalEntries = normalizeSupplementalEntriesClient(entries || []);
    renderSupplementalEntries();
    supplementalStatus.textContent = `已保存：${path}`;
  } catch (error) {
    supplementalStatus.textContent = error.message;
  } finally {
    saveSupplementalButton.disabled = false;
  }
}

async function suggestSupplementalContext() {
  suggestSupplementalButton.disabled = true;
  supplementalStatus.textContent = "正在分析现有资料...";
  try {
    syncSupplementalEntriesFromDom();
    const { entries } = await api("/api/supplemental-context/suggest", {
      method: "POST",
      body: JSON.stringify({ existingEntries: state.supplementalEntries })
    });
    const before = state.supplementalEntries.length;
    state.supplementalEntries = mergeSupplementalEntries(state.supplementalEntries, entries || []);
    renderSupplementalEntries();
    const added = state.supplementalEntries.length - before;
    supplementalStatus.textContent = added
      ? `已加入 ${added} 个候选项，请逐条补充说明后保存。`
      : "没有发现新的候选项。";
  } catch (error) {
    supplementalStatus.textContent = error.message;
  } finally {
    suggestSupplementalButton.disabled = false;
  }
}

function renderSupplementalEntries() {
  const entries = state.supplementalEntries || [];
  const completeCount = entries.filter((entry) => entry.explanation.trim()).length;
  const pendingCount = entries.length - completeCount;
  supplementalSummary.innerHTML = entries.length
    ? `
        <span>全部 ${entries.length}</span>
        <span>已说明 ${completeCount}</span>
        <span>未说明 ${pendingCount}</span>
      `
    : `<span>还没有补充项</span>`;
  supplementalList.innerHTML = entries.length
    ? entries.map((entry) => renderSupplementalEntry(entry)).join("")
    : `<div class="empty-state">点击“新增条目”，或让 AI 从已有资料中分析候选项。</div>`;

  supplementalList.querySelectorAll("[data-supplemental-field]").forEach((field) => {
    field.addEventListener("input", () => {
      const entry = state.supplementalEntries.find((candidate) => candidate.id === field.dataset.entryId);
      if (!entry) return;
      entry[field.dataset.supplementalField] = field.value;
      if (field.dataset.supplementalField === "explanation") {
        renderSupplementalEntryStatus(field.dataset.entryId);
      }
    });
  });
  supplementalList.querySelectorAll("[data-delete-supplemental]").forEach((button) => {
    button.addEventListener("click", () => {
      state.supplementalEntries = state.supplementalEntries.filter((entry) => entry.id !== button.dataset.deleteSupplemental);
      renderSupplementalEntries();
    });
  });
}

function renderSupplementalEntry(entry) {
  const isComplete = Boolean(entry.explanation.trim());
  return `
    <section class="supplemental-entry ${isComplete ? "is-complete" : ""}" data-entry-id="${escapeHtml(entry.id)}">
      <div class="supplemental-entry-header">
        <input data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="term" value="${escapeHtml(entry.term)}" placeholder="术语、缩写或项目名">
        <input data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="category" value="${escapeHtml(entry.category)}" placeholder="分类">
        <span class="supplemental-entry-status">${isComplete ? "已说明" : "未说明"}</span>
        <button class="supplemental-entry-delete" type="button" data-delete-supplemental="${escapeHtml(entry.id)}">删除</button>
      </div>
      <div class="supplemental-entry-reason">
        <input data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="reason" value="${escapeHtml(entry.reason)}" placeholder="为什么需要补充说明">
      </div>
      <textarea data-entry-id="${escapeHtml(entry.id)}" data-supplemental-field="explanation" placeholder="在这里填写你的解释。只有填写了说明的条目会进入 AI 处理上下文。">${escapeHtml(entry.explanation)}</textarea>
    </section>
  `;
}

function renderSupplementalEntryStatus(id) {
  const entry = state.supplementalEntries.find((candidate) => candidate.id === id);
  const section = supplementalList.querySelector(`[data-entry-id="${CSS.escape(id)}"]`);
  if (!entry || !section) return;
  const isComplete = Boolean(entry.explanation.trim());
  section.classList.toggle("is-complete", isComplete);
  const status = section.querySelector(".supplemental-entry-status");
  if (status) status.textContent = isComplete ? "已说明" : "未说明";
  const completeCount = state.supplementalEntries.filter((candidate) => candidate.explanation.trim()).length;
  const pendingCount = state.supplementalEntries.length - completeCount;
  supplementalSummary.innerHTML = `
    <span>全部 ${state.supplementalEntries.length}</span>
    <span>已说明 ${completeCount}</span>
    <span>未说明 ${pendingCount}</span>
  `;
}

function syncSupplementalEntriesFromDom() {
  supplementalList.querySelectorAll("[data-supplemental-field]").forEach((field) => {
    const entry = state.supplementalEntries.find((candidate) => candidate.id === field.dataset.entryId);
    if (entry) entry[field.dataset.supplementalField] = field.value;
  });
}

function addSupplementalEntry() {
  syncSupplementalEntriesFromDom();
  state.supplementalEntries.unshift({
    id: `manual-${Date.now()}`,
    term: "",
    category: "待确认",
    reason: "",
    explanation: ""
  });
  renderSupplementalEntries();
  const firstInput = supplementalList.querySelector("[data-supplemental-field='term']");
  firstInput?.focus();
}

function normalizeSupplementalEntriesClient(entries) {
  return (entries || []).map((entry, index) => ({
    id: String(entry.id || `entry-${index}-${Date.now()}`),
    term: String(entry.term || "").trim(),
    category: String(entry.category || "待确认").trim() || "待确认",
    reason: String(entry.reason || "").trim(),
    explanation: String(entry.explanation || "").trim()
  })).filter((entry) => entry.term || entry.reason || entry.explanation);
}

function mergeSupplementalEntries(current, incoming) {
  const merged = normalizeSupplementalEntriesClient(current);
  const seen = new Set(merged.map((entry) => entry.term.toLowerCase()).filter(Boolean));
  for (const entry of normalizeSupplementalEntriesClient(incoming)) {
    const key = entry.term.toLowerCase();
    if (key && seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  return merged;
}

async function sendChatMessage(event) {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) {
    return;
  }

  const session = getActiveChatSession();
  if (!session) return;
  if (session.title === "新对话") {
    session.title = message.slice(0, 32);
  }
  session.messages.push({ role: "user", text: message, at: new Date().toISOString() });
  session.updatedAt = new Date().toISOString();
  appendMessage("user", message);
  chatInput.value = "";
  const pending = settingShowThinking.checked
    ? appendMessage("event", "正在查找相关资料...", { title: "思考", kind: "thinking" })
    : null;
  saveChatSessions();
  renderChatHistory();

  try {
    let pendingRemoved = false;
    let assistantMessage = null;
    let assistantText = "";
    let latestSources = [];
    const removePending = () => {
      if (pendingRemoved) return;
      if (pending?.isConnected) pending.remove();
      pendingRemoved = true;
    };

    await streamApi("/api/chat-stream", { message }, {
      trace: (event) => {
        removePending();
        if (!shouldDisplayTraceEvent(event)) return;
        const traceMessage = toTraceMessage(event);
        session.messages.push(traceMessage);
        appendMessage(traceMessage.role, traceMessage.text, traceMessage);
      },
      sources: (event) => {
        latestSources = event.sources || [];
      },
      delta: (event) => {
        removePending();
        if (!assistantMessage) {
          assistantMessage = appendMessage("assistant", "");
        }
        assistantText += event.text || "";
        setMessageBody(assistantMessage, "assistant", assistantText);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      },
      done: (answer) => {
        removePending();
        latestSources = answer.sources || latestSources;
        const finalText = formatChatAnswer({ ...answer, sources: latestSources, content: answer.content || assistantText });
        if (!assistantMessage) {
          assistantMessage = appendMessage("assistant", finalText);
        } else {
          setMessageBody(assistantMessage, "assistant", finalText);
        }
        session.messages.push({ role: "assistant", text: finalText, at: new Date().toISOString() });
      },
      error: (event) => {
        throw new Error(event.error || "流式对话失败");
      }
    });
  } catch (error) {
    const text = error.message;
    if (pending?.isConnected) pending.remove();
    const traceMessage = { role: "event", title: "错误", kind: "error", text, at: new Date().toISOString() };
    session.messages.push(traceMessage);
    appendMessage("event", text, traceMessage);
    session.messages.push({ role: "assistant", text, at: new Date().toISOString(), error: true });
    appendMessage("assistant", text);
  }

  session.updatedAt = new Date().toISOString();
  saveChatSessions();
  renderChatHistory();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendMessage(role, text, meta = {}) {
  const message = document.createElement("div");
  message.className = `chat-message ${role} ${meta.kind ? `event-${meta.kind}` : ""}`;
  if (role === "event") {
    message.innerHTML = `
      <button type="button" class="event-toggle" aria-expanded="false">
        <span>${escapeHtml(messageRoleLabel(role, meta))}</span>
        <span class="event-chevron">展开</span>
      </button>
      <div class="message-body" hidden></div>
    `;
    message.querySelector(".event-toggle").addEventListener("click", () => toggleEventMessage(message));
  } else {
    message.innerHTML = `
      <div class="message-role">${escapeHtml(messageRoleLabel(role, meta))}</div>
      <div class="message-body"></div>
    `;
  }
  setMessageBody(message, role, text);
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
}

function setMessageBody(message, role, text) {
  const body = message.querySelector(".message-body");
  if (!body) return;
  if (role === "assistant") {
    body.classList.add("markdown-body");
    body.innerHTML = renderMarkdown(text);
  } else {
    body.classList.remove("markdown-body");
    body.textContent = text;
  }
}

function toggleEventMessage(message) {
  const body = message.querySelector(".message-body");
  const button = message.querySelector(".event-toggle");
  const chevron = message.querySelector(".event-chevron");
  const expanded = body.hidden;
  body.hidden = !expanded;
  button.setAttribute("aria-expanded", String(expanded));
  chevron.textContent = expanded ? "收起" : "展开";
}

function formatChatAnswer(answer) {
  const sources = (answer.sources || []).slice(0, 5);
  if (!sources.length) return answer.content;
  const sourceLines = sources.map((source, index) => (
    `${index + 1}. ${source.title} · ${source.sourceType} · ${source.url || source.id}`
  ));
  return `${answer.content}\n\n参考资料：\n${sourceLines.join("\n")}`;
}

function toTraceMessage(event) {
  return {
    role: "event",
    kind: event.type || "tool",
    title: event.title || "过程",
    text: event.detail || "",
    at: new Date().toISOString()
  };
}

function shouldDisplayTraceEvent(event) {
  if (event.type === "thinking") return settingShowThinking.checked;
  if (event.type === "tool" || event.type === "tool_result") return settingShowToolCalls.checked;
  return true;
}

function messageRoleLabel(role, meta = {}) {
  if (role === "user") return "You";
  if (role === "event") {
    const labels = {
      thinking: "思考",
      tool: "工具调用",
      tool_result: "工具结果",
      error: "错误"
    };
    const prefix = labels[meta.kind] || "过程";
    return meta.title ? `${prefix} · ${meta.title}` : prefix;
  }
  return "Assistant";
}

function loadChatSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem("materialOrganizer.chatSessions") || "[]");
    state.chatSessions = Array.isArray(saved) ? saved.filter((session) => session.id) : [];
  } catch {
    state.chatSessions = [];
  }

  state.activeChatId = localStorage.getItem("materialOrganizer.activeChatId") || state.chatSessions[0]?.id || "";
  if (!state.chatSessions.length || !getActiveChatSession()) {
    createChatSession({ activate: true, save: false });
  }
  renderChatHistory();
  renderActiveChat();
  saveChatSessions();
}

function createChatSession(options = {}) {
  const now = new Date().toISOString();
  const session = {
    id: `chat-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [
      {
        role: "assistant",
        text: "可以直接问资料库里的内容。后端会先读取本地知识库、检索相关资料，再用设置里的 AI 接口回答；未配置 AI 时会返回可追溯的本地检索结果。",
        at: now
      }
    ]
  };
  state.chatSessions.unshift(session);
  if (options.activate !== false) state.activeChatId = session.id;
  if (options.save !== false) saveChatSessions();
  renderChatHistory();
  renderActiveChat();
  chatInput.focus();
  return session;
}

function getActiveChatSession() {
  return state.chatSessions.find((session) => session.id === state.activeChatId) || null;
}

function activateChatSession(id) {
  state.activeChatId = id;
  saveChatSessions();
  renderChatHistory();
  renderActiveChat();
}

function deleteChatSession(id) {
  const session = state.chatSessions.find((candidate) => candidate.id === id);
  if (!session) return;
  const ok = confirm(`删除对话“${session.title || "新对话"}”？`);
  if (!ok) return;

  state.chatSessions = state.chatSessions.filter((candidate) => candidate.id !== id);
  if (state.activeChatId === id) {
    state.activeChatId = state.chatSessions[0]?.id || "";
  }
  if (!state.chatSessions.length) {
    createChatSession({ activate: true, save: false });
  }
  saveChatSessions();
  renderChatHistory();
  renderActiveChat();
}

function clearChatHistory() {
  if (!state.chatSessions.length) return;
  const ok = confirm("清除所有 AI 对话历史？");
  if (!ok) return;

  state.chatSessions = [];
  state.activeChatId = "";
  createChatSession({ activate: true, save: false });
  saveChatSessions();
  renderChatHistory();
  renderActiveChat();
}

function renderActiveChat() {
  const session = getActiveChatSession();
  if (!session) return;
  chatSessionTitle.textContent = session.title || "新对话";
  chatMessages.innerHTML = "";
  for (const message of session.messages || []) {
    appendMessage(message.role, message.text, message);
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatHistory() {
  const sessions = [...state.chatSessions].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  chatHistoryList.innerHTML = sessions.map((session) => {
    const last = [...(session.messages || [])].reverse().find((message) => message.role === "user") || session.messages?.at(-1);
    return `
      <div class="chat-history-row ${session.id === state.activeChatId ? "is-active" : ""}">
        <button type="button" class="chat-history-item" data-chat-id="${escapeHtml(session.id)}">
          <span>${escapeHtml(session.title || "新对话")}</span>
          <small>${escapeHtml(last?.text || "暂无消息")}</small>
        </button>
        <button type="button" class="chat-history-delete" data-delete-chat-id="${escapeHtml(session.id)}" aria-label="删除对话">×</button>
      </div>
    `;
  }).join("");
  chatHistoryList.querySelectorAll("[data-chat-id]").forEach((button) => {
    button.addEventListener("click", () => activateChatSession(button.dataset.chatId));
  });
  chatHistoryList.querySelectorAll("[data-delete-chat-id]").forEach((button) => {
    button.addEventListener("click", () => deleteChatSession(button.dataset.deleteChatId));
  });
}

function saveChatSessions() {
  const sessions = state.chatSessions
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 30);
  state.chatSessions = sessions;
  localStorage.setItem("materialOrganizer.chatSessions", JSON.stringify(sessions));
  localStorage.setItem("materialOrganizer.activeChatId", state.activeChatId);
}

async function buildAskContext(question) {
  return api("/api/ask-context", {
    method: "POST",
    body: JSON.stringify({ question })
  });
}

async function autoPreviewImport() {
  const content = importContent.value.trim();
  const url = importUrl.value.trim();
  if (!content && !url) return;
  await previewImport();
}

async function previewImport(event) {
  event?.preventDefault();
  const content = importContent.value.trim();
  const url = importUrl.value.trim();
  if (!content && !url) {
    previewStatus.textContent = "先粘贴内容、输入 URL，或拖入文本文件。";
    previewBadge.textContent = "等待输入";
    return;
  }

  previewStatus.textContent = "正在解析内容...";
  previewBadge.textContent = "解析中";
  confirmImportButton.disabled = true;

  try {
    const { preview } = await api("/api/preview-source", {
      method: "POST",
      body: JSON.stringify({
        content,
        url,
        sourceType: importSourceType.value,
        fetchMode: importFetchMode.value,
        pageKind: importPageKind.value
      })
    });

    state.importPreview = preview;
    confirmTitle.value = preview.title;
    previewContent.value = preview.extractedContent;
    summaryContent.value = "";
    const duplicateNote = preview.existingItem
      ? ` 已发现相同页面已导入：${preview.existingItem.title}（${formatDate(preview.existingItem.updatedAt)}）。`
      : "";
    const linkedNote = preview.linkedItems?.length
      ? ` 检测到 ${preview.linkedItems.length} 个内容链接，确认导入后会同步导入这些内容页。`
      : "";
    const refreshJobNote = preview.refreshJob
      ? ` 已加入订阅管理：${preview.refreshJob.name}（默认${preview.refreshJob.enabled ? "开启" : "关闭"}，可在订阅管理页点击立即刷新）。`
      : "";
    previewStatus.textContent = `${preview.parseNote} 内容长度 ${preview.contentLength} 字符。${linkedNote}${refreshJobNote}${duplicateNote}`;
    const isSubscription = preview.importMode === "subscription" || (preview.pageKind === "list" && preview.refreshJob);
    summaryStatus.textContent = isSubscription ? "订阅链接不需要生成总结，刷新订阅后会导入内容页。" : "可以生成 AI 总结，或手动填写总结。";
    previewBadge.textContent = isSubscription ? "订阅" : preview.existingItem ? "已存在" : (preview.parseStatus === "ready" ? "可导入" : "需确认");
    confirmImportButton.textContent = isSubscription ? "查看订阅" : preview.existingItem ? "查看已有资料" : "确认导入";
    confirmImportButton.disabled = isSubscription ? !preview.refreshJob : (!preview.extractedContent.trim() && !preview.existingItem);
    summarizeButton.disabled = isSubscription || !preview.extractedContent.trim();
  } catch (error) {
    previewStatus.textContent = error.message;
    previewBadge.textContent = "失败";
    confirmImportButton.disabled = true;
    summarizeButton.disabled = true;
  }
}

async function confirmImport() {
  if (!state.importPreview) return;

  const preview = state.importPreview;
  if (preview.existingItem?.id) {
    const existingId = preview.existingItem.id;
    resetImport();
    await switchView("materials");
    await selectItem(existingId);
    return;
  }

  if (preview.importMode === "subscription" || (preview.pageKind === "list" && preview.refreshJob)) {
    resetImport();
    await switchView("subscriptions");
    return;
  }

  const item = await api("/api/items", {
    method: "POST",
    body: JSON.stringify({
      title: confirmTitle.value.trim() || preview.title,
      sourceType: preview.sourceType,
      url: preview.url,
      tags: confirmTags.value,
      rawContent: preview.rawContent,
      extractedContent: previewContent.value,
      summary: summaryContent.value,
      comments: preview.comments || [],
      rawFileName: preview.rawFileName,
      lastFetchedAt: preview.lastFetchedAt,
      pageKind: preview.pageKind,
      fetchMode: preview.fetchMode,
      maxItems: 50
    })
  });

  resetImport();
  await switchView("materials");
  await selectItem(item.item.metadata.id);
}

function resetImport() {
  state.importPreview = null;
  importForm.reset();
  confirmTitle.value = "";
  confirmTags.value = "";
  previewContent.value = "";
  summaryContent.value = "";
  previewStatus.textContent = "等待输入内容。";
  summaryStatus.textContent = "解析内容后可生成总结。";
  previewBadge.textContent = "未解析";
  confirmImportButton.textContent = "确认导入";
  confirmImportButton.disabled = true;
  summarizeButton.disabled = true;
}

async function summarizePreview() {
  const content = previewContent.value.trim();
  if (!content) return;

  summaryStatus.textContent = "正在生成总结...";
  summarizeButton.disabled = true;
  try {
    const { summary } = await api("/api/summarize", {
      method: "POST",
      body: JSON.stringify({ content })
    });
    summaryContent.value = summary.text;
    summaryStatus.textContent = summary.note;
  } catch (error) {
    summaryStatus.textContent = error.message;
  } finally {
    summarizeButton.disabled = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  settingsStatus.textContent = "正在保存...";
  try {
    const { settings } = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        ai: {
          baseUrl: settingBaseUrl.value,
          apiKey: settingApiKey.value === "********" ? undefined : settingApiKey.value,
          model: settingModel.value
        },
        chat: {
          showThinking: settingShowThinking.checked,
          showToolCalls: settingShowToolCalls.checked
        },
        notifications: collectNotificationSettings(),
        refreshSchedule: {
          startTime: settingRefreshStartTime.value,
          endTime: settingRefreshEndTime.value
        },
        embedding: {
          enabled: settingEmbeddingEnabled.checked,
          baseUrl: settingEmbeddingBaseUrl.value,
          apiKey: settingEmbeddingApiKey.value === "********" ? undefined : settingEmbeddingApiKey.value,
          model: settingEmbeddingModel.value,
          dimensions: Number(settingEmbeddingDimensions.value || 0)
        },
        processingPrompts: collectProcessingPrompts(),
        documentRoot: settingDocumentRoot.value,
        sources: collectSourceProfiles(),
        refreshJobs: collectRefreshJobs()
      })
    });
    activeDocumentRoot.textContent = settings.activeDocumentRoot;
    settingApiKey.value = settings.ai.apiKey;
    settingShowThinking.checked = settings.chat?.showThinking !== false;
    settingShowToolCalls.checked = settings.chat?.showToolCalls !== false;
    settingNotificationsEnabled.checked = settings.notifications?.enabled !== false;
    for (const input of notificationSourceInputs) {
      input.checked = settings.notifications?.sources?.[input.dataset.notificationSource] !== false;
    }
    settingRefreshStartTime.value = settings.refreshSchedule?.startTime || "08:00";
    settingRefreshEndTime.value = settings.refreshSchedule?.endTime || "20:00";
    settingEmbeddingEnabled.checked = Boolean(settings.embedding?.enabled);
    settingEmbeddingApiKey.value = settings.embedding?.apiKey || "";
    settingEmbeddingBaseUrl.value = settings.embedding?.baseUrl || "";
    settingEmbeddingModel.value = settings.embedding?.model || "";
    settingEmbeddingDimensions.value = settings.embedding?.dimensions || "";
    for (const field of processingPromptFields) {
      field.value = settings.processingPrompts?.[field.dataset.processingPrompt] || field.value;
    }
    agentRoot.textContent = settings.activeDocumentRoot;
    settingsStatus.textContent = "设置已保存。";
    renderRefreshJobs(settings.refreshJobs || []);
    await loadSettingsTags();
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

async function downloadExport(path) {
  importExportStatus.textContent = "正在生成导出文件...";
  try {
    const response = await fetch(path);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `导出失败：${response.status}`);
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("Content-Disposition"))
      || (path.includes("settings") ? "assistant-settings.json" : "assistant-data.json");
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    importExportStatus.textContent = `已导出 ${filename}。`;
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

async function importSettingsFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  importExportStatus.textContent = "正在导入设置...";
  try {
    const payload = JSON.parse(await file.text());
    const { settings } = await api("/api/import/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadSettings();
    activeDocumentRoot.textContent = settings.activeDocumentRoot;
    agentRoot.textContent = settings.activeDocumentRoot;
    importExportStatus.textContent = "设置导入完成。";
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

async function importDataFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  importExportStatus.textContent = "正在导入数据...";
  try {
    const bundle = JSON.parse(await file.text());
    const result = await api("/api/import/data", {
      method: "POST",
      body: JSON.stringify({
        bundle,
        mode: replaceDataOnImport.checked ? "replace" : "merge"
      })
    });
    await loadTags();
    if (state.view === "materials") await loadItems();
    importExportStatus.textContent = `数据导入完成：写入 ${result.writtenFileCount} 个文件。`;
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

function filenameFromDisposition(disposition) {
  const value = String(disposition || "");
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : "";
}

function collectProcessingPrompts() {
  return Object.fromEntries(processingPromptFields.map((field) => [
    field.dataset.processingPrompt,
    field.value
  ]));
}

function collectNotificationSettings() {
  return {
    enabled: settingNotificationsEnabled.checked,
    sources: Object.fromEntries(notificationSourceInputs.map((input) => [
      input.dataset.notificationSource,
      input.checked
    ]))
  };
}

async function loadSettingsTags() {
  const { tags } = await api("/api/tags");
  state.settingsTags = tags || [];
  state.selectedSettingsTags = new Set([...state.selectedSettingsTags].filter((tag) => state.settingsTags.some((item) => item.name === tag)));
  renderSettingsTags();
}

function renderSettingsTags() {
  if (!settingsTagList) return;
  const selectedCount = state.selectedSettingsTags.size;
  tagManagerStatus.textContent = selectedCount
    ? `已选择 ${selectedCount} 个标签。`
    : `共 ${state.settingsTags.length} 个标签。`;
  deleteSelectedTagsButton.disabled = selectedCount === 0;
  clearTagSelectionButton.disabled = selectedCount === 0;
  selectAllTagsButton.disabled = state.settingsTags.length === 0 || selectedCount === state.settingsTags.length;

  settingsTagList.innerHTML = state.settingsTags.length
    ? state.settingsTags.map((tag) => `
        <div class="settings-tag-row">
          <label class="settings-tag-check">
            <input type="checkbox" data-settings-tag="${escapeHtml(tag.name)}" ${state.selectedSettingsTags.has(tag.name) ? "checked" : ""} />
            <span>${escapeHtml(tag.name)}</span>
          </label>
          <small>${escapeHtml(tag.count)} 条资料</small>
          <button type="button" data-rename-settings-tag="${escapeHtml(tag.name)}">改名</button>
        </div>
      `).join("")
    : `<div class="empty-inline">还没有标签。</div>`;

  settingsTagList.querySelectorAll("[data-settings-tag]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedSettingsTags.add(checkbox.dataset.settingsTag);
      } else {
        state.selectedSettingsTags.delete(checkbox.dataset.settingsTag);
      }
      renderSettingsTags();
    });
  });
  settingsTagList.querySelectorAll("[data-rename-settings-tag]").forEach((button) => {
    button.addEventListener("click", () => renameSettingsTag(button.dataset.renameSettingsTag));
  });
}

async function addSettingsTags() {
  const value = newTagInput.value.trim();
  if (!value) return;
  tagManagerStatus.textContent = "正在新增标签...";
  try {
    const { tags } = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ tags: value })
    });
    newTagInput.value = "";
    state.settingsTags = tags || [];
    await loadTags();
    renderSettingsTags();
    tagManagerStatus.textContent = "标签已新增。";
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function deleteSelectedSettingsTags() {
  const tags = [...state.selectedSettingsTags];
  if (!tags.length) return;
  const totalUsage = state.settingsTags
    .filter((tag) => state.selectedSettingsTags.has(tag.name))
    .reduce((sum, tag) => sum + Number(tag.count || 0), 0);
  const ok = confirm(`确认删除 ${tags.length} 个标签？这些标签会从 ${totalUsage} 处资料标签中移除，资料本身不会删除。`);
  if (!ok) return;

  tagManagerStatus.textContent = "正在删除标签...";
  try {
    const result = await api("/api/tags", {
      method: "DELETE",
      body: JSON.stringify({ tags })
    });
    state.selectedSettingsTags.clear();
    state.settingsTags = result.tags || [];
    await loadTags();
    if (state.view === "materials") await loadItems();
    renderSettingsTags();
    tagManagerStatus.textContent = `已删除 ${result.deletedTags.length} 个标签，影响 ${result.touchedItems.length} 条资料。`;
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function renameSettingsTag(oldTag) {
  const tag = state.settingsTags.find((item) => item.name === oldTag);
  const nextName = prompt(`将标签“${oldTag}”改名为：`, oldTag);
  if (nextName === null) return;
  const normalized = slugTagClient(nextName);
  if (!normalized || normalized === oldTag) return;
  const exists = state.settingsTags.some((item) => item.name === normalized && item.name !== oldTag);
  const ok = exists
    ? confirm(`标签“${normalized}”已存在。继续会把“${oldTag}”合并到这个标签，并更新 ${tag?.count || 0} 条资料。`)
    : confirm(`确认将“${oldTag}”改名为“${normalized}”？会更新 ${tag?.count || 0} 条资料。`);
  if (!ok) return;

  tagManagerStatus.textContent = "正在改名标签...";
  try {
    const wasSelected = state.selectedSettingsTags.has(oldTag);
    const result = await api("/api/tags", {
      method: "PATCH",
      body: JSON.stringify({ from: oldTag, to: normalized })
    });
    state.selectedSettingsTags.delete(oldTag);
    if (wasSelected) state.selectedSettingsTags.add(result.newTag);
    state.settingsTags = result.tags || [];
    await loadTags();
    await loadItems();
    renderSettingsTags();
    tagManagerStatus.textContent = `已将 ${result.oldTag} 改名为 ${result.newTag}，影响 ${result.touchedItems.length} 条资料。`;
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function openWebdriver(url) {
  webdriverStatus.textContent = "正在打开登录浏览器...";
  try {
    const { session } = await api("/api/webdriver/open", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    webdriverStatus.textContent = `已打开 ${session.hostname}，登录态会保存到 ${session.userDataDir}`;
  } catch (error) {
    webdriverStatus.textContent = error.message;
  }
}

async function saveWebdriverCookies(url) {
  webdriverStatus.textContent = "正在保存当前登录 Cookie...";
  try {
    const { saved, settings } = await api("/api/webdriver/save-cookies", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    renderSourceProfiles(settings.sources || {});
    webdriverStatus.textContent = `已保存 ${saved.hostname} 的 ${saved.cookieCount} 个 Cookie，后续普通抓取会优先使用 Cookie。`;
  } catch (error) {
    webdriverStatus.textContent = error.message;
  }
}

function renderSourceProfiles(profiles) {
  const labels = {
    "confluence.amlogic.com": "Amlogic Confluence",
    "jira.amlogic.com": "Amlogic Jira",
    "roku.atlassian.net": "Roku Atlassian",
    "github.ecodesamsung.com": "Samsung GitHub",
    "teams.microsoft.com": "Microsoft Teams"
  };
  sourceProfiles.innerHTML = Object.entries(profiles).map(([hostname, profile]) => `
    <section class="source-profile" data-hostname="${escapeHtml(hostname)}">
      <div>
        <strong>${escapeHtml(labels[hostname] || hostname)}</strong>
        <span>${escapeHtml(hostname)}</span>
      </div>
      <label>
        认证方式
        <select data-field="authMode">
          <option value="none" ${profile.authMode === "none" ? "selected" : ""}>无</option>
          <option value="cookie" ${profile.authMode === "cookie" ? "selected" : ""}>Cookie</option>
          <option value="basic" ${profile.authMode === "basic" ? "selected" : ""}>用户名密码 / Basic</option>
          <option value="bearer" ${profile.authMode === "bearer" ? "selected" : ""}>Bearer Token</option>
        </select>
      </label>
      <label class="checkbox-row">
        <input data-field="webdriverHeadless" type="checkbox" ${profile.webdriverHeadless ? "checked" : ""} />
        <span>后台抓取使用无头浏览器</span>
      </label>
      <label>
        Webdriver 窗口模式
        <select data-field="webdriverWindowMode">
          <option value="compact" ${profile.webdriverWindowMode !== "normal" && profile.webdriverWindowMode !== "minimized" ? "selected" : ""}>小窗口后台</option>
          <option value="normal" ${profile.webdriverWindowMode === "normal" ? "selected" : ""}>正常窗口</option>
          <option value="minimized" ${profile.webdriverWindowMode === "minimized" ? "selected" : ""}>尝试最小化</option>
        </select>
      </label>
      <label data-auth-field="basic">
        用户名
        <input data-field="username" value="${escapeHtml(profile.username || "")}" placeholder="Basic 认证时使用" />
      </label>
      <label data-auth-field="basic">
        密码
        <input data-field="password" type="password" value="${escapeHtml(profile.password || "")}" placeholder="Basic 认证时使用" />
      </label>
      <label data-auth-field="cookie">
        Cookie
        <textarea data-field="cookie" rows="2" placeholder="从浏览器复制 Cookie 请求头">${escapeHtml(profile.cookie || "")}</textarea>
      </label>
      <label data-auth-field="bearer">
        Token
        <input data-field="token" type="password" value="${escapeHtml(profile.token || "")}" placeholder="Bearer token" />
      </label>
    </section>
  `).join("");

  sourceProfiles.querySelectorAll(".source-profile").forEach((section) => {
    const select = section.querySelector('[data-field="authMode"]');
    updateAuthFields(section);
    select.addEventListener("change", () => updateAuthFields(section));
  });
}

function collectSourceProfiles() {
  const profiles = {};
  sourceProfiles.querySelectorAll(".source-profile").forEach((section) => {
    const hostname = section.dataset.hostname;
    profiles[hostname] = {};
    section.querySelectorAll("[data-field]").forEach((field) => {
      profiles[hostname][field.dataset.field] = field.type === "checkbox" ? field.checked : field.value;
    });
  });
  return profiles;
}

function updateAuthFields(section) {
  const authMode = section.querySelector('[data-field="authMode"]')?.value || "none";
  section.querySelectorAll("[data-auth-field]").forEach((field) => {
    field.hidden = field.dataset.authField !== authMode;
  });
}

function renderRefreshJobs(jobs) {
  state.refreshJobs = jobs || [];
  renderHomeOverview();
  renderSubscriptionTabs();
  const visibleJobs = refreshJobsForCurrentTab();

  if (!visibleJobs.length) {
    refreshJobs.innerHTML = `<div class="empty-state">还没有刷新任务。</div>`;
    return;
  }

  if (state.subscriptionSource === "content") {
    renderContentPageRefreshGroup(visibleJobs);
    return;
  }

  refreshJobs.innerHTML = visibleJobs.map((job) => `
    <section class="refresh-job" data-id="${escapeHtml(job.id)}">
      <div class="refresh-job-title">
        <label class="inline-toggle">
          <input data-field="enabled" type="checkbox" ${job.enabled ? "checked" : ""} />
          <strong>${escapeHtml(job.name)}</strong>
        </label>
        <div class="refresh-job-actions">
          <button type="button" data-run-job="${escapeHtml(job.id)}" ${job.running ? "disabled" : ""}>${job.running ? "运行中" : "立即刷新"}</button>
          ${isManagedContentPageJob(job) ? "" : `
            <button type="button" class="danger-button" data-clear-job-items="${escapeHtml(job.id)}">清空内容</button>
            <button type="button" class="danger-button" data-delete-job="${escapeHtml(job.id)}">删除</button>
          `}
        </div>
      </div>
      <label>
        ${isManagedContentPageJob(job) ? "页面 URL" : "订阅 URL"}
        <input data-field="url" value="${escapeHtml(job.url || "")}" />
      </label>
      <div class="settings-grid">
        <label>
          刷新间隔分钟
          <input data-field="intervalMinutes" type="number" min="5" value="${escapeHtml(job.intervalMinutes || 60)}" />
        </label>
        <label>
          最多刷新条数
          <input data-field="maxItems" type="number" min="1" value="${escapeHtml(job.maxItems || 50)}" />
        </label>
      </div>
      <label>
        标签
        <input data-field="tags" value="${escapeHtml(refreshJobTagsText(job.tags))}" />
      </label>
      <div class="item-meta">
        状态：${escapeHtml(formatRefreshStatus(job.running ? "running" : job.status || "idle"))} · 上次刷新：${escapeHtml(job.lastRunAt ? formatDate(job.lastRunAt) : "未刷新")}
      </div>
      ${job.lastError ? `<div class="item-meta">错误：${escapeHtml(job.lastError)}</div>` : ""}
      ${job.lastResult && !["failed", "unreachable", "running"].includes(job.status) ? `<div class="item-meta">结果：更新 ${escapeHtml(job.lastResult.updatedItemCount ?? job.lastResult.updatedIssueCount ?? 0)} / ${escapeHtml(job.lastResult.linkCount ?? job.lastResult.issueCount ?? 0)} 个内容页，跳过 ${escapeHtml(job.lastResult.skippedItemCount || 0)}</div>` : ""}
      <input data-field="fetchMode" type="hidden" value="${escapeHtml(job.fetchMode || "auto")}" />
      <input data-field="pageKind" type="hidden" value="${escapeHtml(job.pageKind || "list")}" />
    </section>
  `).join("");

  refreshJobs.querySelectorAll("[data-run-job]").forEach((button) => {
    button.addEventListener("click", () => runRefreshJob(button.dataset.runJob));
  });
  refreshJobs.querySelectorAll("[data-clear-job-items]").forEach((button) => {
    button.addEventListener("click", () => clearRefreshJobItems(button.dataset.clearJobItems));
  });
  refreshJobs.querySelectorAll("[data-delete-job]").forEach((button) => {
    button.addEventListener("click", () => deleteRefreshJob(button.dataset.deleteJob));
  });
}

function renderContentPageRefreshGroup(contentJobs) {
  const enabledCount = contentJobs.filter((job) => job.enabled).length;
  const intervalMinutes = commonRefreshJobValue(contentJobs, "intervalMinutes") || contentJobs[0]?.intervalMinutes || 60;
  const latestRunAt = contentJobs
    .map((job) => job.lastRunAt || "")
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0] || "";
  const failedCount = contentJobs.filter((job) => job.status === "failed" || job.status === "unreachable").length;
  const running = contentJobs.some((job) => job.running);
  const sourceCounts = new Map();
  for (const job of contentJobs) {
    const source = sourceTypeForSubscription(job);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }
  const sourceSummary = [...sourceCounts.entries()]
    .map(([source, count]) => `${subscriptionSourceLabel(source)} ${count}`)
    .join(" · ");

  refreshJobs.innerHTML = `
    <section class="refresh-job content-refresh-group" data-content-page-group="1">
      <div class="refresh-job-title">
        <label class="inline-toggle">
          <input data-field="enabled" type="checkbox" ${enabledCount ? "checked" : ""} />
          <strong>普通页面整体刷新</strong>
        </label>
        <div class="refresh-job-actions">
          <button type="button" data-run-content-pages ${running ? "disabled" : ""}>${running ? "运行中" : "立即刷新"}</button>
        </div>
      </div>
      <div class="settings-grid">
        <label>
          刷新间隔分钟
          <input data-field="intervalMinutes" type="number" min="5" value="${escapeHtml(intervalMinutes)}" />
        </label>
        <label>
          页面数量
          <input value="${escapeHtml(contentJobs.length)}" disabled />
        </label>
      </div>
      <div class="item-meta">
        已启用：${escapeHtml(String(enabledCount))} / ${escapeHtml(String(contentJobs.length))} · 上次刷新：${escapeHtml(latestRunAt ? formatDate(latestRunAt) : "未刷新")}
      </div>
      ${sourceSummary ? `<div class="item-meta">${escapeHtml(sourceSummary)}</div>` : ""}
      ${failedCount ? `<div class="item-meta">失败：${escapeHtml(String(failedCount))} 个页面</div>` : ""}
    </section>
  `;

  refreshJobs.querySelector("[data-run-content-pages]")?.addEventListener("click", () => runAllRefreshJobs());
}

function commonRefreshJobValue(jobs, field) {
  if (!jobs.length) return "";
  const [first] = jobs;
  return jobs.every((job) => String(job[field] || "") === String(first[field] || "")) ? first[field] : "";
}

function renderSubscriptionTabs() {
  const counts = new Map([["all", state.refreshJobs.length]]);
  const contentCount = state.refreshJobs.filter(isManagedContentPageJob).length;
  if (contentCount) counts.set("content", contentCount);
  for (const job of state.refreshJobs) {
    const sourceType = sourceTypeForSubscription(job);
    counts.set(sourceType, (counts.get(sourceType) || 0) + 1);
  }
  const sources = ["all", "content", "jira", "github", "teams", "confluence", "web"];
  const visibleSources = sources.filter((source) => source === "all" || counts.has(source));
  if (!visibleSources.includes(state.subscriptionSource)) {
    state.subscriptionSource = "all";
  }
  subscriptionTabs.innerHTML = visibleSources.map((source) => `
    <button
      type="button"
      role="tab"
      class="subscription-tab ${state.subscriptionSource === source ? "is-active" : ""}"
      aria-selected="${state.subscriptionSource === source ? "true" : "false"}"
      data-subscription-source="${escapeHtml(source)}"
    >
      ${escapeHtml(subscriptionSourceLabel(source))} ${escapeHtml(String(counts.get(source) || 0))}
    </button>
  `).join("");
  subscriptionTabs.querySelectorAll("[data-subscription-source]").forEach((button) => {
    button.addEventListener("click", () => {
      syncRefreshJobsFromDom();
      state.subscriptionSource = button.dataset.subscriptionSource;
      renderRefreshJobs(state.refreshJobs);
    });
  });
}

function sourceTypeForSubscription(job) {
  const url = String(job.url || "").toLowerCase();
  if (url.includes("jira") || url.includes("atlassian.net")) return "jira";
  if (url.includes("github")) return "github";
  if (url.includes("teams.microsoft") || url.includes("teams.cloud.microsoft")) return "teams";
  if (url.includes("confluence")) return "confluence";
  return "web";
}

function refreshJobTagsText(tags) {
  return Array.isArray(tags) ? tags.join(", ") : String(tags || "");
}

function refreshJobsForCurrentTab() {
  if (state.subscriptionSource === "content") {
    return state.refreshJobs.filter(isManagedContentPageJob);
  }
  if (state.subscriptionSource === "all") {
    return state.refreshJobs;
  }
  return state.refreshJobs.filter((job) => (
    sourceTypeForSubscription(job) === state.subscriptionSource
  ));
}

function isManagedContentPageJob(job) {
  return job?.managedBy === "content-page";
}

function subscriptionSourceLabel(source) {
  return {
    all: "全部",
    content: "普通页面",
    confluence: "Confluence",
    jira: "Jira",
    github: "GitHub",
    teams: "Teams",
    web: "网页"
  }[source] || source;
}

function formatRefreshStatus(status) {
  return {
    idle: "空闲",
    running: "运行中",
    failed: "失败",
    unreachable: "网络不可达",
    canceled: "已取消"
  }[status] || status;
}

function collectRefreshJobs() {
  syncRefreshJobsFromDom();
  return state.refreshJobs.map((job) => ({
    ...job,
    tags: job.tags || []
  }));
}

function syncRefreshJobsFromDom() {
  const contentGroup = refreshJobs.querySelector("[data-content-page-group]");
  if (contentGroup) {
    const valueOf = (field) => contentGroup.querySelector(`[data-field="${field}"]`);
    const enabled = Boolean(valueOf("enabled")?.checked);
    const intervalMinutes = Number(valueOf("intervalMinutes")?.value || 60);
    state.refreshJobs = state.refreshJobs.map((job) => isManagedContentPageJob(job)
      ? {
          ...job,
          enabled,
          intervalMinutes,
          maxItems: 1,
          pageKind: "content",
          managedBy: "content-page"
        }
      : job);
  }

  const visible = [...refreshJobs.querySelectorAll(".refresh-job")].map((section) => {
    if (section.dataset.contentPageGroup) return null;
    const valueOf = (field) => section.querySelector(`[data-field="${field}"]`);
    return {
      id: section.dataset.id,
      name: section.querySelector("strong")?.textContent || section.dataset.id,
      url: valueOf("url")?.value || "",
      enabled: Boolean(valueOf("enabled")?.checked),
      intervalMinutes: Number(valueOf("intervalMinutes")?.value || 60),
      maxItems: Number(valueOf("maxItems")?.value || 50),
      tags: valueOf("tags")?.value || "",
      fetchMode: valueOf("fetchMode")?.value || "auto",
      pageKind: valueOf("pageKind")?.value || "list"
    };
  }).filter(Boolean);
  if (!visible.length) return;
  const byId = new Map(visible.map((job) => [job.id, job]));
  state.refreshJobs = state.refreshJobs.map((job) => byId.has(job.id) ? { ...job, ...byId.get(job.id) } : job);
}

async function saveSubscriptions() {
  saveSubscriptionsButton.disabled = true;
  runAllSubscriptionsButton.disabled = true;
  refreshJobStatus.textContent = "正在保存订阅设置...";
  try {
    const { settings } = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        refreshJobs: collectRefreshJobs()
      })
    });
    renderRefreshJobs(settings.refreshJobs || []);
    refreshJobStatus.textContent = "订阅设置已保存。";
  } catch (error) {
    refreshJobStatus.textContent = error.message;
  } finally {
    saveSubscriptionsButton.disabled = false;
    runAllSubscriptionsButton.disabled = false;
  }
}

async function runRefreshJob(id) {
  syncRefreshJobsFromDom();
  const job = state.refreshJobs.find((candidate) => candidate.id === id);
  refreshJobStatus.textContent = "正在启动刷新任务...";
  try {
    const { run, jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}/run?background=1`, { method: "POST" });
    renderRefreshJobs(jobs || state.refreshJobs);
    await monitorSubscriptionRefreshRun(run, `正在刷新 ${job?.name || id}`);
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  }
}

async function runAllRefreshJobs() {
  syncRefreshJobsFromDom();
  const jobsToRun = refreshJobsForCurrentTab();

  runAllSubscriptionsButton.disabled = true;
  saveSubscriptionsButton.disabled = true;
  try {
    const sourceLabel = subscriptionSourceLabel(state.subscriptionSource);
    refreshJobStatus.textContent = jobsToRun.length
      ? `正在启动 ${sourceLabel} ${jobsToRun.length} 个任务...`
      : `当前分类下没有可刷新的任务。`;
    if (!jobsToRun.length) return;
    const { run, jobs } = await api("/api/refresh-jobs/run-batch?background=1", {
      method: "POST",
      body: JSON.stringify({
        ids: jobsToRun.map((job) => job.id),
        sourceType: state.subscriptionSource,
        background: true
      })
    });
    renderRefreshJobs(jobs || state.refreshJobs);
    await monitorSubscriptionRefreshRun(run, `正在刷新 ${sourceLabel}`);
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  } finally {
    runAllSubscriptionsButton.disabled = false;
    saveSubscriptionsButton.disabled = false;
  }
}

async function monitorSubscriptionRefreshRun(run, initialMessage = "刷新中") {
  if (!run?.id) throw new Error("刷新任务启动失败：没有返回 runId。");
  stopActiveRefreshRunPolling();
  state.activeRefreshRun.id = run.id;
  state.activeRefreshRun.scope = "subscriptions";
  refreshJobStatus.textContent = `${initialMessage}：0 / ${run.totalJobs || 0}`;
  const timeoutAt = Date.now() + 10 * 60 * 1000;
  let pollErrors = 0;
  return new Promise((resolve) => {
    state.activeRefreshRun.pollTimer = setInterval(async () => {
      try {
        const { run: latest } = await api(`/api/refresh-runs/${encodeURIComponent(run.id)}`);
        if (!latest) return;
        pollErrors = 0;
        state.refreshJobs = latest.jobs || state.refreshJobs;
        renderRefreshJobs(state.refreshJobs);
        const completed = Number(latest.completedJobs || 0);
        const total = Number(latest.totalJobs || 0);
        const failed = Number(latest.failedJobs || 0);
        refreshJobStatus.textContent = `${runStatusText(latest)}：${completed} / ${total}${failed ? `，失败 ${failed}` : ""}`;
        if (["completed", "failed", "canceled"].includes(latest.status)) {
          stopActiveRefreshRunPolling();
          const result = latest.result || {};
          const updated = Number(result.updatedItemCount ?? result.updatedIssueCount ?? 0);
          const newCount = Number(result.newItemCount || 0);
          const aiFailed = Number(result.aiProcessErrorCount || 0);
          const totalItems = Number(result.linkCount ?? result.issueCount ?? 0);
          const skipped = Number(result.skippedItemCount || 0);
          const errorCount = Number(result.errorCount || failed || 0);
          refreshJobStatus.textContent = `${latest.status === "completed" ? "刷新完成" : latest.status === "canceled" ? "刷新已取消" : "刷新结束，有失败"}：更新 ${updated} / ${totalItems} 个内容页，AI 已整理 ${newCount} 个，AI 失败 ${aiFailed} 个，跳过 ${skipped} 个，失败 ${errorCount} 个。`;
          if (state.view === "materials") await loadAll();
          await loadMaterialUpdateCount();
          scheduleReloadAfterRefreshUpdates(newCount);
          resolve(latest);
        } else if (Date.now() > timeoutAt) {
          stopActiveRefreshRunPolling();
          refreshJobStatus.textContent = "刷新仍在后台运行，已停止前台等待；稍后会自动同步状态。";
          resolve(latest);
        }
      } catch (error) {
        pollErrors += 1;
        refreshJobStatus.textContent = `刷新进度同步失败：${error.message}`;
        console.warn("Failed to poll refresh run:", error);
        if (pollErrors >= 5) {
          stopActiveRefreshRunPolling();
          refreshJobStatus.textContent = "刷新进度同步连续失败，已恢复按钮；后台任务可能仍在运行。";
          resolve(null);
        }
      }
    }, 1000);
  });
}

function stopActiveRefreshRunPolling() {
  if (state.activeRefreshRun.pollTimer) clearInterval(state.activeRefreshRun.pollTimer);
  state.activeRefreshRun.pollTimer = null;
  state.activeRefreshRun.id = "";
  state.activeRefreshRun.scope = "";
}

function scheduleReloadAfterRefreshUpdates(updatedCount) {
  if (!updatedCount) return;
  clearTimeout(state.refreshReloadTimer);
  refreshJobStatus.textContent = `${refreshJobStatus.textContent} AI 整理已完成，页面将在 1.2 秒后刷新以显示 NEW 状态。`;
  state.refreshReloadTimer = setTimeout(() => {
    window.location.reload();
  }, 1200);
}

function startRefreshJobMonitor() {
  if (state.refreshMonitorTimer) clearInterval(state.refreshMonitorTimer);
  state.refreshMonitorTimer = setInterval(checkRefreshJobsForUpdates, 60 * 1000);
}

async function checkRefreshJobsForUpdates() {
  try {
    const { jobs } = await api("/api/refresh-jobs");
    state.refreshJobs = jobs || state.refreshJobs;
    renderHomeOverview();
    if (state.view === "subscriptions") renderRefreshJobs(state.refreshJobs);
    const latest = latestUpdatedRefreshRun(jobs || []);
    if (!latest || latest.key <= state.seenRefreshRunKey) return;
    const updated = refreshResultUpdatedCount(latest.job.lastResult);
    if (!updated) return;
    rememberRefreshRunKey(latest.key);
    schedulePageReloadForBackgroundRefresh(updated);
  } catch (error) {
    console.warn("Failed to check refresh jobs:", error);
  }
}

function rememberLatestRefreshRun(jobs) {
  const latest = latestUpdatedRefreshRun(jobs || []);
  if (!latest || latest.key <= state.seenRefreshRunKey) return;
  rememberRefreshRunKey(latest.key);
}

function rememberRefreshRunKey(key) {
  state.seenRefreshRunKey = key;
  localStorage.setItem("materialOrganizer.seenRefreshRunKey", key);
}

function latestUpdatedRefreshRun(jobs) {
  return (jobs || [])
    .filter((job) => job.lastRunAt && refreshResultUpdatedCount(job.lastResult) > 0)
    .map((job) => ({
      job,
      key: `${job.lastRunAt}|${job.id}`
    }))
    .sort((a, b) => b.key.localeCompare(a.key))[0] || null;
}

function refreshResultUpdatedCount(result) {
  if (Object.prototype.hasOwnProperty.call(result || {}, "newItemCount")) {
    return Number(result?.newItemCount || 0);
  }
  return Number(result?.updatedItemCount ?? result?.updatedIssueCount ?? 0);
}

function schedulePageReloadForBackgroundRefresh(updatedCount) {
  if (!updatedCount) return;
  clearTimeout(state.refreshReloadTimer);
  state.refreshReloadTimer = setTimeout(() => {
    window.location.reload();
  }, 1200);
}

async function deleteRefreshJob(id) {
  syncRefreshJobsFromDom();
  const section = refreshJobs.querySelector(`.refresh-job[data-id="${CSS.escape(id)}"]`);
  const name = section?.querySelector("strong")?.textContent || id;
  const ok = confirm(`删除自动刷新任务“${name}”？这不会删除已经导入的资料。`);
  if (!ok) return;

  refreshJobStatus.textContent = "正在删除自动刷新任务...";
  try {
    const { jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    renderRefreshJobs(jobs || []);
    refreshJobStatus.textContent = "自动刷新任务已删除。";
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  }
}

async function clearRefreshJobItems(id) {
  syncRefreshJobsFromDom();
  const section = refreshJobs.querySelector(`.refresh-job[data-id="${CSS.escape(id)}"]`);
  const name = section?.querySelector("strong")?.textContent || id;
  const ok = confirm(`清空订阅“${name}”已经抓取的内容？订阅设置会保留，下次刷新会重新抓取。`);
  if (!ok) return;

  refreshJobStatus.textContent = "正在清空订阅抓取内容...";
  try {
    const { result, jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}/items`, { method: "DELETE" });
    renderRefreshJobs(jobs || []);
    refreshJobStatus.textContent = `已清空 ${result.deletedItemCount || 0} 条订阅抓取内容。`;
    if (state.view === "materials") {
      await loadAll();
    }
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  }
}

async function copyPreview() {
  const text = previewContent.value.trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  previewStatus.textContent = "预览内容已复制。";
}

function handleDragOver(event) {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
}

function handleDragLeave() {
  dropZone.classList.remove("is-dragging");
}

async function handleDrop(event) {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  const file = event.dataTransfer.files?.[0];
  if (!file) return;

  importContent.value = await file.text();
  if (!confirmTitle.value) {
    confirmTitle.value = file.name.replace(/\.[^.]+$/, "");
  }
  await previewImport();
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

async function streamApi(path, body, handlers) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "流式请求失败");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n+/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const event = parseSseEvent(part);
      if (!event) continue;
      handlers[event.event]?.(event.data);
    }
  }

  if (buffer.trim()) {
    const event = parseSseEvent(buffer);
    if (event) handlers[event.event]?.(event.data);
  }
}

function parseSseEvent(block) {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) return null;
  return { event, data: JSON.parse(data) };
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function formatDate(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(markdown) {
  if (window.marked && window.DOMPurify) {
    window.marked.setOptions({
      breaks: false,
      gfm: true
    });
    const rawHtml = window.marked.parse(String(markdown || ""));
    return addSafeLinkAttributes(window.DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["target", "rel"]
    }));
  }
  return renderMarkdownFallback(markdown);
}

function renderMarkdownFallback(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let table = [];
  let code = [];
  let inCode = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };
  const flushTable = () => {
    if (!table.length) return;
    blocks.push(renderMarkdownTable(table));
    table = [];
  };
  const flushCode = () => {
    blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    code = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      flushParagraph();
      flushTable();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }

    if (/^\s*\|.+\|\s*$/.test(line)) {
      flushParagraph();
      flushList();
      table.push(line);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(line.trim());
  }

  if (inCode) flushCode();
  flushAll();
  return blocks.join("");
}

function addSafeLinkAttributes(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!sanitizeMarkdownHref(href)) {
      link.replaceWith(document.createTextNode(link.textContent || ""));
      return;
    }
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer");
  });
  return template.innerHTML;
}

function renderInlineMarkdown(value) {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const safeHref = sanitizeMarkdownHref(href);
    return safeHref ? `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  return text;
}

function renderMarkdownTable(rows) {
  const parsed = rows
    .map((row) => row.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
  if (parsed.length < 2 || !parsed[1].every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return `<p>${rows.map((row) => renderInlineMarkdown(row)).join("<br>")}</p>`;
  }
  const headers = parsed[0];
  const bodyRows = parsed.slice(2);
  return [
    "<table>",
    `<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>`,
    `<tbody>${bodyRows.map((row) => `<tr>${headers.map((_, index) => `<td>${renderInlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table>"
  ].join("");
}

function sanitizeMarkdownHref(href) {
  const value = String(href || "").trim();
  if (/^(https?:|mailto:)/i.test(value) || value.startsWith("/")) return value;
  return "";
}
