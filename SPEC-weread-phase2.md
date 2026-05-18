# SPEC: 用户标注统一体系 — Phase 2

> 状态：**评审中** | 依赖：Phase 1 已合并 | 更新日期：2026-05-18

---

## 1. 目标

将 DeepReader 原生标注（摘录、高亮）和微信读书标注（高亮、笔记、书评）统一为一套体系，让 Agent 在对话中能感知和引用用户自己的标注，并将"用户标注"视为高优先级上下文。

### 1.1 核心原则

- 用户标注 = 用户关注点。Agent 搜索时，标注命中应与书籍内容命中同等可见。
- 不建独立的标注索引或搜索工具——融入现有 `search_book`。
- 不建独立的渲染层——微信读书高亮导入为 DeepReader 原生 `<mark>` 标签。
- 不区分标注来源和类型——所有标注统一为"用户标注"。

### 1.2 数据现状

所有用户标注（无论来源）都存在于 `书籍摘录/{书名}/` 目录下：

| 来源 | 文件 | callout 格式 |
|------|------|-------------|
| DeepReader 高亮 | `摘录-{date}.md` | `> [!warning]+ 🟡 高亮` |
| DeepReader 摘录 | `摘录-{date}.md` | `> [!quote]+` / `[!note]+` 等（随机） |
| 微信读书高亮 | `{书名}.md` | `> [!quote]+ 🟡 高亮` |
| 微信读书想法/书评 | `{书名}.md` | `> [!note]+ 💬 想法/书评` |

### 1.3 前置依赖

| 依赖项 | 状态 | 位置 |
|--------|------|------|
| 微信读书同步引擎 | 已完成 | `src/weread/sync/sync-engine.ts` |
| 书籍关联匹配 | 已完成 | `src/weread/sync/matcher.ts` |
| 同步状态 + 映射 | 已完成 | `.pageindex/weread/mapping.json` |
| ExcerptService | 已完成 | `src/services/excerpt-service.ts` |
| 高亮保存（`<mark>` 写入） | 已完成 | `src/main.ts` `saveHighlightToFile` |
| Library View 集成 | 已完成 | `wereadMappingCache` + 徽章 |

---

## 2. 三个功能

### 功能 1：统一标注搜索（融入 `search_book`）

**目标**：Agent 搜索书籍内容时，同时搜到用户标注，结果区分为"书的内容"和"用户标注"。

**验收标准**：
- `search_book("机器学习")` 的结果中，既有书籍原文命中，也有用户标注命中
- 每条结果标注来源：`[书籍内容]` 或 `[用户标注]`

**技术方案**：

1. **修改 `search_book` 搜索逻辑**（`src/agent/tools/local/search-text.ts`）

   在现有三路检索（BM25 + 向量 + 命题卡片）→ RRF 融合之后，增加第四路标注检索：

   ```
   search_book(keywords)
       │
       ├── 现有三路并行：
       │   ├── BM25 关键词搜索（PageIndex 内容块）
       │   ├── 向量语义搜索（PageIndex 内容块）
       │   └── 命题卡片搜索（原子事实）
       │       │
       │       ▼ RRF 融合 → 书籍内容命中列表
       │
       └── 新增第四路：标注检索
           ├── 从 book-meta.json 获取书名 → 定位 书籍摘录/{书名}/
           ├── 读取目录下所有 .md 文件
           ├── 解析 callout 块，提取标注文本
           ├── 关键词匹配过滤（任一 keyword 命中即保留）
           └── 生成标注命中列表
               │
               ▼ 合并到最终结果
   ```

2. **权重与排序**

   标注命中使用独立的评分（关键词匹配度），合并到结果列表时应用 **1.3x 提权**（与当前章节 1.5x 提权机制类似）：

   ```
   标注命中的 RRF 分数 = 基础匹配分 × 1.3
   ```

   体现"用户标注 = 用户关注点"的原则——同等匹配度下标注优先于内容。

3. **书名映射**

   `search_book` 通过 `ToolContext.indexId`（PageIndex ID）获取书籍索引，但 `书籍摘录/` 目录按书名组织。映射方式：

   - 从 `indexId` 定位 `.pageindex/{indexId}/book-meta.json`
   - 从 `book-meta.json` 读取书名（`title`）
   - 同时用 DeepReader 的 `sanitizeFilename`（`src/services/excerpt-service.ts`）和微信读书的 `sanitizeFileName`（`src/weread/utils/file.ts`）两种方式生成目录名
   - 两种目录名都尝试查找，命中即可

