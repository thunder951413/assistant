async function autoPreviewImport() {
  const content = importContent.value.trim();
  const url = importUrl.value.trim();
  if (!content && !url) return;
  await previewImport();
}

const scheduleAutoPreviewImport = debounce(() => autoPreviewImport(), 350);

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
  subscribeImportButton.disabled = true;
  previewImportButton.disabled = true;
  if (state.importPreviewController) state.importPreviewController.abort();
  const controller = new AbortController();
  state.importPreviewController = controller;
  const requestId = ++state.importPreviewRequest;

  try {
    const { preview } = await api("/api/preview-source", {
      method: "POST",
      body: JSON.stringify({
        content,
        url,
        sourceType: importSourceType.value,
        fetchMode: importFetchMode.value,
        pageKind: importPageKind.value,
      }),
      signal: controller.signal
    });
    if (requestId !== state.importPreviewRequest) return;

    state.importPreview = preview;
    confirmTitle.value = preview.title;
    previewContent.value = preview.extractedContent;
    previewReadableContent.innerHTML = renderMarkdown(preview.extractedContent || "暂无可阅读内容。");
    summaryContent.value = "";
    const duplicateNote = preview.existingItem
      ? ` 已发现相同页面已导入：${preview.existingItem.title}（${formatDate(preview.existingItem.updatedAt)}）。`
      : "";
    const linkedNote = preview.linkedItems?.length
      ? ` 检测到 ${preview.linkedItems.length} 个内容链接，确认导入后会同步导入这些内容页。`
      : "";
    const refreshJobNote = preview.refreshJob
      ? preview.refreshJob.proposed
        ? ` 确认后将加入订阅管理：${preview.refreshJob.name}（默认关闭）。`
        : ` 已存在订阅任务：${preview.refreshJob.name}（当前${preview.refreshJob.enabled ? "开启" : "关闭"}）。`
      : "";
    previewStatus.textContent = `${preview.parseNote} 内容长度 ${preview.contentLength} 字符。${linkedNote}${refreshJobNote}${duplicateNote}`;
    const isSubscription = preview.importMode === "subscription" || (preview.pageKind === "list" && preview.refreshJob);
    summaryStatus.textContent = isSubscription ? "订阅链接不需要生成总结，刷新订阅后会导入内容页。" : "可以生成 AI 总结，或手动填写总结。";
    previewBadge.textContent = isSubscription ? "订阅" : preview.existingItem ? "已存在" : (preview.parseStatus === "ready" ? "可导入" : "需确认");
    confirmImportButton.textContent = isSubscription ? "查看关注" : preview.existingItem ? "查看已有资料" : "一次保存";
    confirmImportButton.disabled = isSubscription ? !preview.refreshJob : (!preview.extractedContent.trim() && !preview.existingItem);
    subscribeImportButton.textContent = isSubscription ? "创建关注" : "持续关注";
    subscribeImportButton.disabled = Boolean(preview.existingItem) || (!preview.url && !preview.extractedContent.trim());
    summarizeButton.disabled = isSubscription || !preview.extractedContent.trim();
  } catch (error) {
    if (requestId !== state.importPreviewRequest) return;
    if (error.name === "AbortError") return;
    previewStatus.textContent = error.message;
    previewBadge.textContent = "失败";
    confirmImportButton.disabled = true;
    summarizeButton.disabled = true;
  }
  finally {
    if (requestId === state.importPreviewRequest) previewImportButton.disabled = false;
  }
}

async function confirmImport(options = {}) {
  if (!state.importPreview || state.importSubmitting) return;
  state.importSubmitting = true;
  confirmImportButton.disabled = true;
  subscribeImportButton.disabled = true;
  const activeButton = options.subscribe ? subscribeImportButton : confirmImportButton;
  const originalText = activeButton.textContent;
  activeButton.textContent = options.subscribe ? "正在创建关注…" : "正在保存…";

  const preview = state.importPreview;
  try {
  if (preview.existingItem?.id) {
    const existingId = preview.existingItem.id;
    resetImport();
    await switchView("materials");
    await selectItem(existingId);
    return;
  }

  if (preview.importMode === "subscription" || (preview.pageKind === "list" && preview.refreshJob)) {
    if (preview.refreshJob?.proposed) {
      await api("/api/refresh-jobs", {
        method: "POST",
        body: JSON.stringify({
          url: preview.url,
          title: confirmTitle.value.trim() || preview.title,
          sourceType: preview.sourceType,
          fetchMode: preview.fetchMode,
          pageKind: preview.pageKind,
          managedBy: preview.refreshJob.managedBy || "",
          subscribe: true
        })
      });
    }
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
      maxItems: 50,
      subscribe: Boolean(options.subscribe),
      captureMethod: preview.captureMethod,
      completeness: preview.completeness,
      coverage: preview.coverage,
      identityEvidence: preview.identityEvidence,
      sourceUpdatedAt: preview.sourceUpdatedAt,
      httpValidators: preview.httpValidators
    })
  });

    resetImport();
    if (options.subscribe) {
      await switchView("subscriptions");
      return;
    }
    await switchView("materials");
    await selectItem(item.item.metadata.id);
  } catch (error) {
    previewStatus.textContent = error.message || "保存失败，请重试。";
    previewBadge.textContent = "保存失败";
  } finally {
    state.importSubmitting = false;
    if (state.importPreview) {
      confirmImportButton.disabled = false;
      subscribeImportButton.disabled = false;
      activeButton.textContent = originalText;
    }
  }
}

function resetImport() {
  state.importPreviewRequest += 1;
  state.importPreviewController?.abort();
  state.importPreviewController = null;
  state.importPreview = null;
  importForm.reset();
  confirmTitle.value = "";
  confirmTags.value = "";
  previewContent.value = "";
  previewReadableContent.textContent = "解析后会显示可阅读的正文。";
  summaryContent.value = "";
  previewStatus.textContent = "等待输入内容。";
  summaryStatus.textContent = "解析内容后可生成总结。";
  previewBadge.textContent = "未解析";
  confirmImportButton.textContent = "确认导入";
  confirmImportButton.disabled = true;
  subscribeImportButton.textContent = "持续关注";
  subscribeImportButton.disabled = true;
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
      body: JSON.stringify({ content, sourceType: state.importPreview?.sourceType, url: state.importPreview?.url })
    });
    summaryContent.value = summary.text;
    summaryStatus.textContent = summary.note;
  } catch (error) {
    summaryStatus.textContent = error.message;
  } finally {
    summarizeButton.disabled = false;
  }
}

