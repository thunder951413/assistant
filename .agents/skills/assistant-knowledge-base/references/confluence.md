# Confluence 搜索与完整抓取

用于用户指定 Confluence 页面、搜索一组主题并入库、刷新代码指南。项目内置 REST 抓取适合普通页面；涉及代码宏、内部页面引用或渲染内容时，需要另外核对可读正文。

## 连接和认证

先按主 skill 确认项目页面的 `apiBase`、资料库根目录和运行实例。优先通过项目 `/api/preview-source` 或刷新接口复用来源认证。

当前项目没有对外提供 Confluence CQL 搜索接口。需要站内搜索时，可以使用已登录浏览器的搜索，或直接访问该站点 REST API。直接 REST 请求只在请求进程中读取活动配置的 `sources[hostname]`，按 `authMode` 构造 Basic、Bearer 或 Cookie 头；对应逻辑见 `src/server.js` 的 `buildAuthHeaders`。公开设置的掩码不是可用凭据。不要输出整个配置、认证头或认证值。

站点、空间和认证以用户来源为准；以下示例以本项目已有的 `https://confluence.amlogic.com` 为 origin。

## 搜索候选页面

站内 REST 查询：

```text
GET /rest/api/content/search
    ?cql=<经过 URL 编码的查询>
    &expand=space,version
    &limit=100
```

例如三星工作资料的两种候选查询：

```text
type = page AND (title ~ "Samsung" OR title ~ "Tizen" OR title ~ "eCODE" OR title ~ "BM")
```

```text
type = page AND (text ~ "Samsung" OR text ~ "Tizen" OR text ~ "ecode") AND (title ~ "download" OR title ~ "build" OR title ~ "编译" OR title ~ "代码" OR title ~ "GBS" OR title ~ "setup")
```

用 `URLSearchParams` 编码 CQL。检查 `results`、`size`、`totalSize` 和 `_links.next`，按需要翻页；把下一页解析到已确认的同一 origin。若只审阅了部分结果，在清单里记录查询总数、已读数量和分页范围，不宣称已穷尽站点。

按用户主题、页面正文和关联链接筛选：指南、下载/编译步骤、环境安装、测试方法优先。查看核心指南直接引用的关键操作页面，补足流程。日报、无关产品和空白页是否纳入取决于用户范围。

## 先按 Page ID 对齐已有数据

Confluence 同一页面常见 URL：

- `/display/<spaceKey>/<title>`。
- `/pages/viewpage.action?spaceKey=...&title=...`。
- `/pages/viewpage.action?pageId=...`。

站内搜索结果提供 `id`。标题 URL 可以用 `/rest/api/content?type=page&spaceKey=...&title=...&limit=1` 查到 ID。读取原始页面 JSON 的 `id`、正文中的 `Page ID:` 或 `metadata.identityEvidence.confluencePageId`，建立当前资料库的 Page ID → item ID / URL 映射。

如果 Page ID 已存在，写回时使用该条目已保存的 URL；仅改变 URL 格式再创建会产生重复条目。不同空间的同名页面用各自 Page ID 区分。页面 ID 不明或对应关系冲突时先查来源，不能靠同名猜测并覆盖。

## 保留命令和页面引用

完整页面请求：

```text
GET /rest/api/content/<pageId>
    ?expand=body.storage,body.view,version,space,metadata.labels,ancestors
```

- `body.storage.value` 是 Confluence 存储 HTML，含 `ac:structured-macro`、`ac:plain-text-body`、`ri:page`、`ri:attachment` 等特殊结构。
- 当前项目 `fetchConfluenceFromApi` 主要请求 storage；`confluenceHtmlToMarkdown` 处理普通 HTML 与 `<pre>`，不能保证正确提取所有 storage 宏。可能出现语言名称还在、实际命令或内链缺失的情况。
- 转换 `body.view.value` 可获得渲染后的代码和链接。页面主体中的命令块应保留为代码围栏，保持换行、缩进和字符；标题、列表、表格及内链应保留可读结构。把相对链接转为绝对来源链接。
- 原始 JSON 同时保留 storage、view、页面 ID、版本和源更新时间。处理 DOM 时不执行页面脚本，移除脚本/样式文本，避免把宏样式表当正文。
- 验证每个非空渲染代码块的原文都出现在保存的正文中，并检查关键下载/编译命令和引用链接。更新已有资料时也做这个检查，避免用丢失宏的普通刷新结果覆盖完整指南。

如果无法得到 view，可解析 storage 中的代码 CDATA 和 `ri:page` 引用，或使用已登录页面提取渲染内容。按真实缺失范围记录 `partial` / `unknown`，不要只凭 HTTP 成功标记完全捕获。

## 评论与资源范围

评论请求可使用：

```text
GET /rest/api/content/<pageId>/child/comment
    ?limit=200&expand=body.storage,body.view,version
```

检查分页；该集合未拉完或请求失败时记录实际覆盖情况。标准评论为 `{ id, author, createdAt, body, url }`，body 应是可读正文。用户要求完整讨论时还要核对回复层级，不把顶层评论集合自动视为整棵讨论树。

原文中的图片、PDF、压缩包、补丁和安装脚本是独立资源。只保留链接时在结果中说明；下载附件本体与提取 PDF/图片内容按用户要求和所需信息另行处理。目录宏或纯子页面列表应找到具体指南，不将空正文算作有效抓取。

## 写回项目并验证

按 [本地 API 协议](local-api.md#写回已经捕获的页面) 构造输入：

- `sourceType: "confluence"`，title、url、page ID、源版本来自真实来源。
- `rawContent` 为包含 storage/view 的原始 JSON 字符串，`extractedContent` 为核对过的正文，`comments` 为实际捕获评论。
- `fetchedAt` 为本次抓取时间，`sourceUpdatedAt` 为 `page.version.when`。
- `captureMethod: "confluence-rest-rendered"` 标记这个提取方式；`identityEvidence` 可记录 `confluencePageId` 和 `confluenceVersion`。
- `coverage` 记录评论数量、分页/失败状态，并可记录代码块和图片引用数量。完整性标志描述捕获情况，不暗示附件文件已经下载。

新页面可用 `/api/items` 并指定 `rawFileName: "raw.json"`、`lastFetchedAt`、`subscribe: false`。已有页面用 `/api/items/upsert-capture`，抓取时间字段为 `fetchedAt`；保留库中 URL。评论不完整时先合并旧评论；需要追加标签时另外调用标签接口。

读回 item 和文件，核对 Page ID、版本、正文、代码块、评论、`lastFetchedAt`、来源索引和重复条目，再做有辨识度的正文检索。批量操作记录原文 URL、本地路径、处理结果和跳过/失败原因；只验证已保存的实际结果，不把“发现了链接”报告为“已入库”。
