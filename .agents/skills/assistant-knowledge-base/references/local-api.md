# 本地 API 与共享资料库

用于连接项目、查询、入库和刷新。以下路径都相对于已经确认的 `apiBase`；默认开发地址为 `http://127.0.0.1:8020`，实际页面可能使用其他端口。

## 连接与存储

| 方法 / 路径 | 返回值 / 用途 |
| --- | --- |
| `GET /api/agent-config` | `{ rootDir, guidePath }`；当前知识库绝对路径及读取指南 |
| `GET /api/health` | `knowledgeBase.root`、`knowledgeBase.itemCount`、刷新运行概况 |
| `GET /api/settings` | `{ settings }`；`activeDocumentRoot` 为实际目录，来源凭据为掩码 |
| `GET /api/supplemental-context` | `{ entries, content, path, entriesPath }`；补充上下文和真实文件位置 |

```bash
curl --fail-with-body --silent --show-error http://127.0.0.1:8020/api/agent-config
```

开发模式默认配置在 `<repo>/.config/settings.json`，可被 `ASSISTANT_CONFIG_DIR` 覆盖。Electron 用其应用数据目录下的 `config/`，默认资料目录也在应用数据目录中；`desktop/main.js` 会在默认端口占用时选用空闲端口。资料路径可受存储设置和 `ASSISTANT_DOCUMENT_ROOT` 影响。以活动实例 API 返回路径为准。

资料布局：

| 文件 / 目录 | 含义 |
| --- | --- |
| `items/<id>/metadata.json` | 标题、来源、URL、标签、抓取时间、完整性、刷新状态 |
| `items/<id>/document.md` | 可读正文，带 Metadata、可选 Summary、Content |
| `items/<id>/comments.jsonl` | 一行一个评论或会话消息对象 |
| `items/<id>/<metadata.rawFileName>` | 原始页面、API JSON 或导入文本 |
| `items/<id>/processed.md` | 项目 AI 整理后的内容；检查 `processedStale` |
| `items/<id>/snapshots/` | 内容变化前的历史版本 |
| `indexes/by-source.json`、`by-tag.json`、`by-updated.json` | 来源、标签和更新时间索引 |
| `tags/<tag>.json` | 标签反向索引 |
| `SUPPLEMENTAL.md`、`SUPPLEMENTAL.json` | 项目的补充背景；可能尚不存在 |

## 检索与读回

`POST /api/knowledge-search`：

```json
{
  "query": "Samsung T6D source code build",
  "limit": 10,
  "filters": { "sourceType": "confluence", "tag": "samsung" }
}
```

返回 `{ rootDir, results }`，其中每个命中是 `{ item, context, score, ... }`，ID 在 `results[i].item.id`。正文检索还会考虑评论和整理结果；启用 embedding 时也可能调用项目配置的 embedding 服务。

其他有效 filters：`dateFrom`、`dateTo`、`remoteAiOnly`。日期过滤使用库内 `updatedAt`；传完整 ISO 时间范围，按用户时区换算后比较。查“最近抓取”应另看 `lastFetchedAt`，查源页面更新应看 `sourceUpdatedAt`。

- `GET /api/items?sourceType=confluence&tag=samsung&includeLists=true`：返回 `{ items, ...分页信息 }`；只有带 `page` / `pageSize` 时才分页。
- `GET /api/items/:id`：返回 `{ item: { metadata, document, processedDocument, comments } }`。
- `/api/items?q=...` 及 `POST /api/search { "query": "..." }` 是列表级搜索，不保证搜到全文深处的命令。

Codex 可以检索后直接读文件回答。需要复用网页问答的上下文构建时，可调用 `POST /api/ask-context { "question": "..." }`。要求调用项目自身模型时使用 `POST /api/chat { "message": "..." }` 或 `/api/chat-stream`；这些接口按项目的模型配置、资料隔离和来源策略处理。

## 预览并导入新资料

`POST /api/preview-source`：

```json
{
  "url": "https://confluence.amlogic.com/pages/viewpage.action?pageId=123",
  "sourceType": "confluence",
  "pageKind": "content",
  "fetchMode": "fetch"
}
```

上例的 `123` 是示意值，执行时换成用户指定或搜索得到的真实页面。返回 `{ preview }`：

- `title`、`url`、`sourceType`、`rawContent`、`extractedContent`、`rawFileName`。
- `comments`、`lastFetchedAt`、`sourceUpdatedAt`、`captureMethod`。
- `parseStatus`、`parseNote`、`errorNote`、`completeness`、`coverage`、`identityEvidence`。
- `existingItem`、`pageKind`、`fetchMode`，以及列表预览的链接/订阅信息。

