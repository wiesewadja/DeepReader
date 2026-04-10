# SQLite FTS5 全文检索迁移调研

> 调研日期：2026-04-10
> 状态：待定，优先级 P2（跨书搜索/全 Vault 索引时启动）

## 背景

当前 DeepReader 使用手写 BM25 实现（`src/pageindex/bm25.ts`），索引存储为 JSON 文件（`bm25.json`）。调研 FTS5 方案评估是否值得迁移。

## 当前方案 vs FTS5

| 维度 | 当前手写 BM25 | SQLite FTS5 |
|------|-------------|-------------|
| 索引存储 | `bm25.json`（JSON 明文） | SQLite FTS5 虚拟表（二进制压缩） |
| BM25 算法 | 手写 `searchBM25()` | 内置 `bm25()` 函数，标准参数 |
| 查询性能 | 全量扫倒排索引（几百章节，ms 级） | C 实现优化，百万级文档 ms 级 |
| 增量更新 | 需重建整个 JSON | 支持 INSERT/DELETE 增量更新 |
| 中文分词 | bigram + 完整词（`tokenize()`） | **痛点：内置分词器对中文支持弱** |

## 中文分词问题

FTS5 内置分词器对 CJK 的支持：

| 分词器 | 中文支持 | 说明 |
|--------|---------|------|
| `unicode61` | 差 | 逐字符分词，等于没有分词 |
| `trigram` | 可用 | 三字组合，精度差，索引体积大 |
| `porter` | 不支持 | 英语词干提取 |
| `ICU` | 好 | 正确中文分词，但需自定义编译 SQLite |

Obsidian/Electron 环境中的 `better-sqlite3` 不含 ICU 分词器，无法直接使用。

## 推荐方案：外部预分词

绕开 FTS5 中文分词限制，用 jieba 在写入前分词：

```
索引时：
  原文 → jieba 分词 → 空格连接的 token 串 → INSERT INTO fts_table

查询时：
  查询文本 → jieba 分词 → MATCH 查询 → bm25() 排名
```

技术栈选择：

| 方案 | 优点 | 缺点 |
|------|------|------|
| `better-sqlite3` | 性能最好，同步 API | 原生模块，需编译，跨平台兼容性需处理 |
| `sql.js` (WASM) | 纯 JS，兼容性好 | 性能略低，内存占用稍高 |
| `jieba` / `nodejieba` | 高质量中文分词 | `nodejieba` 是原生模块，`jieba` 是纯 JS |

## 数据模型设计（草案）

```sql
-- 每本书一个 FTS5 表
CREATE VIRTUAL TABLE fts_book_{bookId} USING fts5(
  title,           -- 章节标题（分词后）
  content,         -- 章节正文（分词后）
  summary,         -- 摘要（分词后）
  node_id UNINDEXED,
  content 'bm25()'
);

-- 元数据表
CREATE TABLE book_meta (
  book_id TEXT PRIMARY KEY,
  title TEXT,
  file_path TEXT,
  indexed_at DATETIME,
  embedding_config TEXT  -- JSON
);
```

## 迁移范围

- `src/pageindex/bm25.ts` → FTS5 查询
- `src/pageindex/book-indexer.ts` → 索引写入 SQLite 而非 JSON
- `src/pageindex/book-search-v2.ts` Stage 2 → FTS5 BM25
- `src/pageindex/book-types.ts` → 新增 SQLite 相关类型
- 新增 `src/pageindex/db.ts` — SQLite 连接管理

## 决策：暂不迁移

当前场景（单本书几百章节）下，手写 BM25 不是性能瓶颈。FTS5 的优势在**大语料库**场景才明显。

触发迁移的条件：
- [ ] 支持跨书全局搜索
- [ ] 支持整 Vault 索引（数千文档）
- [ ] 需要增量索引更新（修改单章不需要重建全书索引）
- [ ] 需要更复杂的查询（短语匹配、NEAR、列过滤）

## 参考

- [SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html)
- [unicode61 不支持 CJK 的原因](https://stackoverflow.com/questions/52422437/why-sqlite-fts5-unicode61-tokenizer-does-not-support-cjkchinese-japanese-korean)
- [跨平台 FTS 模块开发经验](https://dev.to/craftzdog/making-a-full-text-search-module-that-works-on-both-desktop-and-mobile-pt-1-1n9i)
- [Obsidian 插件集成 SQLite](https://forum.obsidian.md/t/adding-sqlite-database-integration-to-an-obsidian-plugin/88272)
- [VaultSearch - Obsidian 本地混合搜索插件](https://forum.obsidian.md/t/vaultsearch-local-first-hybrid-search-bm25-semantic-fuzzy/113134)
