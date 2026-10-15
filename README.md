# 资料整理助手

资料整理助手是一个本地运行的知识库整理与问答工具。它可以导入文本、网页、Jira、Confluence、GitHub 等资料，把内容保存为目录、Markdown、JSON 和 JSONL，并通过本地检索与 OpenAI 兼容接口完成总结、标签推荐、批量整理和资料库问答。

项目当前定位为 MVP：优先保证资料可被直接读取、迁移和备份，前端与后端都运行在本机。

## 功能特性

- 本地 Web 应用，默认监听 `127.0.0.1:8020`。
- AI 对话：后端先检索本地知识库，再把匹配片段交给模型回答。
- 资料导入：支持粘贴文本、拖入文本文件、输入 URL、粘贴网页内容。
- 网页抓取：支持普通网页、Jira、Confluence、GitHub、Teams 等来源类型。
- Webdriver 抓取：可用 Playwright Chromium 登录需要认证的页面，并复用登录态抓取。
- API-first 抓取：Jira、Confluence、GitHub Enterprise 和 Teams 在凭据允许时优先使用官方 API，HTML/WebDriver 作为回退。
- 资料预览：导入前可确认标题、正文、标签和 AI 总结。
- 资料管理：按来源、标签、关键词浏览，支持详情查看、标题编辑、标签编辑、删除。
- AI 整理：支持生成标题、正文整理、标签推荐、列表分类和批量处理。
- 订阅刷新：可为列表页或内容页创建刷新任务，并保存历史快照。
- 补充资料：维护额外上下文，并可让 AI 分析候选补充项。
- 导入导出：支持设置导入导出、知识库数据导入导出。
- Embedding 配置：可启用 OpenAI 兼容 embedding 接口作为检索增强配置。
- 数据完整性保护：Teams 会话标题校验、评论/消息数量防退化、异常资料隔离。
- 存储治理：内容真正变化后才保存快照，每条资料最多保留最近 20 个版本；快照中的原始抓取内容 gzip 压缩存储，提交新版本时历史快照以硬链接复用、不重复拷贝。
- 浏览器缓存治理：WebDriver 浏览器磁盘缓存上限 100 MB，启动前自动修剪超过 512 MB 的缓存；设置页可一键清理缓存且保留 Cookie、本地存储等登录状态。

## 技术栈

- Node.js 18+
- 原生 `node:http` 后端
- 原生 HTML / CSS / JavaScript 前端
- Playwright，用于 Webdriver 登录和页面抓取
- Node 内置测试框架 `node:test`

## 目录结构

```text
.
├── src/
│   ├── server.js            # 组合根：配置、ctx 依赖对象、各服务工厂的装配、API 路由与启动
│   ├── item-service.js      # 资料的新增、更新、去重与列表/详情视图
│   ├── item-store.js        # 资料读写、事务提交（硬链接暂存）、带缓存的批量读取与按 URL 查找、索引重建
│   ├── refresh-jobs.js      # 订阅（刷新任务）的增删改、列表子项清理、凭据可用性判断
│   ├── refresh-runner.js    # 刷新调度、并发与运行状态
│   ├── refresh-capture.js   # 单次刷新抓取：选择 API 或 WebDriver、合并与写入
│   ├── list-membership.js   # 列表/搜索订阅的成员跟踪
│   ├── knowledge-search.js  # 知识库检索与问答上下文
│   ├── ai-actions.js / ai-processing.js            # AI 整理、摘要等动作与批处理
│   ├── tags-service.js / topics-service.js / topics.js # 标签、主题（关注标签）、主题摘要与预览
│   ├── supplemental.js      # 补充资料（术语表、笔记等）
│   ├── settings-service.js / settings-store.js     # 设置读写；配置与运行时任务状态分文件、合并写入
│   ├── settings-schema.js   # 设置、刷新任务、来源配置的默认值与规范化
│   ├── source-urls.js / data-maintenance.js        # 来源 URL 识别与启动时的数据迁移
│   ├── app-bundle.js        # 拼接 public/app/ 前端脚本，并为 index.html 生成内容哈希版本号
│   ├── retrieval.js         # 检索分词、关键词打分、结果多样化、向量与上下文片段
│   ├── storage-maintenance.js # 快照压缩与裁剪、WebDriver 浏览器缓存清理
│   ├── ai-client.js / ai-policy.js / ai-local.js  # 模型请求、出站策略、无模型时的本地兜底
│   ├── capture-policy.js / capture-utils.js        # 抓取完整性、Teams 合并、调度时间窗
│   ├── atomic-files.js / bundle-store.js           # 原子写入、数据导入导出
│   ├── api-security.js / router.js / http-utils.js # 本机接口校验、路由、响应工具
│   ├── text-helpers.js / fs-helpers.js / utils.js  # 通用文本与文件工具
│   ├── webdriver/
│   │   ├── sessions.js      # 浏览器会话的启动、复用与并发保护
│   │   ├── auth.js          # 登录状态检测与登录流程
│   │   └── fetch.js         # 通过 WebDriver 抓取页面
│   └── sources/
│       ├── api-fetch.js          # GitHub / Jira 等 API 抓取
│       ├── github-issue-search.js # GitHub issue 搜索订阅
│       ├── teams-chatsvc.js      # Teams 消息接口
│       ├── html-extractors.js    # Jira、Confluence、GitHub、通用网页的 HTML 解析
│       ├── confluence-comments.js # Confluence 评论分页与回复
│       ├── github-pull.js        # GitHub PR 评论、review、行内 review 评论
│       ├── github-page.js        # GitHub 页面展开（WebDriver）
│       └── teams-page.js         # Teams 网页会话定位、滚动与消息提取（WebDriver）
├── public/
│   ├── index.html       # 前端页面
│   ├── app/             # 前端交互逻辑，按功能分成有序的多个文件（01-…20-），服务端按文件名顺序拼成 /app.js
│   └── styles.css       # 页面样式
├── desktop/
│   └── main.js          # Electron 桌面应用入口
├── scripts/
│   ├── service.js       # 后台服务启停脚本
│   ├── check.mjs        # npm run check：所有脚本及拼接后前端的语法检查
│   └── install-playwright-browsers.js
├── test/                # node:test 测试：工具函数、存储、检索、抓取适配、HTTP 行为、UI 流程
├── test-support/        # 测试专用预加载脚本
├── docs/
│   └── mvp-plan.md      # MVP 设计记录
├── knowledge-base/      # 开发模式默认知识库目录，已被 git 忽略
├── .config/             # 开发模式本地设置、运行日志、Webdriver session，已被 git 忽略
├── package.json
└── README.md
```

