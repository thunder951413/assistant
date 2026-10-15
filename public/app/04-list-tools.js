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
  const contentCandidates = state.items.filter((item) => item.pageKind !== "list" && item.integrityStatus !== "quarantined" && (force || !item.hasProcessed));
  const tagOnlyCandidates = includeTags && tagMode === "batch"
    ? state.items.filter((item) => item.pageKind !== "list" && item.integrityStatus !== "quarantined")
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

