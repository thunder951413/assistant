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