## 安装

```bash
npm install
```

如果使用 Webdriver 抓取，首次安装后可能需要安装 Playwright 浏览器：

```bash
npx playwright install chromium
```

打包桌面应用时使用仓库内的浏览器资源目录：

```bash
npm run browsers:install
```

## 启动

前台启动：

```bash
npm start
```

打开浏览器访问：

```text
http://localhost:8020
```

可以通过 `PORT` 指定端口：

```bash
PORT=8030 npm start
```

## 后台服务

后台启动、停止、重启和查看状态：

```bash
npm run service:start
npm run service:stop
npm run service:restart
npm run service:status
```

也可以直接调用脚本：

```bash
node scripts/service.js --start
node scripts/service.js --stop
node scripts/service.js --restart
node scripts/service.js --status
```

后台运行文件：

```text
.config/runtime/assistant.pid
.config/runtime/assistant.log
```

## 桌面应用与发布

本项目可以打包为 Electron 桌面应用，并随包提供 Playwright Chromium：

```bash
npm run pack:mac
npm run dist:mac
npm run dist:win
npm run dist:linux
```

`pack:mac` 会生成未压缩的 `.app` 目录用于本机验证。`dist:mac` 会生成 `dmg` 和 `zip`，`dist:win` 会生成 Windows 安装包和 `zip`，`dist:linux` 会生成 `AppImage` 和 `deb`。默认 macOS 脚本会跳过自动签名，避免本机钥匙串弹窗或 CI 没有证书时卡住；如果已配置签名证书，可运行：

```bash
npm run dist:mac:signed
```

GitHub 发布通过 `.github/workflows/release.yml` 完成。推送 `v*` tag 后，Actions 会在对应系统 runner 上安装该平台的 Playwright Chromium，并构建 macOS arm64、macOS x64、Windows x64 和 Linux x64 包后创建 Release：

```bash
git tag v0.1.2
git push origin v0.1.2
```

桌面应用的设置、知识库、运行缓存和 Webdriver 登录态默认写入系统应用数据目录，不会写入仓库：

```text
~/Library/Application Support/material-organizer/
```

## 配置

首次启动会生成本地配置：

```text
.config/settings.json
```

桌面应用会改为写入系统应用数据目录：

```text
~/Library/Application Support/material-organizer/config/settings.json
```

也可以在页面的“设置”里维护这些配置：

- AI：OpenAI 兼容 `Base URL`、`API Key`、`Model`。
- 抓取：页面来源认证、Cookie、Bearer Token、Basic Auth、Webdriver 登录入口。
- 标签：新增、选择、删除标签。
- 存储：知识库保存路径、设置导入导出、数据导入导出。
- 提醒：资料更新提醒来源、刷新时间窗口。
- Embedding：OpenAI 兼容 embedding 接口、模型和维度。

AI 接口会调用：

```text
<baseUrl>/chat/completions
```

如果没有配置 AI 接口，应用仍可导入资料，并在问答或总结场景返回本地检索结果或本地提取式摘要。

