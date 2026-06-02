# 索引引擎（F-01 ~ F-04）

> PDF/EPUB 是不可搜索的黑盒。索引是把死文件变成活知识的第一步。
> 知识只有进入 Obsidian 工作流才有价值。

---

## F-01: 索引 PDF 书籍

- **为什么存在**: PDF 是不可搜索的黑盒。用户在 Obsidian 里只能看 PDF，不能搜、不能问、不能引用。索引是把死文件变成活知识的第一步。
- **用户故事**: 作为读者，我希望把 PDF 文件交给 DeepReader，3 分钟内能搜到里面的内容
- **前置条件**: 已配置 LLM API Key（任一 provider）；扫描件需启用 OCR（API 或本地 poppler）
- **输入**: 一个 PDF 文件（任意大小；文本型/扫描型均可）
- **输出**:
  - `.pageindex/{bookId}/book-meta.json` + `tree.json` + `bm25.json`（+ `vectors.jsonl` 若启用 embedding）
  - Library 视图出现该书
  - 若开启自动导出：`DeepReader/{书名}/` 目录下生成章节 Markdown
- **验收标准**:
  - [ ] 100 页文本型 PDF 在 LLM API 正常时 < 3 分钟完成
  - [ ] 100 页扫描型 PDF 启用 OCR 时 < 10 分钟完成
  - [ ] 失败时显示进度卡 + 可重试
  - [ ] 同一文件二次索引命中缓存（< 5s 完成，不重新调 LLM）
  - [ ] Book ID 基于内容哈希生成（文件移动/重命名后 ID 不变）
  - [ ] 索引过程控制台无 error 级别日志
  - [ ] 索引完成后 sidebar 中可搜到该书内容
- **对应测试**:
  - 单元: `tests/unit/pageindex/book-indexer.test.ts`、`book-id-migration.test.ts`、`path-migration.test.ts`、`chunker.test.ts`、`parsers/mineru.test.ts`、`index-tracer.test.ts`
  - E2E: `tests/e2e/specs/pdf-parsing.e2e.ts`、`pdf-index-export.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.1

---

## F-02: 索引 EPUB 书籍

- **为什么存在**: 同 F-01，覆盖第二大电子书格式。用户不应因为文件格式不同而被挡在门外。
- **用户故事**: 作为读者，我希望把 EPUB 文件交给 DeepReader，能像 PDF 一样被搜索和提问
- **前置条件**: 已配置 LLM API Key
- **输入**: 一个 EPUB 文件
- **输出**: 同 F-01，目录结构一致
- **验收标准**:
  - [ ] 标准 EPUB 2/3 格式 < 1 分钟完成
  - [ ] 包含图片/表格的 EPUB 能正确提取章节结构
  - [ ] EPUB 章节切分边界正确（不切断段落）
  - [ ] 失败时显示进度卡 + 可重试
  - [ ] 同一文件二次索引命中缓存
  - [ ] 索引过程无 error 日志
- **对应测试**:
  - 单元: `tests/unit/pageindex/epub-splitting.test.ts`
  - E2E: `tests/e2e/specs/epub-parsing-quality.e2e.ts`、`epub-user-flow.e2e.ts`、`epub-index-export.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.1

---

## F-03: 索引 Markdown 文件

- **为什么存在**: 用户的笔记本身也是知识源。纳入索引后，AI 能同时检索书籍和用户已有笔记，建立关联——这是渐进理解用户的基础。
- **用户故事**: 作为用户，我希望把已有的 Markdown 笔记也纳入 DeepReader 的搜索范围
- **前置条件**: 已配置 LLM API Key
- **输入**: 一个或多个 `.md` 文件
- **输出**: `.pageindex/{bookId}/` 索引文件 + Library 视图收录
- **验收标准**:
  - [ ] 含 YAML frontmatter 的 MD 文件能正确解析标题
  - [ ] 包含 `[[wiki-link]]` 的 MD 文件保留链接关系
  - [ ] 大文件（> 10000 行）能分段索引
  - [ ] 失败时显示进度卡 + 可重试
  - [ ] 索引过程无 error 日志
- **对应测试**:
  - 覆盖状态: ⚠️ 间接（由 F-01/F-04 间接覆盖）
- **详见**: product-manual §2.1.2

---

## F-04: 索引导出为 Obsidian 笔记

- **为什么存在**: 知识只有进入 Obsidian 工作流才有价值。导出后章节变成可搜索、可链接、可引用的 Obsidian 原生内容。
- **用户故事**: 作为用户，我希望索引完成后，章节内容自动出现在 Vault 里，能用 Obsidian 的搜索/链接
- **前置条件**: F-01/F-02/F-03 已完成索引；设置中开启"自动导出"
- **输入**: 已索引的书籍
- **输出**:
  - `DeepReader/{书名}/章节-{N}-{章节名}.md` 文件
  - 每章含 YAML frontmatter（书名、章节号、bookId、tags）
  - 包含 `^block-ref` 锚点供反向引用
- **验收标准**:
  - [ ] 每章生成独立 MD 文件
  - [ ] 章节文件能用 Obsidian 搜索到
  - [ ] 文件包含正确的 frontmatter
  - [ ] 块引用锚点可被 LangGraph 工具使用
  - [ ] 重新导出不会产生重复文件
  - [ ] 失败的单章不影响其他章节导出
- **对应测试**:
  - 单元: `tests/unit/pageindex/asterisk-fix.test.ts`
  - E2E: `tests/e2e/specs/pdf-index-export.e2e.ts`、`epub-index-export.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.1
