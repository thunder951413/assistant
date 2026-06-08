const state = {
  view: "chat",
  items: [],
  tags: [],
  chatSessions: [],
  activeChatId: "",
  importPreview: null,
  tagEditor: {
    item: null,
    selected: [],
    recommended: []
  },
  settingsTags: [],
  selectedSettingsTags: new Set(),
  updateCount: 0,
  updateOnly: false,
  selectedId: null,
  sourceType: "",
  tag: "",
  query: ""
};

const itemList = document.querySelector("#itemList");
const tagList = document.querySelector("#tagList");
const materialSidebar = document.querySelector("#materialSidebar");
const chatView = document.querySelector("#chatView");
const materialsView = document.querySelector("#materialsView");
const importView = document.querySelector("#importView");
const settingsView = document.querySelector("#settingsView");
const detailPanel = document.querySelector("#detailPanel");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const agentRoot = document.querySelector("#agentRoot");
const chatSessionTitle = document.querySelector("#chatSessionTitle");
const chatHistoryList = document.querySelector("#chatHistoryList");
const newChatButton = document.querySelector("#newChatButton");
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
const settingBaseUrl = document.querySelector("#settingBaseUrl");
const settingApiKey = document.querySelector("#settingApiKey");
const settingModel = document.querySelector("#settingModel");
const settingShowThinking = document.querySelector("#settingShowThinking");
const settingShowToolCalls = document.querySelector("#settingShowToolCalls");
const settingDocumentRoot = document.querySelector("#settingDocumentRoot");
const activeDocumentRoot = document.querySelector("#activeDocumentRoot");
const settingsStatus = document.querySelector("#settingsStatus");
const sourceProfiles = document.querySelector("#sourceProfiles");
const webdriverStatus = document.querySelector("#webdriverStatus");
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
const recommendedTagChips = document.querySelector("#recommendedTagChips");
const recommendTagsButton = document.querySelector("#recommendTagsButton");
const tagRecommendStatus = document.querySelector("#tagRecommendStatus");

chatForm.addEventListener("submit", sendChatMessage);
newChatButton.addEventListener("click", () => createChatSession({ activate: true }));
importForm.addEventListener("submit", previewImport);
confirmImportButton.addEventListener("click", confirmImport);
clearImportButton.addEventListener("click", resetImport);
copyPreviewButton.addEventListener("click", copyPreview);
summarizeButton.addEventListener("click", summarizePreview);
settingsForm.addEventListener("submit", saveSettings);
tagDialogForm.addEventListener("submit", saveTagDialog);
closeTagDialogButton.addEventListener("click", closeTagDialog);
cancelTagDialogButton.addEventListener("click", closeTagDialog);
addManualTagButton.addEventListener("click", addManualTag);
recommendTagsButton.addEventListener("click", recommendTagsForCurrentItem);
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

document.querySelectorAll(".source-item").forEach((button) => {
  button.addEventListener("click", async () => {
    document.querySelectorAll(".source-item").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.sourceType = button.dataset.source;
    state.tag = "";
    state.updateOnly = false;
    await loadItems();
    renderTags();
  });
});

searchInput.addEventListener("input", debounce(async () => {
  state.query = searchInput.value.trim();
  await loadItems();
}, 200));

await loadAgentConfig();
await loadSettings();
loadChatSessions();
renderView();

async function loadAll() {
  await Promise.all([loadTags(), loadItems()]);
}

function renderView() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.view === state.view);
  });

  chatView.hidden = state.view !== "chat";
  materialsView.hidden = state.view !== "materials";
  importView.hidden = state.view !== "import";
  settingsView.hidden = state.view !== "settings";
  materialSidebar.hidden = state.view !== "materials";
}

async function switchView(view) {
  state.view = view;
  renderView();
  if (state.view === "materials") {
    await loadAll();
  }
  if (state.view === "settings") {
    await loadSettings();
  }
}

async function loadItems() {
  const params = new URLSearchParams();
  if (state.sourceType) params.set("sourceType", state.sourceType);
  if (state.tag) params.set("tag", state.tag);
  if (state.updateOnly) params.set("updates", "1");
  if (state.query) params.set("q", state.query);

  const { items } = await api(`/api/items?${params}`);
  state.items = items;
  renderItems();
}

async function loadTags() {
  const [{ tags }, updatePayload] = await Promise.all([
    api("/api/tags"),
    api("/api/items?updates=1")
  ]);
  state.tags = tags;
  state.updateCount = updatePayload.items?.length || 0;
  renderTags();
}

