// ---------------------------------------------------------------------------
// Reader: original first when the organized version is out of date, newest first
// ---------------------------------------------------------------------------

function linkifyEscaped(text) {
  return text.replace(/(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]，。；：！？）])/g, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function renderMessageText(text) {
  const lines = String(text || "").split("\n");
  const html = [];
  let quote = [];
  const flushQuote = () => {
    if (quote.length) html.push(`<blockquote>${quote.map((line) => linkifyEscaped(escapeHtml(line))).join("<br>")}</blockquote>`);
    quote = [];
  };
  let paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${paragraph.map((line) => linkifyEscaped(escapeHtml(line))).join("<br>")}</p>`);
    paragraph = [];
  };
  for (const line of lines) {
    if (/^>\s?/.test(line)) { flushParagraph(); quote.push(line.replace(/^>\s?/, "")); continue; }
    flushQuote();
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line);
  }
  flushParagraph();
  flushQuote();
  return html.join("");
}

function renderMessageBody(text) {
  return String(text || "").split("```").map((part, index) => index % 2
    ? `<pre class="msg-code"><code>${escapeHtml(part.replace(/^\n+|\n+$/g, ""))}</code></pre>`
    : renderMessageText(part)).join("") || `<p class="muted">（空消息）</p>`;
}

function messageDayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const bucket = dayBucket(value);
  const label = date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  return bucket === "今天" || bucket === "昨天" ? `${bucket} · ${label}` : label;
}

function renderMessageTimeline(comments, { since = "", limit = 150, kind = "消息" } = {}) {
  const sorted = [...comments].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const shown = sorted.slice(0, limit);
  let currentDay = "";
  const rows = [];
  for (const comment of shown) {
    const day = messageDayLabel(comment.createdAt);
    if (day !== currentDay) {
      currentDay = day;
      rows.push(`<h3 class="msg-day">${escapeHtml(day)}</h3>`);
    }
    const isNew = since && String(comment.createdAt || "") > since;
    const time = comment.createdAt && !Number.isNaN(new Date(comment.createdAt).getTime())
      ? new Date(comment.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
    rows.push(`
      <article class="msg ${isNew ? "is-new" : ""} ${comment.author ? "" : "is-system"}" data-message-id="${escapeHtml(comment.id || "")}">
        <header>
          <strong>${escapeHtml(comment.author || "系统")}</strong>
          ${time ? `<time datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(time)}</time>` : ""}
          ${isNew ? `<span class="flag" data-tone="accent">新</span>` : ""}
        </header>
        <div class="msg-body">${renderMessageBody(comment.body)}</div>
      </article>`);
  }
  if (sorted.length > shown.length) {
    rows.push(`<button type="button" class="load-more-button" data-more-messages>显示更早的 ${Math.min(300, sorted.length - shown.length)} 条${kind}（还有 ${sorted.length - shown.length} 条）</button>`);
  }
  return rows.join("");
}

// The stored original starts with a title and capture metadata that the reader
// header already shows; drop that preamble and a leading "## Content" heading.
function cleanRawBody(markdown, title = "") {
  const lines = String(markdown || "").split("\n");
  let index = 0;
  const skip = (line) => !line.trim()
    || (line.startsWith("# ") && (!title || line.slice(2).trim() === String(title).trim()))
    || /^(Source|Adapter|Page ID|Space|Version|Labels|Source updated|Messages captured|Latest message|URL|Fetched|Captured)\s*:/i.test(line)
    || /^##\s+Content\s*$/i.test(line);
  while (index < lines.length && index < 20 && skip(lines[index])) index += 1;
  return lines.slice(index).join("\n").trim() || String(markdown || "");
}

