---
name: assistant-knowledge-base
description: "在 Codex 中用自然语言操作本项目 Assistant，完成与网页相同的抓取、更新、资料整理和问答，共用同一后端及知识库。用于 Confluence、Teams、订阅和已有资料操作，普通代码开发无需加载。"
---

# Assistant 资料库协作

项目网页服务和 Codex 是同一套资料工具的两个操作入口：网页用按钮和表单，Codex 用自然语言指令。两边调用同一后端业务接口、读写同一知识库，完成抓取信息、更新资料、整理和根据信息回答等工作。

用户在 Codex 中说出需求后，直接执行对应操作。成功结果必须进入项目页面使用的资料库，或基于该资料库给出有来源的回答。

| 网页功能 | Codex 中的请求 | 复用的项目能力 |
| --- | --- | --- |
| 新增资料 / 抓取页面 | “抓取这些链接”“加入这段说明” | 预览、创建、捕获写回接口 |
| 订阅管理 / 立即刷新 | “更新这些订阅”“更新 Teams 内容” | 现有刷新任务和异步运行接口 |
| 资料整理 | “整理这几篇资料”“推荐标签并保存” | 条目处理、标签、标题、分类接口 |
| AI 对话 / 资料问答 | “根据库里的信息回答这个问题” | 同一知识库检索与原文；指定项目模型时调用项目问答接口 |
| 补充资料 | “记住这个项目背景供以后问答使用” | 补充上下文接口 |

## 如何调用

本 skill 位于项目的 `.agents/skills/assistant-knowledge-base/`。在这个项目中可显式调用 `$assistant-knowledge-base`，也可根据资料操作请求自动选择。示例：

- `$assistant-knowledge-base 抓取这几个 Confluence 页面并保存。`
- `搜索 Samsung 的 Tizen、eCODE、代码下载、编译和 BM test 指南，抓到资料库。`
- `更新数据库里已有的 Samsung 资料。`
- `刷新 Teams 的 BM Test 订阅，然后说明有哪些新消息。`
- `基于现有资料，整理 T6D 代码下载和编译步骤，注明来源。`
- `把这段说明加入资料库，并加上 samsung 和 bm-test 标签。`

在其他本地对话中，可让 Codex 按绝对路径读取这个 `SKILL.md` 并操作本项目。执行环境需要能访问项目文件、当前后端及相关内网/登录态；这个 skill 本身不会为云端会话建立本机连接。

## 先连接项目页面正在使用的实例

1. 从本 skill 的位置找到项目根目录；确认用户使用的页面地址或当前服务地址。开发服务默认 `http://127.0.0.1:8020`，但 `PORT` 和 Electron 启动逻辑可能使用其他端口。
2. 请求 `GET /api/agent-config`，取得 `rootDir` 和 `guidePath`。读取返回的知识库 `AGENTS.md`。以返回的 `rootDir` 为本次操作的资料根目录。
3. 将这个路径与项目页面“设置 → 存储”显示的实际资料库路径核对。开发模式通常用项目下的 `knowledge-base/`；Electron 通常用系统应用数据目录。工作树中的空目录也不能替代正在运行的资料库。
4. 复用已有服务。需要写入但服务未启动时，核对启动配置和资料路径后，从项目根目录执行 `npm run service:start`；已有服务可先用 `npm run service:status` 检查。仅需问答且已确认资料根目录时，可直接只读文件。

本项目的“数据库”是 Markdown、JSON、JSONL 组成的目录式知识库。页面和 Codex 指向同一后端、同一 `rootDir` 时共享资料、标签、评论、快照和订阅状态。通过 API 写入后，页面重新加载列表或刷新页面即可显示；页面操作完成后，Codex 下一次查询即可读到最新数据。

两个入口的对话历史各自独立：Codex 根据检索和读取的资料自行回答；项目的“AI 对话”或 `/api/chat` 使用项目配置的模型与上下文。共享资料不要求两个回答完全相同。

接口、字段、示例和异步状态见 [本地 API 与数据协议](references/local-api.md)。只加载当前操作需要的部分。

## 按用户意图选择操作

### 查询和回答

- 优先 `POST /api/knowledge-search` 做正文检索；命中位于 `results[].item`。`/api/items?q=...` 和 `/api/search` 适合列表筛选，不能代替完整正文检索。
- 按来源、标签或最近变化查询时，可先读 `indexes/by-source.json`、`by-tag.json`、`by-updated.json`。再读命中条目的 `metadata.json`、`document.md`；涉及讨论或决定时读 `comments.jsonl`。
- 通过 `/api/supplemental-context` 获取有效补充背景，或读当前资料库的 `SUPPLEMENTAL.md` / `.json`。文件不存在表示尚无补充资料。
- 根据原文回答，引用来源 URL、item ID 和可点击的本地文件。区分 `lastFetchedAt`（抓取时间）、`sourceUpdatedAt`（源更新时间）和 `updatedAt`（库内变化时间）。隔离资料默认不作为正常问答证据。
- 用户仅要求问答时，直接在 Codex 回答；用户要求保存结论时，再把结果作为独立资料通过 API 加入。

### 抓取或加入资料