function renderItems() {
  resultCount.textContent = `${state.items.length} 条资料`;

  if (!state.items.length) {
    itemList.innerHTML = `<div class="empty-state">还没有符合条件的资料。</div>`;
    return;
  }

  itemList.innerHTML = state.items.map((item) => `
    <button class="item-card ${state.selectedId === item.id ? "is-selected" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="item-card-title">
        <h3>${escapeHtml(item.title)}</h3>
        ${item.contentUpdatedAt ? `<span class="update-badge">内容更新</span>` : ""}
      </div>
      <div class="item-meta">${escapeHtml(item.sourceType)} · ${escapeHtml(formatDate(item.updatedAt))}</div>
      ${item.contentUpdatedAt ? `<div class="item-meta">检测更新：${escapeHtml(formatDate(item.contentUpdatedAt))}</div>` : ""}
      <div class="item-meta">${escapeHtml((item.tags || []).join(", ") || "no tags")}</div>
      <div class="item-excerpt">${escapeHtml(item.excerpt || "")}</div>
    </button>
  `).join("");

  itemList.querySelectorAll(".item-card").forEach((card) => {
    card.addEventListener("click", () => selectItem(card.dataset.id));
  });
}

function renderTags() {
  const allButton = `<button class="tag-chip ${state.tag || state.updateOnly ? "" : "is-active"}" data-tag="">全部</button>`;
  const updateButton = `
    <button class="tag-chip update-chip ${state.updateOnly ? "is-active" : ""}" data-updates="1">
      内容更新 ${state.updateCount}
    </button>
  `;
  const tagButtons = state.tags.map((tag) => `
    <button class="tag-chip ${state.tag === tag.name ? "is-active" : ""}" data-tag="${escapeHtml(tag.name)}">
      ${escapeHtml(tag.name)} ${tag.count}
    </button>
  `).join("");

  tagList.innerHTML = allButton + updateButton + tagButtons;
  tagList.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", async () => {
      state.updateOnly = chip.dataset.updates === "1";
      state.tag = state.updateOnly ? "" : chip.dataset.tag;
      await loadItems();
      renderTags();
    });
  });
}

async function selectItem(id) {
  state.selectedId = id;
  renderItems();
  const { item } = await api(`/api/items/${encodeURIComponent(id)}`);
  renderDetail(item);
}