`existingItem` 非空表示读取了已存资料，没有重新拉取源页面。`needs-review` 表示未成功抓取，不应保存为空白成功条目。

预览成功且没有已有条目时，可以将这些字段作为 `POST /api/items` 的输入，并显式设置 `subscribe: false`。不要只保存标题和 URL 而丢弃正文、评论、完整性和抓取时间。若已有正文，项目不会再次抓取。

新增文本资料的请求：

```json
{
  "title": "BM 环境补充说明",
  "sourceType": "text",
  "rawContent": "用户提供的说明正文",
  "extractedContent": "用户提供的说明正文",
  "rawFileName": "raw.txt",
  "tags": ["samsung", "bm-test"],
  "subscribe": false
}
```

`POST /api/items` 返回 HTTP 201 和 `{ item }`。相同规范化 URL 已存在时会返回已有条目，不会覆盖；中文标题或同名标题的 ID 也可能被简化或添加后缀，始终使用返回的 `item.metadata.id`。

## 写回已经捕获的页面

`POST /api/items/upsert-capture` 根据 URL 创建或更新条目，并维护快照和索引。适用于完整浏览器捕获或直接来源 REST 捕获。

| 输入字段 | 用途 |
| --- | --- |
| `url`、`title`、`sourceType` | 真实来源身份；更新时用已确认的现有 URL |
| `rawContent` | 原始 HTML / JSON；JSON 应先序列化为字符串 |
| `extractedContent` | 已转换且核对过的可读正文 |
| `comments` | `{ id, author, createdAt, body, url }` 对象数组 |
| `fetchedAt` | 本次抓取时间的 ISO 字符串 |
| `sourceUpdatedAt` | 来源更新时间，不能拿本次抓取时间冒充 |
| `pageKind`、`fetchMode` | 通常为 `content` / `fetch`，按实际抓取方式填写 |
| `captureMethod` | 例如 `confluence-rest-rendered` |
| `completeness`、`coverage`、`identityEvidence` | 实际覆盖范围及身份依据 |
| `tags`、`subscribe` | 新建条目的标签与订阅选择 |

返回 `{ item, changed }`。更新已有条目会保留原标签、订阅选择和原始文件名；改标签需再调用 `/api/items/:id/tags`。此入口不消费 `lastFetchedAt`、`rawFileName` 或 `commentsComplete`；抓取时间用 `fetchedAt`。如果评论抓取不完整，先按评论 ID 合并旧评论，再写回，避免将旧评论清空。

当前 URL 去重没有把所有 Confluence `display/...` 与 `viewpage.action?pageId=...` 统一成 Page ID。因此来源抓取前后都要确认页面 ID，并复用已有 URL。不同空间的同名页面按各自 Page ID 保存。

`completeness` 取 `complete`、`partial` 或 `unknown`；按真实结果填写，代码/正文成功与附件二进制是否下载分开说明。普通抓取可以用 `coverage: { "observedCount": 0, "commentsFetchFailed": false, "truncated": false }`，计数必须来自实际捕获结果。

## 刷新资料、订阅和 Teams

| 方法 / 路径 | 输入 / 返回要点 |
| --- | --- |
| `POST /api/items/:id/refresh` | 非 Teams 通常同步返回 `{ item }`；Teams 返回 HTTP 202 `{ run, jobs }` |
| `GET /api/refresh-jobs` | `{ jobs }`，供选择真实任务 ID |
| `POST /api/refresh-jobs` | `{ url, title, sourceType, pageKind, fetchMode }`；创建或复用任务，返回 `{ job, jobs }` |
| `POST /api/refresh-jobs/:id/run?background=1` | 后台单任务，返回 HTTP 202 `{ run, jobs }` |
| `POST /api/refresh-jobs/run-batch` | `{ ids: [...], sourceType: "all", background: true }`；后台批量 |
| `GET /api/refresh-runs/:runId` | `{ run }`；真实运行状态、计数、错误和结果 |
| `GET /api/refresh-history?limit=20` | 持久刷新历史 |
| `POST /api/refresh-runs/:runId/teams-ready` | 用户确认 Teams 聊天主界面已就绪后调用 |

手动刷新流程：

