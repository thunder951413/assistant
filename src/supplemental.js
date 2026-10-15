// Glossary and background notes (术语与背景) used in AI prompts.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { parseJsonObjectFromText } from "./ai-local.js";
import { canUseMaterial } from "./ai-policy.js";
import { exists } from "./fs-helpers.js";
import { extractBodyFromDocument } from "./item-store.js";
import { cleanTextBlock } from "./text-helpers.js";
import { cleanText, slugify } from "./utils.js";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createSupplemental(ctx) {
  // Functions that live elsewhere, resolved when called.
  const readAllMaterialsForSearch = (...args) => ctx.readAllMaterialsForSearch(...args);

  function supplementalContextPath() {
    return path.join(ctx.kbDir, "SUPPLEMENTAL.md");
  }

  function supplementalEntriesPath() {
    return path.join(ctx.kbDir, "SUPPLEMENTAL.json");
  }

  async function readSupplementalContext() {
    return renderSupplementalMarkdown(await readSupplementalEntries(), { includePending: false });
  }

  async function saveSupplementalContext(content) {
    return saveSupplementalEntries(parseSupplementalMarkdown(content));
  }

  async function readSupplementalEntries() {
    const entriesPath = supplementalEntriesPath();
    if (await exists(entriesPath)) {
      try {
        const payload = JSON.parse(await fs.readFile(entriesPath, "utf8"));
        return normalizeSupplementalEntries(Array.isArray(payload) ? payload : payload.entries || []);
      } catch {
        return [];
      }
    }

    const markdownPath = supplementalContextPath();
    if (!(await exists(markdownPath))) return [];
    return normalizeSupplementalEntries(parseSupplementalMarkdown(await fs.readFile(markdownPath, "utf8")));
  }

  async function saveSupplementalEntries(entries) {
    const normalized = normalizeSupplementalEntries(entries);
    await fs.mkdir(ctx.kbDir, { recursive: true });
    await fs.writeFile(supplementalEntriesPath(), `${JSON.stringify({ entries: normalized }, null, 2)}\n`, "utf8");
    await fs.writeFile(supplementalContextPath(), renderSupplementalMarkdown(normalized, { includePending: true }), "utf8");
    return normalized;
  }

  // Stable id for a glossary entry. slugify() keeps only ASCII, so terms such as
  // "机顶盒" would all become "item"; add a short hash of the original text.
  function slugId(text) {
    const value = cleanText(text);
    const slug = slugify(value);
    return /^[\x00-\x7f]*$/.test(value) && slug !== "item" ? slug : `${slug === "item" ? "term" : slug}-${createHash("sha1").update(value).digest("hex").slice(0, 8)}`;
  }

  function normalizeSupplementalEntries(entries) {
    const seen = new Set();
    return (entries || [])
      .map((entry, index) => {
        const term = cleanText(entry.term || entry.title || "");
        const category = cleanText(entry.category || "待确认") || "待确认";
        const reason = cleanText(entry.reason || entry.note || "");
        const explanation = cleanText(entry.explanation || entry.description || "");
        const id = cleanText(entry.id || slugId(term || reason || `entry-${index}`));
        return { id, term, category, reason, explanation };
      })
      .filter((entry) => entry.term || entry.reason || entry.explanation)
      .map((entry, index) => {
        const base = entry.id || slugId(entry.term || `entry-${index}`);
        let id = base;
        let counter = 2;
        while (seen.has(id)) {
          id = `${base}-${counter}`;
          counter += 1;
        }
        seen.add(id);
        return { ...entry, id };
      });
  }

  function parseSupplementalMarkdown(content) {
    const entries = [];
    let category = "待确认";
    for (const line of String(content || "").replace(/\r\n/g, "\n").split("\n")) {
      const heading = line.match(/^#{2,4}\s+(.+?)\s*$/);
      if (heading) {
        category = heading[1].replace(/^已说明[:：]?|^待说明[:：]?/, "").trim() || "待确认";
        continue;
      }
      const bullet = line.match(/^\s*[-*]\s+(?:\*\*)?([^:*：]+?)(?:\*\*)?\s*[:：]\s*(.+?)\s*$/);
      if (bullet) {
        const term = bullet[1].trim();
        const value = bullet[2].trim();
        const isPending = /待补充|需要补充|未定义|未明确|需确认|待确认/.test(value);
        entries.push({
          id: slugId(term),
          term,
          category,
          reason: isPending ? value : "",
          explanation: isPending ? "" : value
        });
      }
    }
    return entries;
  }

  function renderSupplementalMarkdown(entries, options = {}) {
    const includePending = options.includePending !== false;
    const normalized = normalizeSupplementalEntries(entries);
    const complete = normalized.filter((entry) => entry.explanation);
    const pending = normalized.filter((entry) => !entry.explanation);
    const groups = new Map();
    for (const entry of complete) {
      const group = entry.category || "补充说明";
      groups.set(group, [...(groups.get(group) || []), entry]);
    }

    const lines = [];
    for (const [category, groupEntries] of groups) {
      lines.push(`## ${category}`);
      for (const entry of groupEntries) {
        const reason = entry.reason ? `（${entry.reason}）` : "";
        lines.push(`- ${entry.term}: ${entry.explanation}${reason}`);
      }
      lines.push("");
    }

    if (includePending && pending.length) {
      lines.push("## 待说明");
      for (const entry of pending) {
        lines.push(`- ${entry.term || "未命名"}: ${entry.reason || "待补充"}`);
      }
      lines.push("");
    }

    return cleanTextBlock(lines.join("\n"));
  }

  async function supplementalPromptBlock() {
    const content = (await readSupplementalContext()).trim();
    if (!content) return "";
    return [
      "以下是用户维护的补充资料、缩写和项目背景。处理资料时必须优先参考，但不要把补充资料本身当作原文事实来源：",
      content.slice(0, 12000)
    ].join("\n\n");
  }

  async function suggestSupplementalContext(existingEntries = []) {
    if (!ctx.settings.ai?.baseUrl || !ctx.settings.ai?.apiKey || !ctx.settings.ai?.model) {
      throw new Error("请先在设置页配置 AI 接口后再分析补充资料。");
    }
    const existing = normalizeSupplementalEntries(existingEntries.length ? existingEntries : await readSupplementalEntries());
    const { text: corpus, materials } = await buildSupplementalAnalysisCorpus();
    if (!corpus.trim()) throw new Error("当前资料库没有足够内容可分析。");

    const payload = await ctx.ai.chatPayload([
      {
        role: "system",
        content: [
          "你是资料库术语分析助手。",
          "请从资料片段中找出可能需要用户补充解释的缩写、项目名、模块名、测试名、产品代号、组织内部词汇。",
          "不要重复已有候选项。",
          "不要编造确定含义，只说明为什么需要用户补充或确认。",
          "只返回 JSON，格式为 {\"entries\":[{\"term\":\"CI+\",\"category\":\"缩写\",\"reason\":\"多次出现但上下文不完整\",\"explanation\":\"\"}]}。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `已有候选项：${existing.map((entry) => entry.term).filter(Boolean).join(", ") || "none"}`,
          "",
          corpus
        ].join("\n")
      }
    ], { materials, temperature: 0.2 });

    const parsed = parseJsonObjectFromText(payload.choices?.[0]?.message?.content || "");
    const existingTerms = new Set(existing.map((entry) => entry.term.toLowerCase()).filter(Boolean));
    return normalizeSupplementalEntries(parsed.entries || [])
      .filter((entry) => entry.term && !existingTerms.has(entry.term.toLowerCase()))
      .map((entry) => ({ ...entry, explanation: "" }))
      .slice(0, 40);
  }

  async function buildSupplementalAnalysisCorpus() {
    const chunks = [];
    const materials = [];
    for (const material of [...(await readAllMaterialsForSearch()).values()].slice(0, 80)) {
      if (material.metadata.pageKind === "list" || !canUseMaterial(material.metadata, ctx.settings)) continue;
      const { metadata, document } = material;
      chunks.push([`# ${metadata.title}`, `Source: ${metadata.sourceType}`, extractBodyFromDocument(document).slice(0, 1800)].join("\n"));
      materials.push(metadata);
      if (chunks.join("\n\n").length > 60000) break;
    }
    return { text: chunks.join("\n\n---\n\n"), materials };
  }

  return { supplementalContextPath, supplementalEntriesPath, saveSupplementalContext, readSupplementalEntries, saveSupplementalEntries, renderSupplementalMarkdown, supplementalPromptBlock, suggestSupplementalContext };
}