function stripCommentSections(markdown) {
  return String(markdown || "").replace(/\n##\s+(Comments|Messages|评论)\s*\n[\s\S]*$/i, "").trim();
}

function renderDetail(item) {
  const metadata = item.metadata;
  const comments = Array.isArray(item.comments) ? item.comments : [];
  const source = normalizeSourceType(metadata.sourceType);
  const isStream = source === "teams";
  const hasProcessed = Boolean(item.processedDocument?.trim());
  const stale = Boolean(metadata.processedStale);
  const quarantined = metadata.integrityStatus === "quarantined";
  if (state.detailModeFor.id !== metadata.id) state.detailModeFor = { id: metadata.id, mode: "", limit: state.readerMessageLimit };
  const preferred = hasProcessed && !stale && state.detailMode !== "raw" ? "processed" : "raw";
  const mode = state.detailModeFor.mode || preferred;
  const unread = isNewContentItem(metadata);
  const since = unread ? metadata.updateAcknowledgedAt || "" : "";
  const newSinceRead = since ? comments.filter((comment) => String(comment.createdAt || "") > since).length : 0;
  const throughAt = metadata.processedThroughAt || metadata.processedAt || "";
  const newSinceProcessed = throughAt ? comments.filter((comment) => String(comment.createdAt || "") > throughAt).length : 0;
  const rawLabel = isStream ? "消息" : "原文";
  const processLabel = !hasProcessed ? "生成整理" : stale ? "更新整理" : "重新整理";
  const tags = metadata.tags || [];

  const banners = [];
  if (quarantined) banners.push(`<div class="banner" data-tone="error"><p><strong>已隔离：</strong>${escapeHtml(metadata.integrityReason || "来源校验未通过")}。在验证通过前不会进入问答和批量处理。</p></div>`);
  if (metadata.listMembership?.status === "left") banners.push(`<div class="banner" data-tone="warn"><p>这条已不在订阅的过滤结果中${metadata.listMembership.leftAt ? `（${escapeHtml(relativeTime(metadata.listMembership.leftAt))}移出）` : ""}，不再自动更新。</p><button type="button" data-left-keep="${escapeHtml(metadata.id)}">保留</button><button type="button" class="quiet-button danger-text" data-left-delete="${escapeHtml(metadata.id)}">删除</button></div>`);
  if (unread) banners.push(`<div class="banner" data-tone="accent"><p>有新内容${newSinceRead ? `：上次阅读后新增 ${newSinceRead} 条${isStream ? "消息" : "评论"}，已标“新”` : `，${escapeHtml(relativeTime(metadata.contentUpdatedAt || metadata.pendingContentUpdatedAt))}更新`}。</p><button id="acknowledgeUpdateButton" type="button">标为已读</button></div>`);
  if (hasProcessed && stale && mode === "raw") {
    banners.push(`<div class="banner"><p>整理版生成于 ${escapeHtml(formatDate(metadata.processedAt))}${isStream && newSinceProcessed ? `，之后又有 ${newSinceProcessed} 条消息` : "，之后原文有变化"}，所以这里先显示${rawLabel}。</p><button type="button" data-banner-process>${escapeHtml(processLabel)}</button><button type="button" class="quiet-button" data-show-mode="processed">看旧整理版</button></div>`);
  }
  if (hasProcessed && stale && mode === "processed") {
    banners.push(`<div class="banner"><p>这是 ${escapeHtml(formatDate(metadata.processedAt))} 的整理版，之后${isStream && newSinceProcessed ? `新增了 ${newSinceProcessed} 条消息` : "原文有变化"}。</p><button type="button" data-banner-process>${escapeHtml(processLabel)}</button><button type="button" class="quiet-button" data-show-mode="raw">看${rawLabel}</button></div>`);
  }
  const coverage = coverageNote(metadata);

  let body;
  if (mode === "processed" && hasProcessed) {
    body = `
      <div id="detailContentLayout" class="detail-content-layout">
        <div id="detailTocWrap" class="detail-toc-wrap" hidden>
          <button id="detailTocToggle" type="button" class="detail-toc-toggle" aria-expanded="false">目录</button>
          <aside id="detailToc" class="detail-toc" hidden><div class="detail-toc-title">目录</div><nav id="detailTocList" class="detail-toc-list" aria-label="内容目录"></nav></aside>
        </div>
        <div id="detailDoc" class="detail-doc markdown-body">${renderMarkdown(extractMarkdownSection(item.processedDocument || "", "## AI Organized Content"))}</div>
      </div>`;
  } else if (isStream) {
    body = `<div class="msg-summary">${comments.length} 条消息，最新的在最上面${metadata.coverage?.gap ? `；<span class="warn-text">中间可能缺少部分历史</span>` : ""}</div>
      <div id="detailDoc" class="timeline">${renderMessageTimeline(comments, { since, limit: state.detailModeFor.limit || state.readerMessageLimit })}</div>`;
  } else {
    const rawDocument = cleanRawBody(extractMarkdownSection(item.document, "## Content"), metadata.title);
    const main = comments.length ? stripCommentSections(rawDocument) : rawDocument;
    body = `<div id="detailDoc" class="detail-doc markdown-body">${renderMarkdown(main)}</div>
      ${comments.length ? `<section class="comments-block"><h2>评论 <span class="count">${comments.length}</span><small>最新的在最上面</small></h2><div class="timeline">${renderMessageTimeline(comments, { since, limit: state.detailModeFor.limit || state.readerMessageLimit, kind: "评论" })}</div></section>` : ""}`;
  }

  detailPanel.innerHTML = `
    <header class="reader-head">
      <div class="reader-source">
        ${sourceMark(source)}<span>${escapeHtml(sourceLabel(source))}</span>
        ${metadata.url ? `<a href="${escapeHtml(metadata.url)}" target="_blank" rel="noopener noreferrer">打开原页面</a>` : ""}
      </div>
      <div class="reader-title-row">
        <input id="detailTitleInput" class="reader-title" value="${escapeHtml(metadata.title)}" aria-label="标题" />
        <button id="saveTitleButton" type="button" class="primary-button" hidden>保存标题</button>
      </div>
      <dl class="reader-meta">
        <div><dt>更新</dt><dd>${escapeHtml(relativeTime(itemActivityTime(metadata)))}</dd></div>
        ${metadata.lastFetchedAt ? `<div><dt>抓取</dt><dd>${escapeHtml(relativeTime(metadata.lastFetchedAt))}${metadata.captureMethod ? `（${escapeHtml(captureMethodLabel(metadata.captureMethod))}）` : ""}</dd></div>` : ""}
        <div><dt>整理</dt><dd>${hasProcessed ? `${escapeHtml(relativeTime(metadata.processedAt))}${stale ? `<span class="flag">待更新</span>` : ""}` : "还没有整理"}</dd></div>
        <div class="reader-tags"><dt>标签</dt><dd>${tags.length ? tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") : `<span class="muted">无</span>`}<button id="editTagsButton" type="button" class="quiet-button">编辑</button></dd></div>
      </dl>
      <div class="reader-toolbar">
        <div class="segmented" role="tablist" aria-label="显示内容">
          <button id="showRawButton" type="button" role="tab" aria-selected="${mode === "raw"}" class="${mode === "raw" ? "is-active" : ""}">${rawLabel}</button>
          <button id="showProcessedButton" type="button" role="tab" aria-selected="${mode === "processed"}" class="${mode === "processed" ? "is-active" : ""}" ${hasProcessed ? "" : "disabled"}>整理版${hasProcessed && stale ? `<span class="tab-flag">待更新</span>` : ""}</button>
        </div>
        <div class="toolbar-spacer"></div>
        ${metadata.url ? `<button id="refreshButton" type="button">检查更新</button>` : ""}
        ${mode === "processed" && hasProcessed ? `<button id="exportItemButton" type="button" class="quiet-button">导出 Markdown</button>` : ""}
        <button id="processItemButton" type="button" ${quarantined ? "disabled" : ""}>${escapeHtml(processLabel)}</button>
        <details class="menu">
          <summary class="icon-button" aria-label="更多操作">⋯</summary>
          <div class="menu-panel">
            <button id="diffItemButton" type="button">对比上次的变化</button>
            ${hasProcessed ? `<button id="exportItemMenuButton" type="button">把整理版导出为 Markdown</button>` : ""}
            <button id="generateTitleButton" type="button" ${quarantined ? "disabled" : ""}>用 AI 生成标题</button>
            ${hasProcessed ? `<button id="fullProcessButton" type="button" ${quarantined ? "disabled" : ""}>完整重新整理</button>` : ""}
            <button id="deleteItemButton" type="button" class="danger-button">删除这条资料</button>
          </div>
        </details>
      </div>
    </header>
    <div class="reader-banners">${banners.join("")}${coverage}</div>
    <section id="detailDiff" class="detail-diff" hidden></section>
    <div class="reader-body">${body}</div>
  `;
  if (mode === "processed") setupDetailToc();
  bindReaderEvents(item, { mode });
}

function bindReaderEvents(item, { mode }) {
  const metadata = item.metadata;
  const setMode = (next) => {
    state.detailModeFor = { ...state.detailModeFor, id: metadata.id, mode: next };
    state.detailMode = next;
    localStorage.setItem("materialOrganizer.detailMode", next);
    renderDetail(item);
  };
  document.querySelector("#showRawButton")?.addEventListener("click", () => setMode("raw"));
  document.querySelector("#showProcessedButton")?.addEventListener("click", () => setMode("processed"));
  detailPanel.querySelectorAll("[data-show-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.showMode)));
  detailPanel.querySelector("[data-left-keep]")?.addEventListener("click", () => resolveLeftListItems([metadata.id], "keep"));
  detailPanel.querySelector("[data-left-delete]")?.addEventListener("click", () => resolveLeftListItems([metadata.id], "delete"));
  detailPanel.querySelector("[data-more-messages]")?.addEventListener("click", () => {
    state.detailModeFor.limit = (state.detailModeFor.limit || state.readerMessageLimit) + 300;
    renderDetail(item);
  });

  const titleInput = document.querySelector("#detailTitleInput");
  const saveTitleButton = document.querySelector("#saveTitleButton");
  titleInput?.addEventListener("input", () => { saveTitleButton.hidden = titleInput.value.trim() === metadata.title; });
  titleInput?.addEventListener("keydown", (event) => { if (event.key === "Enter") saveTitleButton.click(); });
  saveTitleButton?.addEventListener("click", async () => {
    saveTitleButton.disabled = true;
    try {
      const { item: next } = await api(`/api/items/${encodeURIComponent(metadata.id)}/title`, { method: "PATCH", body: JSON.stringify({ title: titleInput.value }) });
      notify("标题已保存", next.metadata.title);
      renderDetail(next);
      await loadItems();
    } catch (error) {
      notify("没能保存标题", error.message, "error");
      saveTitleButton.disabled = false;
    }
  });

  document.querySelector("#acknowledgeUpdateButton")?.addEventListener("click", async () => {
    const next = await acknowledgeSelectedItemUpdate(metadata.id);
    if (state.selectedId === metadata.id) renderDetail(next || item);
  });

  const runProcess = async (button, full = false) => {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "整理中……";
    try {
      const { item: next } = await api(`/api/items/${encodeURIComponent(metadata.id)}/process`, { method: "POST", body: JSON.stringify({ full }) });
      state.detailModeFor = { id: metadata.id, mode: "processed", limit: state.readerMessageLimit };
      renderDetail(next);
      await loadLibraryIndex();
      await loadItems();
      notify(next.metadata.processedMode === "incremental" ? "已把新增内容合并进整理版" : "整理版已更新", next.metadata.title);
    } catch (error) {
      notify("整理没有完成", error.message, "error");
      button.disabled = false;
      button.textContent = original;
    }
  };
  document.querySelector("#processItemButton")?.addEventListener("click", (event) => runProcess(event.currentTarget));
  detailPanel.querySelectorAll("[data-banner-process]").forEach((button) => button.addEventListener("click", () => runProcess(button)));
  detailPanel.querySelectorAll("#exportItemButton, #exportItemMenuButton").forEach((button) => button.addEventListener("click", () => {
    button.closest("details")?.removeAttribute("open");
    exportMarkdown(`/api/items/${encodeURIComponent(metadata.id)}/export.md`, `${metadata.title || "整理"}.md`);
  }));
  document.querySelector("#fullProcessButton")?.addEventListener("click", (event) => runProcess(event.currentTarget, true));

  document.querySelector("#generateTitleButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { item: next } = await api(`/api/items/${encodeURIComponent(metadata.id)}/recommend-title`, { method: "POST" });
      renderDetail(next);
      await loadItems();
    } catch (error) {
      notify("没能生成标题", error.message, "error");
      button.disabled = false;
    }
  });
  document.querySelector("#editTagsButton")?.addEventListener("click", () => openTagDialog(item));
  document.querySelector("#refreshButton")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "检查中……";
    try {
      const payload = await api(`/api/items/${encodeURIComponent(metadata.id)}/refresh`, { method: "POST" });
      if (payload.run) await monitorSubscriptionRefreshRun(payload.run, `正在检查 ${metadata.title}`);
      await loadLibraryIndex();
      await loadItems();
      await selectItem(metadata.id);
    } catch (error) {
      notify("检查更新失败", error.message, "error");
      button.disabled = false;
      button.textContent = "检查更新";
    }
  });
  document.querySelector("#diffItemButton")?.addEventListener("click", async () => {
    const panel = document.querySelector("#detailDiff");
    try {
      const { diff } = await api(`/api/items/${encodeURIComponent(metadata.id)}/diff`);
      panel.hidden = false;
      panel.innerHTML = `<div class="detail-diff-header"><strong>和上一个版本相比</strong><span>新增 ${escapeHtml(diff.addedLines)} 行，删除 ${escapeHtml(diff.removedLines)} 行${diff.truncated ? "（已截断）" : ""}</span><button type="button" class="quiet-button" data-close-diff>关闭</button></div><pre>${escapeHtml(diff.text || "没有变化")}</pre>`;
      panel.querySelector("[data-close-diff]").addEventListener("click", () => { panel.hidden = true; });
      panel.scrollIntoView({ block: "nearest" });
    } catch (error) {
      notify("没能读取变化", error.message, "error");
    }
  });
  document.querySelector("#deleteItemButton")?.addEventListener("click", async () => {
    if (!confirm(`删除“${metadata.title}”？正文、原始文件、评论和历史快照都会删除，无法恢复。`)) return;
    try {
      await api(`/api/items/${encodeURIComponent(metadata.id)}`, { method: "DELETE" });
      state.selectedId = null;
      detailPanel.innerHTML = `<div class="empty-state">资料已删除。</div>`;
      await loadAll();
    } catch (error) {
      notify("没能删除", error.message, "error");
    }
  });
}

async function acknowledgeSelectedItemUpdate(id) {
  try {
    const { item } = await api(`/api/items/${encodeURIComponent(id)}/ack-update`, { method: "POST" });
    for (const list of [state.items, state.allItems]) {
      const index = (list || []).findIndex((candidate) => candidate.id === id);
      if (index !== -1) list[index] = { ...list[index], contentUpdatedAt: "", pendingContentUpdatedAt: "", updateAcknowledgedAt: item.metadata.updateAcknowledgedAt || "" };
    }
    state.updateCount = (state.allItems || []).filter(isNewContentItem).length;
    renderItems();
    renderLibraryFacets();
    renderMaterialsNewBadge();
    return item;
  } catch (error) {
    console.warn("Failed to acknowledge item update:", error);
    return null;
  }
}

function notify(title, message = "", tone = "info") {
  showToast({ title, message, duration: tone === "error" ? 14000 : 5000, tone });
}