如果 Base URL 指向远程服务，问答、总结、标题、标签、Embedding 和资料整理会把相关资料片段发送到该服务。首页与设置页会明确显示“远程 AI”；资料文件本身仍保存在本机。

## 知识库存储

开发模式默认资料库路径：

```text
knowledge-base/
```

桌面应用默认资料库路径：

```text
~/Library/Application Support/material-organizer/knowledge-base/
```

可以在设置页修改为其他本地目录。资料会按以下协议保存：

```text
knowledge-base/
├── AGENTS.md
├── supplemental-context.md
├── supplemental-context.json
├── items/
│   └── <item-id>/
│       ├── document.md
│       ├── metadata.json
│       ├── comments.jsonl
│       ├── raw.html 或 raw.txt
│       └── snapshots/
├── tags/
│   └── <tag>.json
└── indexes/
    ├── by-tag.json
    ├── by-source.json
    └── by-updated.json
```

核心文件说明：

- `document.md`：可读正文，包含元信息、整理内容和总结。
- `metadata.json`：标题、来源、URL、标签、刷新任务、更新时间等结构化信息。
- `comments.jsonl`：评论、时间线或讨论内容。
- `raw.html` / `raw.txt`：原始抓取或导入内容。
- `snapshots/`：刷新前的历史快照。
- `supplemental-context.md` / `.json`：问答时额外注入的补充上下文。

## 使用流程

1. 启动服务并打开 `http://localhost:8020`。
2. 在“设置”里配置 AI 接口和资料保存路径。
3. 在“新增资料”里粘贴文本、拖入文件或输入 URL。
4. 点击解析预览，确认标题、正文、标签和总结。
5. 点击确认导入，资料会写入知识库目录。
6. 在“资料整理”里搜索、筛选、编辑标签或批量处理。
7. 在“AI 对话”里基于本地资料库提问。

## 在 Codex 中使用项目

项目网页和 Codex 是同一套资料工具的两个操作入口：网页用按钮和表单，Codex 用自然语言。项目内置 [assistant-knowledge-base skill](.agents/skills/assistant-knowledge-base/SKILL.md)，让 Codex 复用同一后端和当前知识库，完成抓取、更新、资料整理和问答。在本项目的 Codex 对话中可以调用：

```text
$assistant-knowledge-base 搜索 Samsung 的 Tizen、eCODE、代码下载、编译和 BM test 指南，抓到资料库。
$assistant-knowledge-base 更新 Teams 的 BM Test 订阅，并说明新增内容。
$assistant-knowledge-base 基于已有资料整理 T6D 下载与编译步骤，注明来源。
```

Codex 会先确认页面使用的后端地址，并通过 `/api/agent-config` 获取实际资料库目录；创建、刷新和编辑通过同一后端 API 完成。写入后重新加载项目页面即可看到，页面新增的资料也可直接供 Codex 检索。两个对话入口的消息历史和使用的模型各自独立。

开发服务与 Electron 应用可能使用不同端口和存储目录，不能仅凭仓库中存在 `knowledge-base/` 就认定它是当前资料库。skill 还包含 Confluence 页面 ID 去重、代码块保留，以及 Teams 异步刷新与登录确认的操作说明。

## Webdriver 登录抓取

对于需要登录、SSO 或动态渲染的页面，可以使用 Webdriver 抓取：

1. 进入“设置”。
2. 在“抓取”里点击对应站点的 Webdriver 登录入口。
3. 在弹出的 Chromium 窗口中手动登录。
4. 开发模式登录态会保存到 `.config/webdriver/<hostname>/`；桌面应用会保存到系统应用数据目录的 `config/webdriver/<hostname>/`。
5. 回到“新增资料”，抓取方式选择“Webdriver 抓取”。
6. 输入过滤页或内容页 URL，点击解析预览。

默认内置来源包括：

- `confluence.amlogic.com`
- `jira.amlogic.com`
- `roku.atlassian.net`
- `github.ecodesamsung.com`
- `teams.microsoft.com`

抓取优先级：

1. Jira REST、Confluence REST、GitHub Enterprise REST 或 Microsoft Graph。
2. 带认证头的普通 HTTP 抓取。
3. 需要动态渲染、SSO 或页面展开时使用 WebDriver。

Teams 使用 Bearer Token 时会尝试 Microsoft Graph；否则使用 WebDriver。Teams 刷新会校验实际会话标题，不匹配时阻止覆盖。可运行以下命令检查或隔离旧的串线资料：

```bash
node scripts/report-teams-title-mismatches.js
node scripts/report-teams-title-mismatches.js --quarantine
```

设置页“存储”中会显示知识库、历史快照和 WebDriver 登录数据的占用（含可清理的浏览器缓存），并可：