1. 查询任务或条目，确认名称、来源 URL、用户要求的范围。
2. 明确选出 ID；批量请求的 `ids: []` 运行零个任务，并非“全部”。全部刷新也要先枚举相应 job ID。
3. 后台请求后记录 `run.id`，间隔读取状态，等待终态。`queued`、`running`、`waiting_for_teams_confirmation` 都未结束。
4. `completed`、`failed`、`canceled` 为终态。检查 `totalJobs`、`completedJobs`、`failedJobs`、`error` 及 `result`，再读回目标条目的抓取时间和覆盖情况。

当前 `/api/items/:id/refresh` 的 Teams 分支会走项目 WebDriver 刷新流程。其他订阅依据来源凭据与任务抓取方式选择 Graph、REST 或 WebDriver。Teams 主界面确认由 `/api/refresh-runs/:runId/teams-ready` 对真实窗口检查；不能把 HTTP 202 当成已捕获消息。

Confluence 普通刷新使用 storage 转换，可能覆盖此前更完整的代码提取。更新代码页面或发现 `captureMethod: "confluence-rest-rendered"` 时，按 [Confluence 参考](confluence.md) 核对并保留代码宏。订阅批量刷新也要检查此类页面的正文质量。

新订阅任务默认 `enabled: false`。用户要求周期刷新时，创建任务后局部更新设置，例如：

```json
{
  "refreshJobs": [
    { "id": "实际 job ID", "enabled": true, "intervalMinutes": 60 }
  ]
}
```

通过 `PATCH /api/settings` 提交，并读回确认；周期按用户要求，示例 60 分钟不是强制值。更新周期或其他任务字段时，显式保留该任务已有的 `enabled`，否则当前规范化逻辑可能将它停用。只提交目标任务字段，不回写带 `********` 的公开设置对象。

## 标题、标签和补充背景

- `PATCH /api/items/:id/title { "title": "..." }`。
- `PATCH /api/items/:id/tags { "tags": [...] }` 替换该条目的整个标签集合；先读并合并旧标签。
- 标签由 `src/utils.js` 规范化为小写并过滤非 ASCII 字符；使用 `bm-test` 等可稳定检索的标签。
- `PATCH /api/supplemental-context { "content": "..." }` 或 `{ "entries": [...] }` 保存补充上下文；先读旧值并合并用户要求的内容。

## 项目网页的 AI 整理能力

这些接口复用网页的处理流程。已配置项目模型时按接口调用该模型；摘要、标题、标签和分类的部分接口也有本地规则回退，`process` 则必须配置模型。与 Codex 直接读资料后自行总结相比，共用的源资料相同，生成方式可以不同。

| 方法 / 路径 | 输入及行为 |
| --- | --- |
| `POST /api/summarize` | `{ content, sourceType, title, url }`；返回 `{ summary }`，不会自动创建条目 |
| `POST /api/items/:id/process` | 无需额外正文，读取该条目进行 AI 整理并保存处理结果 |
| `POST /api/items/:id/recommend-title` | 推荐并更新该条目标题；用户要求应用推荐时调用 |
| `POST /api/items/:id/recommend-tags` | 返回该条目的标签建议；保存时再调用条目标签接口 |
| `POST /api/batch-recommend-tags` | `{ ids: [...] }`；批量标签建议 |
| `POST /api/classify-item` | `{ id, categories: [...] }`；返回单条资料分类，类别不能为空，不自动修改标签 |
| `POST /api/classify-items` | `{ ids: [...], categories: [...] }`；返回多条资料分组，不自动修改标签 |
| `POST /api/supplemental-context/suggest` | `{ existingEntries: [...] }`；建议补充背景，保存时用补充上下文接口 |

检查实际返回值并读回保存的条目。对仅生成建议的接口，不把“建议已返回”说成“已保存到资料库”。项目模型接口可能受资料隔离、来源远程 AI 策略或模型配置限制；保留返回错误，不更改用户的模型配置来绕过它。

## 请求与失败处理

使用本机地址，POST/PATCH 带 `Content-Type: application/json`。本机脚本请求通常不需要 capture token；跨站浏览器的 `upsert-capture` 配对是另一种接入方式。

遇到 HTTP 401/403、登录页、来源超时、正文为空或覆盖退化时记录真实结果并处理网络/登录条件；不要将失败内容覆盖已有正文。批量抓取可以继续独立成功项，并汇总失败与部分捕获项。写入串行执行或复用后端锁，避免在页面使用资料库时另外创建文件写入器。

本文接口以 `src/server.js` 为依据。特别检查 `previewSource`、`createItem`、`upsertCapturedItem`、`refreshItemWithContext`、`startRefreshRunByIds` 和 `normalizeRefreshJob`，不要仅凭 README 的简略 API 表推断参数。
