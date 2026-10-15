async function sendChatMessage(event) {
  event.preventDefault();
  if (state.chatRequest) return;
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
  const controller = new AbortController();
  const request = { controller, sessionId: session.id, id: `${Date.now()}-${Math.random()}` };
  state.chatRequest = request;
  chatSubmitButton.disabled = true;
  stopChatButton.hidden = false;

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

    const history = session.messages
      .filter((entry) => entry.role === "user" || entry.role === "assistant")
      .slice(-12)
      .map((entry) => ({ role: entry.role, content: entry.text }));
    await streamApi("/api/chat-stream", { message, history }, {
      signal: controller.signal,
      trace: (event) => {
        if (!isCurrentChatRequest(request)) return;
        removePending();
        if (!shouldDisplayTraceEvent(event)) return;
        const traceMessage = toTraceMessage(event);
        session.messages.push(traceMessage);
        if (state.activeChatId === session.id) appendMessage(traceMessage.role, traceMessage.text, traceMessage);
      },
      sources: (event) => {
        if (!isCurrentChatRequest(request)) return;
        latestSources = event.sources || [];
      },
      delta: (event) => {
        if (!isCurrentChatRequest(request)) return;
        removePending();
        if (!assistantMessage) {
          if (state.activeChatId === session.id) assistantMessage = appendMessage("assistant", "");
        }
        assistantText += event.text || "";
        if (assistantMessage) {
          setMessageBody(assistantMessage, "assistant", assistantText);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      },
      done: (answer) => {
        if (!isCurrentChatRequest(request)) return;
        removePending();
        latestSources = answer.sources || latestSources;
        const finalText = formatChatAnswer({ ...answer, sources: latestSources, content: answer.content || assistantText });
        if (!assistantMessage) {
          if (state.activeChatId === session.id) assistantMessage = appendMessage("assistant", finalText, { sources: latestSources });
        } else {
          setMessageBody(assistantMessage, "assistant", finalText);
        }
        attachChatSources(assistantMessage, latestSources);
        session.messages.push({ role: "assistant", text: finalText, sources: latestSources, at: new Date().toISOString() });
      },
      error: (event) => {
        throw new Error(event.error || "流式对话失败");
      }
    });
  } catch (error) {
    if (error.name === "AbortError") {
      session.messages.push({ role: "event", title: "已停止", kind: "error", text: "已停止生成。", at: new Date().toISOString() });
      if (state.activeChatId === session.id) appendMessage("event", "已停止生成。", { title: "已停止", kind: "error" });
    } else {
      const text = error.message;
      if (pending?.isConnected) pending.remove();
      const traceMessage = { role: "event", title: "错误", kind: "error", text, at: new Date().toISOString() };
      session.messages.push(traceMessage);
      if (state.activeChatId === session.id) appendMessage("event", text, traceMessage);
      session.messages.push({ role: "assistant", text, at: new Date().toISOString(), error: true });
      if (state.activeChatId === session.id) appendMessage("assistant", text);
    }
  } finally {
    if (state.chatRequest === request) {
      state.chatRequest = null;
      chatSubmitButton.disabled = false;
      stopChatButton.hidden = true;
    }
  }

  session.updatedAt = new Date().toISOString();
  saveChatSessions();
  renderChatHistory();
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function isCurrentChatRequest(request) {
  return state.chatRequest === request && !request.controller.signal.aborted;
}

function cancelChatRequest() {
  state.chatRequest?.controller.abort();
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
  if (role === "assistant" && meta.sources) attachChatSources(message, meta.sources);
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
  return answer.content;
}

function attachChatSources(message, sources) {
  if (!message || !sources?.length || message.querySelector(".chat-sources")) return;
  const list = document.createElement("div");
  list.className = "chat-sources";
  list.innerHTML = `<strong>参考资料</strong>`;
  sources.slice(0, 5).forEach((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-source-link";
    button.textContent = `${source.title || "未命名资料"} · ${sourceLabel(source.sourceType)}${source.completeness ? ` · ${completenessLabel(source.completeness)}` : ""}`;
    button.addEventListener("click", async () => {
      if (!source.id) return;
      await switchView("materials");
      await selectItem(source.id);
    });
    list.append(button);
  });
  message.append(list);
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

async function loadChatSessions() {
  let remote = null;
  try {
    remote = await api("/api/chat-sessions");
  } catch (error) {
    console.warn("Failed to load server chat sessions:", error);
  }
  const serverSessions = Array.isArray(remote?.sessions) ? remote.sessions.filter((session) => session.id) : [];
  if (remote?.initialized === false && !serverSessions.length) {
    const local = readLocalChatSessions();
    state.chatSessions = local.sessions;
    state.activeChatId = local.activeChatId || local.sessions[0]?.id || "";
    if (state.chatSessions.length) await saveChatSessions();
  } else if (remote) {
    state.chatSessions = serverSessions;
    state.activeChatId = remote.activeChatId || serverSessions[0]?.id || "";
  } else {
    const local = readLocalChatSessions();
    state.chatSessions = local.sessions;
    state.activeChatId = local.activeChatId || local.sessions[0]?.id || "";
    state.chatSessionsLocalOnly = true;
  }
  state.chatSessionsHydrated = true;
  if (!state.chatSessions.length || !getActiveChatSession()) {
    createChatSession({ activate: true, save: false });
  }
  renderChatHistory();
  renderActiveChat();
  if (!state.chatSessionsLocalOnly) await saveChatSessions();
  renderChatSessionStatus();
}

function renderChatSessionStatus() {
  if (!chatSessionStatus) return;
  chatSessionStatus.hidden = !state.chatSessionsLocalOnly;
  chatSessionStatus.textContent = state.chatSessionsLocalOnly
    ? "暂时使用本机会话缓存；无法读取服务端记录，恢复连接后可重新打开以同步。"
    : "";
}

function readLocalChatSessions() {
  let sessions = [];
  try {
    const saved = JSON.parse(localStorage.getItem("materialOrganizer.chatSessions") || "[]");
    sessions = Array.isArray(saved) ? saved.filter((session) => session.id) : [];
  } catch {
    sessions = [];
  }
  return { sessions, activeChatId: localStorage.getItem("materialOrganizer.activeChatId") || "" };
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

async function saveChatSessions() {
  const sessions = state.chatSessions
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 30);
  state.chatSessions = sessions;
  localStorage.setItem("materialOrganizer.chatSessions", JSON.stringify(sessions));
  localStorage.setItem("materialOrganizer.activeChatId", state.activeChatId);
  if (!state.chatSessionsHydrated || state.chatSessionsLocalOnly) return;
  const snapshot = JSON.parse(JSON.stringify({ sessions, activeChatId: state.activeChatId }));
  state.chatPersistQueue = state.chatPersistQueue
    .catch(() => {})
    .then(() => api("/api/chat-sessions", {
      method: "PATCH",
      body: JSON.stringify(snapshot)
    }))
    .catch((error) => {
      console.warn("Failed to save server chat sessions:", error);
    });
  return state.chatPersistQueue;
}