- 清理并压缩旧快照：删除超过最近 20 个版本的快照，并压缩旧版本遗留的未压缩原始文件。
- 清理浏览器缓存（保留登录）：删除各站点浏览器的页面缓存、脚本缓存、Service Worker 缓存和着色器缓存；Cookie、Local Storage、IndexedDB 保留，正在使用的浏览器会跳过。

## 订阅刷新

导入 URL 资料后，系统会为列表页或内容页创建刷新任务。可以在“订阅管理”里：

- 查看刷新任务。
- 手动刷新单个任务。
- 批量刷新所有或指定来源任务。
- 删除任务或删除任务导入的资料。

刷新时会保存原资料快照，并根据来源更新时间判断是否出现新内容。

## API 示例

检索知识库：

```bash
curl -X POST http://127.0.0.1:8020/api/knowledge-search \
  -H 'Content-Type: application/json' \
  --data '{"query":"Jira 导入页面","limit":5}'
```

基于知识库问答：

```bash
curl -X POST http://127.0.0.1:8020/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"Jira 导入页面现在有什么资料？"}'
```

流式问答：

```bash
curl -N -X POST http://127.0.0.1:8020/api/chat-stream \
  -H 'Content-Type: application/json' \
  --data '{"message":"最近有哪些资料更新？"}'
```

预览来源：

```bash
curl -X POST http://127.0.0.1:8020/api/preview-source \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://example.com","sourceType":"web","fetchMode":"auto"}'
```

导出数据：

```bash
curl -o assistant-data.json http://127.0.0.1:8020/api/export/data
```

常用接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/items` | 查询资料列表 |
| `POST` | `/api/items` | 创建资料 |
| `GET` | `/api/items/:id` | 查看资料详情 |
| `DELETE` | `/api/items/:id` | 删除资料 |
| `PATCH` | `/api/items/:id/title` | 修改标题 |
| `PATCH` | `/api/items/:id/tags` | 修改标签 |
| `POST` | `/api/items/:id/refresh` | 刷新 URL 资料 |
| `POST` | `/api/items/:id/process` | AI 整理资料 |
| `POST` | `/api/items/:id/recommend-title` | AI 推荐标题 |
| `POST` | `/api/items/:id/recommend-tags` | AI 推荐标签 |
| `GET` | `/api/tags` | 查询标签 |
| `POST` | `/api/tags` | 新增标签 |
| `PATCH` | `/api/tags` | 重命名标签 |
| `DELETE` | `/api/tags` | 删除标签 |
| `POST` | `/api/search` | 本地搜索 |
| `POST` | `/api/knowledge-search` | 知识库检索 |
| `POST` | `/api/chat` | 知识库问答 |
| `POST` | `/api/chat-stream` | 流式知识库问答 |
| `GET` | `/api/settings` | 获取公开设置 |
| `PATCH` | `/api/settings` | 保存设置 |
| `GET` | `/api/export/settings` | 导出设置 |
| `POST` | `/api/import/settings` | 导入设置 |
| `GET` | `/api/export/data` | 导出知识库数据 |
| `POST` | `/api/import/data` | 导入知识库数据 |
| `GET` | `/api/refresh-jobs` | 查询刷新任务 |
| `POST` | `/api/refresh-jobs/:id/run` | 运行单个刷新任务 |
| `POST` | `/api/refresh-jobs/run-batch` | 批量运行刷新任务 |
| `GET` | `/api/supplemental-context` | 获取补充上下文 |
| `PATCH` | `/api/supplemental-context` | 保存补充上下文 |
| `POST` | `/api/supplemental-context/suggest` | AI 建议补充上下文 |
| `GET` | `/api/webdriver/status` | 查看 Webdriver session |
| `POST` | `/api/webdriver/open` | 打开 Webdriver 登录窗口 |
| `POST` | `/api/webdriver/fetch` | 使用 Webdriver 抓取页面 |

## 开发与检查

语法检查：

```bash
npm run check
```

运行测试：

```bash
npm test
```

测试覆盖工具函数、资料存储事务与缓存、快照与浏览器缓存清理、检索排序与过滤、Confluence/GitHub 抓取适配、Teams 合并与会话识别，以及在临时目录中启动真实服务的 HTTP 行为测试（含模拟模型服务）。

## 注意事项

- 本项目面向本地使用，默认只监听 `127.0.0.1`。
- `.config/settings.json` 可能包含 API Key、Cookie 或 Token，不要提交到公共仓库。
- `knowledge-base/` 是默认数据目录，迁移前建议使用页面内“导出数据”功能备份。
- Webdriver 登录态保存在 `.config/webdriver/`，如果登录状态异常，可以删除对应 hostname 目录后重新登录。
- 页面抓取对站点 HTML 结构有依赖，遇到复杂动态页面时优先使用 Webdriver 抓取。