3. **callout 解析**

   统一提取所有 callout 块内的文本内容，不区分类型：

   ```
   > [!xxx]+ 标题
   > 标注文本内容
   > 💬 附加内容
   > ---
   > 📍 来源信息
   ```

   提取规则：
   - 提取 callout 内的所有非元数据行（跳过 `---` 分隔线和 `📍 来源:` 行）
   - 不区分 callout 类型（`[!warning]`/`[!quote]`/`[!note]` 等都一样）
   - 不区分标注和笔记想法——统一为"用户标注"

4. **结果格式**

   搜索返回内容中，标注命中前缀标记 `[用户标注]`：

   ```
   [书籍内容] 第三章 反向传播算法的核心是链式法则... ^block-abc
   [书籍内容] 第五章 梯度下降的变体包括 SGD、Adam... ^block-def
   [用户标注] 📌 机器学习的核心是通过数据驱动的方式优化模型参数...
   [用户标注] 💬 反向传播这一节写得很清楚，建议结合链式法则一起理解...
   ```

5. **不建额外索引**
   - 书内标注量有限（几十到几百条），实时读取解析性能开销可忽略
   - 用户新增摘录后无需"重建索引"，下次搜索自动可见

**涉及修改**：
- `src/agent/tools/local/search-text.ts` — 搜索逻辑增加标注检索
- `src/agent/tools/definitions/search-book.ts` — 结果格式增加来源标注

**无新增文件**。

---

### 功能 2：微信读书高亮导入（`<mark>` 写入）

**目标**：同步完成后，对已关联的书做模糊文本匹配，把微信读书高亮写成 `<mark>` 标签到章节文件中，与 DeepReader 原生高亮完全统一。

**验收标准**：
- 已关联的书同步完成后，微信读书高亮自动出现在章节文件的对应位置
- 已导入的高亮不重复写入
- 匹配失败的高亮保留在笔记文件中不丢失

**触发时机**：`WereadService.sync()` 完成后调用，遍历 mapping 中所有已关联的书。不在 sync-engine 内部执行（匹配是 `WereadService.rematch()` 的独立操作）。

**技术方案**：

1. **新增 `src/weread/sync/highlight-importer.ts`**

   挂载点：`WereadService.sync()` 方法末尾，`syncEngine.sync()` 返回后调用。

   流程：
   ```
   WereadService.sync() 完成
     │
     遍历 mapping.mappings 中所有条目
       │
       对每个有 deepReaderBookId 的条目：
       ├── 定位微信读书笔记文件
       │   └── sync-state.json → syncedBooks[wereadBookId].filePath
       │
       ├── 定位 DeepReader 章节文件
       │   └── .pageindex/{deepReaderBookId}/book-meta.json → chapters[].mdFilePath
       │
       ├── 读取笔记文件，解析高亮 callout，提取 markText + colorStyle 列表
       │
       ├── 对每条 markText，遍历章节文件做模糊文本匹配
       │   ├── 匹配成功 → 写入 <mark> 标签
       │   └── 匹配失败 → 保留在笔记文件中（已有 callout）
       └── 记录导入结果日志
   ```

2. **模糊文本匹配算法**（`src/weread/sync/text-matcher.ts`）

   复用 `main.ts` `findTextInMarkdown` 的思路：剥离 markdown 标记 → 子串匹配 → 映射回原位置。

   - 标准化处理：去空格、去标点、统一全角/半角、转小写
   - 匹配策略：子串包含关系即可（不需要精确相等）
   - 重复文本：全部匹配位置都写入 `<mark>`

3. **颜色映射**

   微信读书 6 色 → DeepReader 5 色：
   ```
   weread colorStyle 0 (黄) → yellow
   weread colorStyle 1 (红) → orange
   weread colorStyle 2 (橙) → orange
   weread colorStyle 3 (绿) → green
   weread colorStyle 4 (蓝) → blue
   weread colorStyle 5 (粉) → pink
   ```

4. **冲突处理**
   - 写入前检查目标位置是否已有 `<mark>` 标签，有则跳过
   - 文件读取失败（用户正在编辑）→ 跳过该书，下次重试

5. **幂等性**
   - 通过检查 `<mark>` 标签覆盖来判断是否已导入，不依赖额外记录
   - 重新同步后，新增的高亮增量导入