function renderDetail(item) {
  const metadata = item.metadata;
  detailPanel.innerHTML = `
    <div class="detail-title">
      <div>
        <h2>${escapeHtml(metadata.title)}</h2>
        <div class="item-meta">${escapeHtml(metadata.sourceType)} · ${escapeHtml(metadata.url || "local input")}</div>
      </div>
      <div class="detail-actions">
        <button id="editTagsButton">标签</button>
        <button id="refreshButton">刷新</button>
        <button id="deleteItemButton" class="danger-button">删除</button>
      </div>
    </div>
    <div class="item-meta">标签：${escapeHtml((metadata.tags || []).join(", ") || "no tags")}</div>
    ${metadata.contentUpdatedAt ? `<div class="item-meta">内容更新：${escapeHtml(formatDate(metadata.contentUpdatedAt))}</div>` : ""}
    <hr />
    <div class="detail-doc markdown-body">${renderMarkdown(item.document)}</div>
  `;

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

function openTagDialog(item) {
  state.tagEditor = {
    item,
    selected: [...(item.metadata.tags || [])],
    recommended: []
  };
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

  selectedTagChips.innerHTML = selected.length
    ? selected.map((tag) => `
        <button type="button" class="tag-edit-chip is-selected" data-remove-tag="${escapeHtml(tag)}">
          ${escapeHtml(tag)}
          <span aria-hidden="true">×</span>
        </button>
      `).join("")
    : `<div class="empty-inline">还没有选择标签。</div>`;

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
  settingDocumentRoot.value = settings.documentRoot || "";
  activeDocumentRoot.textContent = settings.activeDocumentRoot || settings.documentRoot || "";
  renderSourceProfiles(settings.sources || {});
  renderRefreshJobs(settings.refreshJobs || []);
  await loadSettingsTags();
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
        assistantMessage.querySelector(".message-body").textContent = assistantText;
        chatMessages.scrollTop = chatMessages.scrollHeight;
      },
      done: (answer) => {
        removePending();
        latestSources = answer.sources || latestSources;
        const finalText = formatChatAnswer({ ...answer, sources: latestSources, content: answer.content || assistantText });
        if (!assistantMessage) {
          assistantMessage = appendMessage("assistant", finalText);
        } else {
          assistantMessage.querySelector(".message-body").textContent = finalText;
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
  message.querySelector(".message-body").textContent = text;
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return message;
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
      ? ` 已加入定时刷新：${preview.refreshJob.name}（默认${preview.refreshJob.enabled ? "开启" : "关闭"}，可在设置页点击立即刷新）。`
      : "";
    previewStatus.textContent = `${preview.parseNote} 内容长度 ${preview.contentLength} 字符。${linkedNote}${refreshJobNote}${duplicateNote}`;
    summaryStatus.textContent = "可以生成 AI 总结，或手动填写总结。";
    previewBadge.textContent = preview.existingItem ? "已存在" : (preview.parseStatus === "ready" ? "可导入" : "需确认");
    confirmImportButton.disabled = !preview.extractedContent.trim() || Boolean(preview.existingItem);
    summarizeButton.disabled = !preview.extractedContent.trim();
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
        documentRoot: settingDocumentRoot.value,
        sources: collectSourceProfiles(),
        refreshJobs: collectRefreshJobs()
      })
    });
    activeDocumentRoot.textContent = settings.activeDocumentRoot;
    settingApiKey.value = settings.ai.apiKey;
    settingShowThinking.checked = settings.chat?.showThinking !== false;
    settingShowToolCalls.checked = settings.chat?.showToolCalls !== false;
    agentRoot.textContent = settings.activeDocumentRoot;
    settingsStatus.textContent = "设置已保存。";
    renderRefreshJobs(settings.refreshJobs || []);
    await loadSettingsTags();
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
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
        <label class="settings-tag-row">
          <input type="checkbox" data-settings-tag="${escapeHtml(tag.name)}" ${state.selectedSettingsTags.has(tag.name) ? "checked" : ""} />
          <span>${escapeHtml(tag.name)}</span>
          <small>${escapeHtml(tag.count)} 条资料</small>
        </label>
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
    "github.ecodesamsung.com": "Samsung GitHub"
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
      profiles[hostname][field.dataset.field] = field.value;
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
  if (!jobs.length) {
    refreshJobs.innerHTML = `<div class="empty-state">还没有刷新任务。</div>`;
    return;
  }

  refreshJobs.innerHTML = jobs.map((job) => `
    <section class="refresh-job" data-id="${escapeHtml(job.id)}">
      <div class="refresh-job-title">
        <label class="inline-toggle">
          <input data-field="enabled" type="checkbox" ${job.enabled ? "checked" : ""} />
          <strong>${escapeHtml(job.name)}</strong>
        </label>
        <button type="button" data-run-job="${escapeHtml(job.id)}">${job.running ? "运行中" : "立即刷新"}</button>
      </div>
      <label>
        Filter URL
        <input data-field="url" value="${escapeHtml(job.url || "")}" />
      </label>
      <div class="settings-grid">
        <label>
          间隔分钟
          <input data-field="intervalMinutes" type="number" min="5" value="${escapeHtml(job.intervalMinutes || 60)}" />
        </label>
        <label>
          最多刷新条数
          <input data-field="maxItems" type="number" min="1" value="${escapeHtml(job.maxItems || 50)}" />
        </label>
      </div>
      <label>
        标签
        <input data-field="tags" value="${escapeHtml((job.tags || []).join(", "))}" />
      </label>
      <div class="item-meta">
        状态：${escapeHtml(job.running ? "running" : job.status || "idle")} · 上次刷新：${escapeHtml(job.lastRunAt ? formatDate(job.lastRunAt) : "未刷新")}
      </div>
      ${job.lastError ? `<div class="item-meta">错误：${escapeHtml(job.lastError)}</div>` : ""}
      ${job.lastResult ? `<div class="item-meta">结果：更新 ${escapeHtml(job.lastResult.updatedItemCount ?? job.lastResult.updatedIssueCount ?? 0)} / ${escapeHtml(job.lastResult.linkCount ?? job.lastResult.issueCount ?? 0)} 个内容页，跳过 ${escapeHtml(job.lastResult.skippedItemCount || 0)} 个</div>` : ""}
      <input data-field="fetchMode" type="hidden" value="${escapeHtml(job.fetchMode || "auto")}" />
      <input data-field="pageKind" type="hidden" value="${escapeHtml(job.pageKind || "list")}" />
    </section>
  `).join("");

  refreshJobs.querySelectorAll("[data-run-job]").forEach((button) => {
    button.addEventListener("click", () => runRefreshJob(button.dataset.runJob));
  });
}

function collectRefreshJobs() {
  return [...refreshJobs.querySelectorAll(".refresh-job")].map((section) => {
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
  });
}

async function runRefreshJob(id) {
  refreshJobStatus.textContent = "正在刷新过滤页和列表中的内容页...";
  try {
    const { result, jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}/run`, { method: "POST" });
    renderRefreshJobs(jobs || []);
    refreshJobStatus.textContent = `刷新完成：更新 ${result.updatedItemCount ?? result.updatedIssueCount ?? 0} / ${result.linkCount ?? result.issueCount ?? 0} 个内容页，跳过 ${result.skippedItemCount || 0} 个，失败 ${result.errorCount} 个。`;
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
