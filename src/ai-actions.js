// AI actions on items: titles, tags, classification, summaries and organizing.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { classifyItemLocally, classifyItemsLocally, cleanGeneratedTitle, normalizeBatchTagRecommendations, normalizeClassificationCategories, normalizeItemClassification, normalizeRecommendedTags, normalizeSingleClassification, parseJsonObjectFromText, parseTagsFromAiText, recommendBatchTagsLocally, recommendTagsLocally, recommendTitleLocally } from "./ai-local.js";
import { canUseMaterial } from "./ai-policy.js";
import { buildProcessingInput } from "./ai-processing.js";
import { extractBodyFromDocument, extractSummaryFromDocument } from "./item-store.js";
import { buildLocalSummary, extractProcessedBodyFromDocument, unwrapMarkdownFence } from "./text-helpers.js";
import { cleanText } from "./utils.js";

export function createAiActions(ctx) {
  // Functions that live elsewhere, resolved when called.
  const isRemoteAiAllowed = (...args) => ctx.isRemoteAiAllowed(...args);
  const modelVisibleTags = (...args) => ctx.modelVisibleTags(...args);
  const readItem = (...args) => ctx.readItem(...args);
  const rebuildIndexes = (...args) => ctx.rebuildIndexes(...args);
  const renderProcessedDocument = (...args) => ctx.renderProcessedDocument(...args);
  const resolveProcessingPrompt = (...args) => ctx.resolveProcessingPrompt(...args);
  const supplementalPromptBlock = (...args) => ctx.supplementalPromptBlock(...args);
  const updateTitle = (...args) => ctx.updateTitle(...args);
  const withItemUrlMutationLock = (...args) => ctx.withItemUrlMutationLock(...args);

  async function summarizeContent(input) {
    const content = cleanText(input.content || "");
    if (!content) {
      throw new Error("没有可总结的内容。");
    }

    if (ctx.settings.ai?.baseUrl && ctx.settings.ai?.apiKey && ctx.settings.ai?.model) {
      return summarizeWithOpenAICompatible(content, { url: input.url || "", sourceType: input.sourceType || "text" }, { signal: input.signal });
    }

    return {
      mode: "local",
      text: buildLocalSummary(content),
      note: "未配置 AI 接口，当前使用本地提取式摘要。"
    };
  }

  async function summarizeWithOpenAICompatible(content, metadata = {}, options = {}) {
    const text = await ctx.ai.chat([
      {
        role: "system",
        content: "你是资料整理助手。请用中文总结资料，突出主题、关键进展、评论/讨论结论、未解决问题和下一步。"
      },
      {
        role: "user",
        content: content.slice(0, 24000)
      }
    ], { materials: [metadata], signal: options.signal });

    return {
      mode: "ai",
      text,
      note: `使用模型 ${ctx.settings.ai.model} 生成。`
    };
  }

  async function updateTitleWithAi(id) {
    const item = await readItem(id);
    const title = ctx.settings.ai?.baseUrl && ctx.settings.ai?.apiKey && ctx.settings.ai?.model
      ? await recommendTitleWithOpenAICompatible(item)
      : recommendTitleLocally(item);
    return updateTitle(id, title);
  }

  async function recommendTitleWithOpenAICompatible(item) {
    const body = extractBodyFromDocument(item.document).trim().slice(0, 12000);
    const supplemental = await supplementalPromptBlock();
    const text = await ctx.ai.chat([
      {
        role: "system",
        content: [
          "你是知识库资料标题生成助手。",
          "根据资料正文生成一个便于检索的中文标题，主要描述内容涉及的核心对象、问题或主题。",
          "要求：不要复述冗长原始标题；不要使用 Markdown；不要加引号；长度控制在 12 到 40 个中文字符左右。",
          supplemental
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `来源类型：${item.metadata.sourceType || "unknown"}`,
          `原标题：${item.metadata.title || ""}`,
          "",
          "正文：",
          body
        ].join("\n")
      }
    ], { materials: [item.metadata] });

    return cleanGeneratedTitle(text);
  }

  async function recommendTagsForItem(id) {
    const item = await readItem(id);
    const allTags = await modelVisibleTags();
    const currentTags = item.metadata.tags || [];
    const content = [
      `Title: ${item.metadata.title}`,
      `Source: ${item.metadata.sourceType}`,
      `URL: ${item.metadata.url || ""}`,
      "",
      item.document,
      "",
      item.comments?.length ? `Comments:\n${item.comments.map((comment) => comment.body).join("\n\n")}` : ""
    ].join("\n").slice(0, 24000);

    if (ctx.settings.ai?.baseUrl && ctx.settings.ai?.apiKey && ctx.settings.ai?.model) {
      const tags = await recommendTagsWithOpenAICompatible({ content, allTags, currentTags, metadata: item.metadata });
      return {
        mode: "ai",
        tags,
        currentTags,
        existingTags: allTags,
        note: `使用模型 ${ctx.settings.ai.model} 推荐。`
      };
    }

    return {
      mode: "local",
      tags: recommendTagsLocally(content, allTags, currentTags),
      currentTags,
      existingTags: allTags,
      note: "未配置 AI 接口，当前使用本地关键词和已有标签推荐。"
    };
  }

  async function recommendTagsForItems(ids) {
    const uniqueIds = [...new Set((ids || []).map((id) => cleanText(id)).filter(Boolean))].slice(0, 80);
    if (!uniqueIds.length) return { tags: [], assignments: [] };
    const items = [];
    for (const id of uniqueIds) {
      try {
        const item = await readItem(id);
        if (canUseMaterial(item.metadata, ctx.settings)) items.push(item);
      } catch {
        // Ignore deleted or invalid items in a long-running batch.
      }
    }
    const allTags = await modelVisibleTags();
    const result = ctx.settings.ai?.baseUrl && ctx.settings.ai?.apiKey && ctx.settings.ai?.model
      ? await recommendBatchTagsWithOpenAICompatible(items, allTags)
      : recommendBatchTagsLocally(items, allTags);
    return normalizeBatchTagRecommendations(result, items, allTags);
  }

  async function recommendBatchTagsWithOpenAICompatible(items, allTags) {
    const supplemental = await supplementalPromptBlock();
    const documents = items.map((item) => {
      const processed = item.processedDocument && !item.metadata.processedStale
        ? extractProcessedBodyFromDocument(item.processedDocument)
        : "";
      const source = processed || extractBodyFromDocument(item.document);
      return [
        `ID: ${item.metadata.id}`,
        `标题: ${item.metadata.title}`,
        `来源: ${item.metadata.sourceType}`,
        `当前标签: ${(item.metadata.tags || []).join(", ") || "none"}`,
        "内容:",
        source.slice(0, 3500)
      ].join("\n");
    }).join("\n\n---\n\n");

    const payload = await ctx.ai.chatPayload([
      {
        role: "system",
        content: [
          "你是资料库批量标签分类助手。",
          "请根据一批文档的整体主题、来源、状态、问题类型和行动项，设计统一的标签池，并给每篇文档分配适合的标签。",
          "优先复用已有标签；同义标签必须合并，只保留一种写法。",
          "标签使用小写短词、数字或连字符，不要包含空格。",
          "不要给每篇文档都创造独有标签；优先生成能横向分类多篇文档的标签。",
          "只返回 JSON，格式为 {\"tags\":[\"tag-a\"],\"assignments\":[{\"id\":\"item-id\",\"tags\":[\"tag-a\"]}]}。",
          supplemental
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: [
          `资料库已有标签：${allTags.join(", ") || "none"}`,
          "",
          "待分类文档：",
          documents
        ].join("\n")
      }
    ], { materials: items.map(item => item.metadata), temperature: 0.1 });

    return parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
  }

  async function classifyItems(ids, categories = []) {
    const uniqueIds = [...new Set((ids || []).map((id) => cleanText(id)).filter(Boolean))].slice(0, 120);
    const normalizedCategories = normalizeClassificationCategories(categories);
    const items = [];
    for (const id of uniqueIds) {
      try {
        const item = await readItem(id);
        if (canUseMaterial(item.metadata, ctx.settings)) items.push(item);
      } catch {
        // Ignore items deleted while a list classification request is running.
      }
    }
    if (!items.length) return { groups: [], note: "当前列表没有可分类的资料。" };
    const result = ctx.settings.ai?.baseUrl && ctx.settings.ai?.apiKey && ctx.settings.ai?.model
      ? await classifyItemsWithOpenAICompatible(items, normalizedCategories)
      : classifyItemsLocally(items, normalizedCategories);
    return normalizeItemClassification(result, items, normalizedCategories);
  }

  async function classifyItem(id, categories = []) {
    const normalizedCategories = normalizeClassificationCategories(categories);
    if (!normalizedCategories.length) {
      throw new Error("请先提供分类类别。");
    }
    const item = await readItem(cleanText(id));
    if (item.metadata.integrityStatus === "quarantined") {
      throw new Error("该资料因来源完整性校验失败已被隔离，不能参与 AI 分类。");
    }
    if (!ctx.settings.ai?.baseUrl || !ctx.settings.ai?.apiKey || !ctx.settings.ai?.model) {
      return classifyItemLocally(item, normalizedCategories);
    }
    return classifyItemWithOpenAICompatible(item, normalizedCategories);
  }

  async function classifyItemsWithOpenAICompatible(items, categories = []) {
    const supplemental = await supplementalPromptBlock();
    const documents = items.map((item) => {
      const processed = item.processedDocument && !item.metadata.processedStale
        ? extractProcessedBodyFromDocument(item.processedDocument)
        : "";
      const source = processed || extractBodyFromDocument(item.document);
      return [
        `ID: ${item.metadata.id}`,
        `标题: ${item.metadata.title}`,
        `来源: ${item.metadata.sourceType || "unknown"}`,
        `标签: ${(item.metadata.tags || []).join(", ") || "none"}`,
        "内容摘要:",
        source.slice(0, 1800)
      ].join("\n");
    }).join("\n\n---\n\n");

    const payload = await ctx.ai.chatPayload([
      {
        role: "system",
        content: [
          "你是资料库列表分类助手。",
          categories.length
            ? "用户已经给出固定类别。你必须逐条阅读资料，并且只把资料分配到这些类别中；不能新增类别。确实不适合任何类别时才放到\u201c未分类\u201d。"
            : "请把当前资料列表按主题、项目、问题类型或工作流分成适合浏览的分类。",
          categories.length ? "" : "分类数量通常为 3 到 10 个；避免每篇文档单独一个分类。",
          "每个资料 ID 最多出现一次，尽量覆盖所有资料。",
          "分类名要短且清晰，适合显示在左侧列表。",
          "只返回 JSON，格式为 {\"groups\":[{\"name\":\"分类名\",\"itemIds\":[\"item-id\"],\"reason\":\"分类依据\"}]}。",
          supplemental
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: [
          `当前列表共有 ${items.length} 条资料。`,
          categories.length ? `可用类别：${categories.join("、")}、未分类` : "",
          "",
          documents
        ].filter(Boolean).join("\n")
      }
    ], { materials: items.map(item => item.metadata), temperature: 0.1 });

    return parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
  }

  async function classifyItemWithOpenAICompatible(item, categories) {
    const supplemental = await supplementalPromptBlock();
    const processed = item.processedDocument && !item.metadata.processedStale
      ? extractProcessedBodyFromDocument(item.processedDocument)
      : "";
    const source = processed || extractBodyFromDocument(item.document);

    const payload = await ctx.ai.chatPayload([
      {
        role: "system",
        content: [
          "你是资料库单条资料分类助手。",
          "请阅读资料内容，并且只从用户提供的类别中选择一个最合适的类别。",
          "如果资料确实不适合任何类别，返回\u201c未分类\u201d。不能新增类别，不能改写类别名。",
          "只返回 JSON，格式为 {\"category\":\"类别名\",\"reason\":\"一句话分类依据\"}。",
          supplemental
        ].filter(Boolean).join("\n")
      },
      {
        role: "user",
        content: [
          `可用类别：${categories.join("、")}、未分类`,
          `ID: ${item.metadata.id}`,
          `标题: ${item.metadata.title}`,
          `来源: ${item.metadata.sourceType || "unknown"}`,
          `标签: ${(item.metadata.tags || []).join(", ") || "none"}`,
          "",
          "内容：",
          source.slice(0, 5000)
        ].join("\n")
      }
    ], { materials: [item.metadata], temperature: 0.1 });

    const parsed = parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
    return normalizeSingleClassification(parsed, item, categories);
  }

  async function recommendTagsWithOpenAICompatible({ content, allTags, currentTags, metadata }) {
    const supplemental = await supplementalPromptBlock();
    const payload = await ctx.ai.chatPayload([
      {
        role: "system",
        content: [
          "你是资料库标签整理助手。",
          "请根据文档内容推荐 3 到 8 个短标签。",
          "优先复用已有标签，只有已有标签明显不合适时才创建新标签。",
          "避免同义但写法不同的标签，例如已有 github 就不要新建 github-issue，已有 jira 就不要新建 jira-ticket。",
          "标签使用小写短词、数字或连字符，不要包含空格。",
          "只返回 JSON，格式为 {\"tags\":[\"tag-a\",\"tag-b\"]}。",
          supplemental
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `当前文档标签：${currentTags.join(", ") || "none"}`,
          `资料库已有标签：${allTags.join(", ") || "none"}`,
          "",
          "文档内容：",
          content
        ].join("\n")
      }
    ], { materials: [metadata], temperature: 0.1 });

    const text = payload.choices?.[0]?.message?.content?.trim() || "";
    const parsed = parseTagsFromAiText(text);
    return normalizeRecommendedTags(parsed, allTags, currentTags);
  }

  async function processItemWithAi(id, options = {}) {
    const item = await readItem(id);
    if (item.metadata.integrityStatus === "quarantined") {
      throw new Error("该资料因来源完整性校验失败已被隔离，验证刷新成功前不能进行 AI 整理。");
    }
    if (!ctx.settings.ai?.baseUrl || !ctx.settings.ai?.apiKey || !ctx.settings.ai?.model) {
      throw new Error("请先在设置页配置 AI 接口后再生成整理版。");
    }
    if (!isRemoteAiAllowed(item.metadata)) {
      throw new Error("该数据源已禁止发送到远程 AI。可继续本地查看和检索，或在数据源设置中重新授权。");
    }

    const prompt = resolveProcessingPrompt(item.metadata.sourceType);
    const processed = await processDocumentWithOpenAICompatible(item, prompt, options);
    const processedText = unwrapMarkdownFence(processed.text);
    return withItemUrlMutationLock(item.metadata.url || "", async () => {
    const now = new Date().toISOString();
    options.signal?.throwIfAborted();
    const latest = await readItem(id);
    if (extractBodyFromDocument(latest.document) !== extractBodyFromDocument(item.document) || JSON.stringify(latest.comments) !== JSON.stringify(item.comments)) {
      const error = new Error("资料在整理期间发生更新，请基于最新原文重新整理。"); error.statusCode = 409; throw error;
    }
    const metadata = {
      ...latest.metadata,
      processedAt: now,
      processedModel: ctx.settings.ai.model,
      processedPromptSource: item.metadata.sourceType || "default",
      processedStale: false,
      // How far the organized version reaches, so the reader and the auto-process
      // policy can tell how much arrived after it.
      processedThroughAt: processed.processedThroughAt || latest.metadata.processedThroughAt || "",
      processedMode: processed.mode,
      processedIncrementalCount: processed.mode === "incremental" ? Number(latest.metadata.processedIncrementalCount || 0) + 1 : 0,
      processedMessageCount: (latest.comments || []).length,
      contentUpdatedAt: latest.metadata.contentUpdatedAt || "",
      pendingContentUpdatedAt: "",
      updatedAt: now
    };
    await ctx.store.commit(id, { metadata, processedDocument: renderProcessedDocument(metadata, processedText) });
    await rebuildIndexes();
    return readItem(id);
    });
  }

  async function processDocumentWithOpenAICompatible(item, prompt, options = {}) {
    const supplemental = await supplementalPromptBlock();
    const processedBody = item.processedDocument ? extractProcessedBodyFromDocument(item.processedDocument) : "";
    const input = buildProcessingInput(options.full ? { ...item, metadata: { ...item.metadata, processedIncrementalCount: Number.MAX_SAFE_INTEGER } } : item, {
      body: extractBodyFromDocument(item.document).trim(),
      summary: extractSummaryFromDocument(item.document).trim(),
      processedBody,
      policy: ctx.settings.autoProcess
    });
    const text = await ctx.ai.chat([
      {
        role: "system",
        content: [
          prompt,
          "",
          "输出要求：",
          "- 使用中文。",
          "- 输出 Markdown。",
          "- 只整理资料内容，不编造原文没有的信息。",
          "- 如果信息不足或状态不明确，要明确写出\u201c不明确\u201d。",
          "- 保留关键原始标识，例如 Jira key、GitHub issue/PR 编号、URL、时间、人名。",
          input.systemExtra,
          supplemental
        ].filter((line) => line !== undefined).join("\n")
      },
      { role: "user", content: input.user }
    ], { materials: [item.metadata], signal: options.signal });
    return { text, mode: input.mode, processedThroughAt: input.processedThroughAt };
  }

  return { summarizeContent, updateTitleWithAi, recommendTagsForItem, recommendTagsForItems, classifyItems, classifyItem, processItemWithAi };
}
