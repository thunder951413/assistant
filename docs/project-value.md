# 资料整理助手项目价值说明

## 项目概述

资料整理助手是一个本地运行的个人或团队知识库工具。它把分散在文本、网页、Jira、Confluence、GitHub、Teams 等来源里的资料统一导入到本地知识库中，并支持搜索、标签管理、AI 总结、AI 问答和定期刷新。

项目的核心价值是：让重要资料不再散落在聊天记录、网页标签、工单系统和临时文件里，而是沉淀成可检索、可整理、可迁移、可被 AI 使用的结构化知识资产。

## 主要功能

### 资料导入

- 支持粘贴文本、拖入文本文件、输入 URL 或粘贴网页内容。
- 支持普通网页、Jira、Confluence、GitHub、Teams 等来源类型。
- 支持导入前预览，用户可以确认标题、正文、标签和总结后再保存。
- 支持保存原始内容，方便后续追溯。

### 本地知识库管理

- 资料保存为 Markdown、JSON、JSONL 和目录结构，便于直接查看、备份和迁移。
- 支持按来源、标签、关键词浏览资料。
- 支持编辑标题、编辑标签、删除资料。
- 支持维护补充上下文，让 AI 问答更贴合个人或团队背景。

### AI 辅助整理

- 支持 AI 总结资料内容。
- 支持 AI 推荐标题和标签。
- 支持批量处理未整理资料。
- 支持对当前资料列表进行自定义分类。
- 未配置 AI 接口时，也可以使用本地检索和提取式摘要能力。

### 知识库问答

- 提供 AI 对话入口。
- 后端会先检索本地知识库，再把相关资料片段交给 AI 回答。
- 回答可以带上来源 URL、文件路径和更新时间，方便追溯依据。
- 支持 `/api/knowledge-search` 和 `/api/chat` 等接口，便于和其他工具集成。

### 页面抓取与订阅刷新

- 支持普通请求抓取，也支持通过 Webdriver 登录后抓取需要认证的页面。
- 可复用 Playwright Chromium 登录态处理内部 Jira、Confluence 等页面。
- URL 资料支持刷新，并保存刷新前快照。
- 支持订阅管理，可手动或批量刷新列表页和内容页。

### 数据导入导出

- 支持导出和导入设置。
- 支持导出和导入知识库数据。
- 数据默认保存在本地目录，避免被单一数据库或云服务锁定。

## 可以解决哪些问题

### 资料分散，难以沉淀

日常工作资料可能分布在 Jira、Confluence、GitHub、网页、聊天记录和本地文件中。资料整理助手可以把这些内容统一导入本地知识库，形成稳定的资料沉淀。

### 查找资料依赖记忆

很多资料不是找不到，而是不知道关键词、来源或具体链接。项目支持标签、来源、关键词检索，并能通过 AI 问答基于语义寻找相关内容。

### AI 问答缺少可靠上下文

直接向通用 AI 提问时，模型并不知道本地项目背景、历史资料和内部链接。资料整理助手会先检索本地知识库，再把受控上下文交给 AI，减少空泛回答。

### 内部页面需要登录，抓取困难

对于需要 Cookie、Token、Basic Auth 或网页登录态的页面，项目提供来源认证配置和 Webdriver 登录抓取能力，适合内部 Jira、Confluence、GitHub Enterprise 等场景。

### 资料更新后难以及时发现

通过订阅刷新和历史快照，项目可以帮助用户关注资料是否有新内容，减少手动反复打开页面检查的成本。

### 数据迁移和备份不方便

知识库使用文件目录、Markdown、JSON 和 JSONL 保存，既方便人工阅读，也方便 Git、网盘、脚本或其他 agent 直接处理。

## 适合的使用场景

- 个人工作资料整理。
- 项目问题、工单和会议资料沉淀。
- Jira filter、GitHub issue、Confluence 页面持续跟踪。
- 将内部资料整理为可供 AI 问答的本地知识库。
- 团队成员交接前整理背景资料、问题列表和参考链接。
- 为编码 agent 或其他自动化工具提供本地上下文。

## 安装要求

- Node.js 18 或更高版本。
- npm。
- 如果需要 Webdriver 抓取，需要安装 Playwright Chromium。
- 如果需要 AI 总结和问答，需要准备 OpenAI 兼容接口的 Base URL、API Key 和模型名。

## 安装步骤

进入项目目录：

```bash
cd /Users/surfing/tools/Assistant
```

安装依赖：

```bash
npm install
```

如果需要使用 Webdriver 抓取，安装 Chromium：

```bash
npx playwright install chromium
```

启动服务：

```bash
npm start
```

浏览器打开：

```text
http://localhost:8020
```

## 后台运行

启动后台服务：

```bash
npm run service:start
```

查看服务状态：

```bash
npm run service:status
```

重启服务：

```bash
npm run service:restart
```

停止服务：

```bash
npm run service:stop
```

后台日志位置：

```text
.config/runtime/assistant.log
```

## 初次配置建议

1. 打开 `http://localhost:8020`。
2. 进入“设置”页面。
3. 配置 AI 接口 Base URL、API Key 和模型名。
4. 确认知识库保存路径，默认是 `knowledge-base/`。
5. 如果需要抓取内部页面，在“抓取”里配置 Cookie、Token、Basic Auth 或 Webdriver 登录。
6. 在“新增资料”里导入第一条资料。
7. 回到“AI 对话”页面，基于本地资料库提问。

## 数据保存位置

默认知识库目录：

```text
knowledge-base/
```

本地设置目录：

```text
.config/
```

其中 `.config/settings.json` 可能包含 API Key、Cookie 或 Token，不建议提交到公共仓库。
