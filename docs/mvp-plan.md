# 资料整理助手 MVP 计划

## 当前决策

- 本地 Web 应用。
- 主资料库存储为目录、Markdown、JSON、JSONL，方便 opencode 直接读取。
- SQLite 暂不作为主存储，后续只作为索引或性能层。
- Jira 第一版按特殊网页处理，后续可以增加 API 或 webdriver adapter。
- 标签第一版只支持保存、编辑、查找和分类显示，AI 自动标签后续接入。

## 资料库目录协议

```text
knowledge-base/
  AGENTS.md
  items/
    <item-id>/
      document.md
      metadata.json
      comments.jsonl
      raw.html | raw.txt
      snapshots/
  tags/
    <tag>.json
  indexes/
    by-tag.json
    by-source.json
    by-updated.json
```

## 统一来源接口

```ts
interface SourceAdapter {
  canHandle(input: SourceInput): boolean
  fetch(input: SourceInput): Promise<RawSource>
  extract(raw: RawSource): Promise<ExtractedSource>
  refresh(itemId: string): Promise<ExtractedSource>
}
```

## 第一版能力

- 新增文本资料。
- 新增普通网页资料。
- 新增 Jira URL 资料。
- 新增 GitHub URL 资料。
- 手动标签。
- 按标签、来源、关键词浏览。
- URL 资料手动刷新并保存历史快照。
- opencode 可直接读取 `knowledge-base/AGENTS.md` 和资料目录做问答。

## 后续增强

- GitHub issue / PR API adapter。
- Jira webdriver adapter。
- 评论区结构化提取。
- 定期刷新任务。
- AI 自动摘要、标签、行动项、阻塞点。
- 向量索引或 SQLite 加速层。