- 单次抓取默认 `subscribe: false`；用户要求订阅或定期更新时再创建/启用刷新任务。
- 普通新 URL：`POST /api/preview-source`，检查正文和 `parseStatus`，再 `POST /api/items` 保存预览中的原始内容、提取正文、评论和抓取元数据。只有 `parseStatus: "ready"` 且内容确实对应目标时才能当作成功抓取。
- 预览返回 `existingItem` 时显示的是库中旧内容。需要更新时走刷新流程；再次 `/api/items` 不会覆盖相同 URL 的旧条目。
- 已在其他抓取工具或来源 REST API 中获得内容时，通过 `/api/items/upsert-capture` 写回；传入真实来源、抓取时间、评论、完整性和覆盖情况。
- 粘贴说明、总结等本地资料用 `sourceType: "text"` 创建。保留服务返回的 `item.metadata.id`，不要根据标题自行推算 ID。
- 批量抓取可保存来源清单，并报告新增、刷新、跳过和失败数量。空白页、登录页及纯目录页不当作实质正文。

Confluence 搜索、Page ID 去重和代码宏保留见 [Confluence 搜索与完整抓取](references/confluence.md)。抓取或刷新代码指南时先读它，尤其是已使用 `confluence-rest-rendered` 保存的页面。

### 更新已有资料或订阅

- 用户说“更新已有资料”时，按来源/标签/URL 找到现有条目，再用其 item ID 刷新。Confluence 的完整代码提取按上述来源参考执行。
- 用户说“更新订阅”时，先 `GET /api/refresh-jobs`，按名称、URL、来源和用户范围选择真实 job ID。单任务运行 `/api/refresh-jobs/:id/run`；多个任务运行 `/api/refresh-jobs/run-batch`。显式传入 ID 列表，空数组不会表示全部任务。
- 对耗时任务用后台运行并保留 `run.id`。读取 `/api/refresh-runs/:runId`，直到终态，再检查结果、失败数和相关资料的 `lastFetchedAt`。HTTP 202 只表示已启动。
- 创建订阅任务后检查 `enabled`。当前创建接口默认生成停用任务；要求自动刷新时还需按用户要求设置启用状态和周期。只更新目标任务字段，保留其他设置。

### Teams 同步

“更新 Teams 内容”按拉取会话资料到本地知识库执行。以现有订阅的深链接、会话名称和来源为目标，使用项目刷新流程；抓取全部消息时遵循该流程的覆盖和防退化检查。

Teams 的条目刷新也可能返回异步运行。出现 `waiting_for_teams_confirmation` 时，让用户在项目 WebDriver 窗口进入 Teams 聊天主界面，并通过项目页面确认；用户确认后也可调用 `teams-ready` 接口。任务结束前不要宣布已更新。标题不匹配、消息减少或覆盖不完整时保留错误与完整性信息，按实际范围报告。状态与接口见 [本地 API 的刷新部分](references/local-api.md#刷新资料订阅和-teams)。

### 复用网页的整理功能

用户要求项目式 AI 整理、标题/标签推荐或分类时，使用 [本地 API 的整理接口](references/local-api.md#项目网页的-ai-整理能力)，并按用户要求决定是否应用推荐结果。用户让 Codex 自行总结或整理时，可以直接读取当前资料后完成；需要让结果在网页中可见时，通过条目或补充上下文接口保存。

## 与项目页面共用数据的写入规则

- 创建、覆盖抓取、刷新、改标题、改标签、维护补充背景都优先调用同一后端 API，让项目维护索引和历史快照。直接读取文件适合检索取证；直接覆盖 `document.md`、`metadata.json` 或索引会跳过项目的事务与快照机制。
- 更新 URL 条目时传回库中确认过的 URL。Confluence 多种 URL 可以指向同一 Page ID，而当前后端主要按 URL 匹配；先按 Page ID 查已有条目，再复用其 URL。
- 用小写 ASCII 标签，例如 `samsung`、`tizen`、`ecode`、`bm-test`、`build`；当前标签规范化会过滤中文字符。改标签时先读取并合并现有标签。`upsert-capture` 不会替换已有条目的标签，需另外调用标签接口。
- 复用项目已有的来源认证。公开 `/api/settings` 只显示凭据是否配置及掩码；不要将整个公开设置写回。直接调用来源 API 确有必要时，确认运行实例的配置目录，仅在请求进程中读取对应站点的认证并构造头，不输出凭据。
- 原始文件名以 `metadata.rawFileName` 为准；扩展名为 `.html` 的内容也可能是来源 API 返回的 JSON。`completeness: "complete"` 不表示图片和附件文件已下载。

## 完成前核对

按实际任务检查即可：API 读回目标 item、确认正文/评论和来源身份、查看来源与标签索引，并用一个有辨识度的查询确认能检索到。代码页面额外核对命令块和内链；异步刷新核对运行终态及错误。

结果说明完成数量、抓取时间、主要资料或答案来源、缺失范围。图片、PDF、压缩包或脚本只保存了引用时明确说明；保留认证失败、部分捕获和跳过原因。前端“AI 整理”生成的 `processed.md` 可能已过期，使用前检查 `processedStale`。

维护本 skill 时，以项目 `src/server.js` 的路由及抓取流程、`src/item-store.js` 的存储实现、`src/utils.js` 的标签规则为依据。项目级发现位置与调用方式参考 [官方 Codex skill 文档](https://learn.chatgpt.com/docs/build-skills)。
