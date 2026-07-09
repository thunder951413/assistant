# 重构分析：高层抽象优化方案

> 基于当前代码库的全局分析，识别可通过更高一级抽象优化的区域。

## 总体架构概览

| 层 | 文件 | 行数 | 职责 |
|---|---|---|---|
| 后端 | `src/server.js` | 7,782 | 全部：路由、CRUD、AI、抓取、调度、WebDriver |
| 工具 | `src/utils.js` | 42 | 文本清理、URL 解析、slug 化 |
| 前端 | `public/app.js` | 3,955 | 全部：视图、状态、渲染、事件、聊天 |
| 页面 | `public/index.html` | ~400 | DOM 结构 |

这是一个**有机生长的单体应用**——MVP 阶段快速迭代的典型结果。

---

## 1. 路由注册抽象 — 收益最高、成本最低

### 现状

`src/server.js:65-451`：一个 386 行的 `if/else` 链，完全靠手动字符串匹配路由。

```js
// 当前模式 — 约 50 个这样的块
if (req.method === "GET" && url.pathname === "/api/items") { ... }
if (req.method === "POST" && url.pathname === "/api/items") { ... }
if (req.method === "DELETE" && url.pathname.startsWith("/api/items/")) { ... }
```

### 问题

- 路由顺序敏感（`startsWith("/api/items/")` 必须放在精确匹配 `/api/items` **之后**）
- 参数提取靠 `url.pathname.split("/")[3]` 和 `url.pathname.endsWith("/tags")`，脆弱且分散
- 新增端点要在 380 行里找到正确插入位置

### 建议

提取一个轻量路由表（不引入依赖，约 40 行）：

```js
// 概念示意
const routes = [
  ["GET",  "/api/items",                        listItemsHandler],
  ["POST", "/api/items",                        createItemHandler],
  ["GET",  "/api/items/:id",                    getItemHandler],
  ["PATCH","/api/items/:id/tags",               updateTagsHandler],
  ["POST", "/api/items/:id/process",            processItemHandler],
  // ...
];

// handleApi 缩减为 ~20 行循环匹配
function matchRoute(method, pathname) {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const params = extractParams(pattern, pathname);
    if (params !== null) return { handler, params };
  }
  return null;
}
```

---

## 2. 存储 / Repository 层 — 为未来铺路

### 现状

文件系统操作散落在所有业务函数里。每个操作都重复路径拼接和读写：

```js
// 散落在 readItem、listItems、updateTags、renameTag、deleteTags 等函数中
const metadata = JSON.parse(
  await fs.readFile(path.join(itemsDir, id, "metadata.json"), "utf8")
);
const document = await fs.readFile(
  path.join(itemsDir, id, "document.md"), "utf8"
);
```

`renameTag` (`src/server.js:3009`) 和 `deleteTags` (`src/server.js:3058`) 有**完全相同**的 "遍历所有 item → 读 metadata → 改 → 写回 document.md" 循环（约 40 行重复）。

### 建议

一个 `ItemStore` 模块，封装 `metadata.json` / `document.md` / `processed.md` / `comments.jsonl` 的读写路径：

```js
// 概念示意
const itemStore = {
  read(id)       → { metadata, document, processedDocument, comments }
  write(id, ...) → void
  list(filters)  → items[]
  listAll()      → items[]
}
```

MVP plan 提到 "SQLite 暂不作为主存储"——有了 Repository 层，后续切换只会触及一个模块。

---

## 3. Source Adapter 模式 — MVP plan 已规划，未落地

### 现状

MVP plan (`docs/mvp-plan.md`) 明确定义了接口但未实现：

```ts
interface SourceAdapter {
  canHandle(input: SourceInput): boolean
  fetch(input: SourceInput): Promise<RawSource>
  extract(raw: RawSource): Promise<ExtractedSource>
  refresh(itemId: string): Promise<ExtractedSource>
}
```

源特定的逻辑散布在多个函数中：

| 函数 | 位置 | 职责 |
|---|---|---|
| `refreshListJob` | `src/server.js:4032` | 按 `sourceType` 分发刷新 |
| `refreshContentJob` | `src/server.js:4129` | 同上 |
| `refreshJiraFilterJob` | `src/server.js:4175` | Jira 专属 |
| `fetchTeamsWithWebdriver` | `src/server.js:4723` | Teams 专属 |
| `expandGithubDynamicContent` | `src/server.js:5075` | GitHub 专属 |
| `fetchUrl` / `fetchUrlWithWebdriver` | `src/server.js:4480-4679` | 混杂所有源 |