**涉及修改**：
- `src/weread/sync/highlight-importer.ts` — 新增，高亮导入主逻辑
- `src/weread/sync/text-matcher.ts` — 新增，模糊文本匹配算法
- `src/weread/index.ts` — `sync()` 方法末尾调用 highlight-importer

---

### 功能 3：书库卡片增强

**目标**：在书库卡片上展示微信读书的统计信息。

**验收标准**：
- 已关联的书卡片上显示阅读进度和标注数量
- 旧数据（无 stats）不报错，卡片正常显示

**技术方案**：

1. **Mapping 数据扩展**（向后兼容，可选字段）

   ```typescript
   // src/weread/types.ts — WereadMappingEntry 扩展
   interface WereadMappingEntry {
     // ... 现有字段 ...
     stats?: {
       noteCount: number;
       reviewCount: number;
       progress: number;        // 0-100
       readingTime: string;
       lastReadDate: string;
     };
   }
   ```

2. **同步时更新 stats**（`src/weread/sync/sync-engine.ts`）
   - 匹配阶段完成后，把微信读书的进度/标注数等统计写入 mapping 的 stats 字段

3. **Library View 卡片增强**（`src/views/library-view.ts`）
   - 已关联的书卡片上，徽章区域扩展显示：进度 + 高亮数量
   - 复用现有 `refreshWereadBadges()` 的位置

**涉及修改**：
- `src/views/library-view.ts` — 卡片渲染增强
- `src/weread/types.ts` — WereadMappingEntry 扩展
- `src/weread/sync/state.ts` — mapping 写入时附带 stats
- `src/weread/sync/sync-engine.ts` — 同步完成时更新 stats

---

## 3. 项目结构增量

```
src/weread/sync/
├── highlight-importer.ts     # 功能 2：微信读书高亮 → <mark> 导入
└── text-matcher.ts           # 功能 2：模糊文本匹配算法
```

功能 1 无新增文件，修改现有 `search-text.ts` 和 `search-book.ts`。
无新的依赖引入。

---

## 4. 实施顺序

| 步骤 | 功能 | 依赖 | 复杂度 |
|------|------|------|--------|
| 1 | 书库卡片增强 | 无 | 低 |
| 2 | 统一标注搜索 | 无 | 中 |
| 3 | 微信读书高亮导入 | 需文本匹配算法 | 中高 |

---

## 5. 代码风格

遵循现有项目约定（`.project-rules/05-conventions.md`）：

- TypeScript strict mode，ES Module
- 日志使用 `serviceLog`（`src/utils/logger.ts`）
- 所有 HTTP 请求通过 `safeRequest()`
- 文件路径通过 Vault API（`app.vault.adapter`），不硬编码
- UI 使用 Obsidian 原生 DOM API + `createEl`
- 类型扩展使用可选字段 + 向后兼容

---

## 6. 测试策略

| 测试文件 | 覆盖范围 |
|---------|---------|
| `src/weread/__tests__/text-matcher.test.ts` | 模糊匹配：空格/标点差异、重复文本、空输入、全角半角 |
| `src/weread/__tests__/highlight-importer.test.ts` | 导入流程、幂等性、冲突跳过、增量导入 |
| `src/agent/tools/local/__tests__/search-text.test.ts` | 标注检索：callout 解析、关键词匹配、书名映射 |

Mock 策略：Mock Vault adapter 和文件读取，不实际操作文件系统。

---

## 7. 边界

### 必须做

- 搜索结果必须标注来源（`[书籍内容]` / `[用户标注]`）
- 高亮导入必须幂等（重复执行不产生重复 `<mark>`）
- Mapping 扩展字段向后兼容（旧数据缺少 stats 不影响功能）
- 文本匹配失败的高亮保留在笔记文件中，不静默丢失
- 书名映射需兼容两种 sanitize 函数

### 先问再做

- 标注命中在搜索结果中的排序权重
- 微信读书高亮颜色到 DeepReader 颜色的映射方案
- 书库卡片 stats 徽章的 UI 布局细节

### 绝不做

- 不建独立的标注索引数据库
- 不修改 Phase 1 的数据模型（仅扩展可选字段）
- 不做跨书标注搜索（后续扩展）
- 不修改 PageIndex 核心索引逻辑
- 不获取/展示微信读书正文内容
- 不自行提交 git 代码
