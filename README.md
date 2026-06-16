# 资料整理助手

这是一个本地资料整理助手的 MVP。它把资料保存成目录、Markdown、JSON 和 JSONL，并通过后端 API 读取本地知识库、检索相关资料、执行 AI 问答。

## 当前能力

- 新增资料独立页面：支持拖入文本文件、粘贴文本、粘贴页面内容或输入 URL。
- 新增资料会先解析预览，重点提取正文内容，用户确认标题、正文和标签后再导入。
- URL 资料可以尝试抓取网页并过滤为可读正文。
- 解析后可以生成 AI 总结；未配置 AI 接口时会使用本地提取式摘要兜底。
- 有 URL 也可以选择使用粘贴内容，适合需要登录的 Jira 或内部页面。
- 手动标签保存、编辑、按标签浏览。
- 本地搜索。
- 默认进入 AI 对话主界面：后端会读取本地 `knowledge-base/`，检索相关资料，再调用配置的 AI 接口回答。
- 提供 `/api/knowledge-search`，可通过 API 直接检索本地知识库。
- 资料整理作为独立视图，切换后显示来源、标签、搜索、列表和详情。
- 保存原始内容和历史快照。
- 设置页支持配置 OpenAI 兼容接口、模型和资料保存路径。

## 启动

前台启动：

```bash
npm start
```

后台启动和控制：

```bash
npm run service:start
npm run service:stop
npm run service:restart
npm run service:status
```

也可以直接使用脚本参数：

```bash
node scripts/service.js --start
node scripts/service.js --stop
node scripts/service.js --restart
node scripts/service.js --status
```

后台日志保存在 `.config/runtime/assistant.log`。

打开：

```text
http://localhost:8020
```

## 资料库

资料保存在：

```text
knowledge-base/
```

程序会直接读取 `knowledge-base/items/*/document.md`、`metadata.json` 和 `comments.jsonl` 做检索与问答。`knowledge-base/AGENTS.md` 仍保留给 opencode 等 agent 使用。

## 设置

设置页目前支持：

- OpenAI 兼容接口 Base URL，例如 `https://api.openai.com/v1`
- API Key
- Model
- 文档保存路径
- 页面来源认证配置

AI 总结会调用配置的 `Base URL + /chat/completions`。如果没有配置接口，应用会先使用本地提取式摘要。

AI 对话也会调用同一个 OpenAI 兼容接口。调用前，后端会先检索本地知识库，只把匹配到的资料片段、来源 URL、文件路径和更新时间交给模型；如果没有配置接口，则返回本地检索结果。

## 知识库 API

检索本地知识库：

```bash
curl -X POST http://127.0.0.1:8020/api/knowledge-search \
  -H 'Content-Type: application/json' \
  --data '{"query":"Jira 导入页面","limit":5}'
```

基于本地知识库问答：

```bash
curl -X POST http://127.0.0.1:8020/api/chat \
  -H 'Content-Type: application/json' \
  --data '{"message":"Jira 导入页面现在有什么资料？"}'
```

`/api/chat` 不依赖 agent 自主读文件。它由后端先读取 `knowledge-base/items/*`，检索相关资料，再把受控上下文交给 AI 接口。

## 页面抓取

当前内置识别这些来源：

- `confluence.amlogic.com`
- `jira.amlogic.com`
- `roku.atlassian.net`
- `github.ecodesamsung.com`

新增资料页支持两种页面类型：

- 过滤页/列表页：提取页面中的内容页链接，例如 Jira issue、GitHub issue/PR、Confluence 页面。
- 内容页：提取页面正文，后续可总结并导入知识库。

设置页的“页面来源认证”支持：

- 无认证
- Cookie：从已登录浏览器请求里复制 Cookie 请求头
- 用户名密码 / Basic：适用于服务端支持 Basic Auth 的页面
- Bearer Token：适用于 GitHub Enterprise 或其他 token 认证入口

账号密码表单登录、SSO、动态加载和无限滚动页面后续会接 webdriver adapter。

### Webdriver 登录

设置页提供“Webdriver 登录”入口。使用方式：

1. 点击对应站点，例如“打开 Amlogic Jira”。
2. 在弹出的 Chromium 窗口里手动登录。
3. 登录态会保存到 `.config/webdriver/<hostname>/`。
4. 回到新增资料页，抓取方式选择“Webdriver 抓取”。
5. 输入过滤页或内容页 URL，点击“解析预览”。

例如 Jira filter：

```text
https://jira.amlogic.com/issues/?filter=50724
```

如果已经在 webdriver 窗口登录，程序会复用该 session 抓取页面，再按 Jira filter 规则提取 issue 列表。

## 下一步

- Jira webdriver adapter。
- GitHub issue / PR adapter。
- 评论结构化提取。
- 定期刷新任务。
- AI 自动摘要和自动标签。