### 建议

5 个 Adapter（Jira、Confluence、GitHub、Teams、Web/Text），每个约 100-150 行，统一 `fetch` → `extract` → `refresh` 流程。当前约 2,000 行抓取逻辑可收敛为结构化的 Adapter 注册表。

---

## 4. AI 客户端抽象 — 减少重复的 OpenAI 调用

### 现状

以下函数各自手工构造 OpenAI-compatible 请求：

| 函数 | 位置 | 用途 |
|---|---|---|
| `summarizeWithOpenAICompatible` | `src/server.js:750` | 摘要 |
| `recommendTitleWithOpenAICompatible` | `src/server.js:1448` | 标题推荐 |
| `recommendTagsWithOpenAICompatible` | `src/server.js:1933` | 标签推荐 |
| `recommendBatchTagsWithOpenAICompatible` | `src/server.js:1574` | 批量标签 |
| `classifyItemsWithOpenAICompatible` | `src/server.js:1702` | 分类 |
| `classifyItemWithOpenAICompatible` | `src/server.js:1762` | 单项分类 |
| `processDocumentWithOpenAICompatible` | `src/server.js:2059` | 文档整理 |
| `answerWithOpenAICompatible` | `src/server.js:2288` | 问答（非流式） |
| `streamWithOpenAICompatible` | `src/server.js:2426` | 问答（SSE 流式） |
| `createEmbeddings` | `src/server.js:2825` | 向量化 |

每个函数都重复了：
- 读取 settings 中的 `baseUrl` / `apiKey` / `model`
- 构造 `fetch(url, { headers: { Authorization: "Bearer ..." } })`
- 手动解析 `response.json()` 或 SSE stream

### 建议

一个 `AiClient` 类：

```js
// 概念示意
class AiClient {
  async chat(messages, opts?)      → { content, usage }
  async chatStream(messages, opts?) → AsyncIterable<chunk>
  async embedding(texts)            → number[][]
}
```

现有 10 个 `*WithOpenAICompatible` 函数变成对 `AiClient` 的薄调用层，约消除 200 行重复代码。

---

## 5. 前端 View 拆分 — 轻量即可

### 现状

`public/app.js` 3,955 行，全局 `state` 对象有约 50 个字段。视图切换靠手动 `hidden` 切换：

```js
// public/app.js:438 — switchView
document.querySelectorAll('.workspace > section')
  .forEach(s => s.hidden = true);
document.querySelector(`#${view}View`).hidden = false;
```

每个渲染函数（`renderItems`、`renderDetail`、`renderRefreshJobs`...）直接操作 DOM，没有模板或组件概念。

### 建议

不需要引入 React/Vue。一个极简的 `View` 约定：

```js
// 每个 View 暴露统一接口
const homeView = {
  mount()   → void   // 初始化事件监听
  unmount() → void   // 清理
  refresh() → void   // 重新拉数据并渲染
}
```

3,955 行按视图拆分为 6-7 个模块（`views/home.js`、`views/chat.js`、`views/materials.js`...），每个 300-500 行。

---

## 优先级排序

| 优先级 | 抽象 | 工作量 | 收益 |
|---|---|---|---|
| **1** | 路由注册表 | ~2h | 每个新端点从「找插入位置」变成「加一行路由」 |
| **2** | AI 客户端 | ~2h | 消除约 200 行重复的 fetch+auth 代码 |
| **3** | ItemStore | ~3h | 统一文件路径，为 SQLite 迁移铺路 |
| **4** | Source Adapter | ~1d | 最符合 MVP plan 原意，但涉及现有逻辑重排 |
| **5** | 前端 View 拆分 | ~3h | 改善开发体验，功能不变 |

前 3 项可以**增量**进行，不改变外部行为，测试可通过现有的 `node --test` 验证。

---

## 执行节奏建议

### 第一阶段（当天）
- **路由注册表**：`handleApi` 从 386 行缩减到 ~20 行
- **AI 客户端**：提取 `AiClient`，替换 10 个重复函数

### 第二阶段（本周）
- **ItemStore**：统一文件读写路径
- **前端 View 拆分**：`app.js` 按视图拆为独立模块

### 第三阶段（后续）
- **Source Adapter**：落地 MVP plan 中定义的接口，将 Jira / Confluence / GitHub / Teams / Web 的抓取逻辑收敛到各自的 Adapter 中
