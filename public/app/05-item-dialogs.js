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

async function selectItem(id) {
  state.selectedId = id;
  const requestId = ++state.itemSelectionRequest;
  renderItems();
  detailPanel.innerHTML = `<div class="empty-state">正在打开资料…</div>`;
  try {
    const { item } = await api(`/api/items/${encodeURIComponent(id)}`);
    if (requestId !== state.itemSelectionRequest || state.selectedId !== id) return;
    renderDetail(item);
  } catch (error) {
    if (requestId !== state.itemSelectionRequest || state.selectedId !== id) return;
    detailPanel.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "无法打开资料")}</div>`;
  }
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
    .replace(/[^a-z0-9+\u4e00-\u9fa5-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

