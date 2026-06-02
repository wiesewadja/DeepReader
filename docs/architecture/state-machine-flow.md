# 认知引擎状态机流程

## 拓扑图

```
START → [S0 Router] ──depth≥1──→ [S1 Inspectional] ──depth=2──→ [S2 Analytical] → [S4 Formatter] → END
              │                         │
           depth=0                  depth=1
              │                    + structuralAnalysis
              ↓                         ↓
        [S4 Formatter]            [S4 Formatter]
              ↓                         ↓
             END                       END

depth=3 → S1 → S3 Syntopical → S4 → END（本文暂不涉及）
```

## 深度定义

| depth | 路径 | 说明 |
|-------|------|------|
| 0 | S0 → S4 | 闲聊，跳过阅读分析 |
| 1 | S0 → S1 → S4 | 检视阅读，结构概览即可 |
| 2 | S0 → S1 → S2 → S4 | 分析阅读，搜索+精读+引用 |
| 3 | S0 → S1 → S3 → S4 | 主题阅读，多书对比 |

---

## S0：Router（路由器）

**职责**：用快速模型分类问题深度 + 重写查询

**读取 state**：
- `messages` → 提取最后一条 HumanMessage 作为原始查询
- `pdfName` → 书名（注入 prompt）

**调用**：fastModel（1 次 LLM 调用）

**Prompt 核心**（`src/agent/graph/prompts/router-prompt.ts`）：
- 给出 depth 定义：0=闲聊、1=检视、2=分析、3=主题
- 要求输出 JSON：`{depth, standalone_query, reason}`

**输出 → 写入 state**：

| 字段 | 值示例 | 说明 |
|------|--------|------|
| `depth` | `2` | 分析阅读 |
| `rewrittenQuery` | `"纳瓦尔对判断力的看法"` | 去掉口语化，提取核心问题 |

**路由决策**（`routeByDepth`）：
- depth=0 → 直奔 S4（跳过 S1/S2）
- depth≥1 → 进入 S1

---

## S1：Inspectional（检视阅读）

**职责**：加载目录树 → 选定搜索范围 → 生成更好的问题

**读取 state**：
- `rewrittenQuery`（来自 S0）
- `pdfName`、`bookId`（运行时注入）
- `depth`（决定 S1 的分析粒度）

**步骤**：

1. **加载 tree.json**：从 `.pageindex/{bookId}/tree.json` 读取目录结构
2. **格式化目录**：`formatTreeStructure()` 把树形结构转为文本
3. **构建 prompt**：注入完整目录树 + 用户问题
4. **调用 fastModel**（1 次 LLM 调用），解析 JSON 输出

**Prompt 核心**（`src/agent/graph/prompts/inspectional-prompt.ts`）：
- 给出完整目录结构
- 要求输出：
  - `scopeNodeIds`: 相关章节的 node_id 数组
  - `tocSummary`: 目录摘要（传给下游）
  - `better_question`: 改写后的精确问题
  - `structural_analysis`: 结构分析（depth=1 时作为最终输出）
  - `suggested_keywords`: S2 预检索用的关键词

**输出 → 写入 state**：

| 字段 | 值示例 | 说明 |
|------|--------|------|
| `scopeNodeIds` | `["26", "27", "30"]` | 相关章节 |
| `tocSummary` | `"第26章讲判断力，第27章讲思考..."` | 传给 S2/S4 |
| `betterQuestion` | `"纳瓦尔如何定义判断力？它与心智模型有什么关系？"` | 更精确的问题 |
| `structuralAnalysis` | `""` | depth=2 时不填（留给 S2） |
| `suggestedKeywords` | `["判断力", "心智模型", "长期后果"]` | S2 预检索用 |

**路由决策**（`routeAfterInspectional`）：
- depth=3 → S3（主题阅读）
- depth≤1 且有 structuralAnalysis → S4（直接格式化）
- depth=2 → S2（继续分析）

---

## S2：Analytical（分析阅读）

**职责**：在 S1 划定的范围内，搜索并精读原文，生成带 wiki 链接的分析

**读取 state**：
- `scopeNodeIds`（来自 S1，搜索范围）
- `betterQuestion`、`rewrittenQuery`（问题）
- `suggestedKeywords`（来自 S1，预检索关键词）
- `tocSummary`（传给 prompt）

**核心流程**（`src/agent/graph/nodes/analytical.ts`）：

```
┌──────────────────────────────────────────┐
│ 1. 验证 scopeNodeIds                     │
│    validateScopeNodeIds() 过滤无效 ID    │
├──────────────────────────────────────────┤
│ 2. 构建 System Prompt + User Message     │
│    - 注入 scoped_chapters（node→file映射）│
│    - 注入 tocSummary 作为 search_hints   │
│    - 注入历史对话摘要                     │
├──────────────────────────────────────────┤
│ 3. Path B: 预检索（RRF 多关键词）        │
│    suggestedKeywords → 并行 searchBookV2 │
│    → 融合排序 → 取 top3                  │
├──────────────┬───────────────────────────┤
│ avgScore≥0.6 │ avgScore<0.6              │
│ ============ │ ========================= │
│ 早停路径     │ 正常路径                   │
│ 直接让 main  │ 注入 preSearchBlock        │
│ Model 回答   │ ↓                          │
│              │ runPlanExecute()           │
│              │  ├ Plan: 规划工具调用      │
│              │  ├ Execute: 并行调工具     │
│              │  └ Synthesize: 综合分析    │
├──────────────┴───────────────────────────┤
│ 4. verifyAndCleanContent() — 自检验      │
│    检查 wiki 链接的 block_id 是否真实     │
│    移除幽灵引用                           │
└──────────────────────────────────────────┘
```

**工具集**：`search_book` + `read_book_section`（只有 2 个）

**Prompt 核心**（`src/agent/graph/prompts/analytical-prompt.ts`）：
- 角色：艾德勒学派阅读分析师
- 约束：搜索范围由 `<locked_scope>` 限定
- 输出规则：wiki 链接格式 `[[书名/file_name#^block_id|短别名]]`
- 铁律：必须有书名、短别名2-6字、内联嵌入（不挂句尾）

**输出 → 写入 state**：

| 字段 | 值示例 | 说明 |
|------|--------|------|
| `analysisResult` | `"纳瓦尔将[[纳瓦尔宝典/26 - 判断力#^s25-001\|判断力]]定义为..."` | 带 wiki 链接的分析文本 |
| `toolResultsSnapshot` | `[{toolName:"search_book", args:{...}, result:"...", extractedBlockIds:["s25-001"]}]` | 工具调用记录（S4 验证用） |

**关键区别**：
- **早停路径**（avgScore≥0.6）：1 次 mainModel 调用，无工具调用
- **正常路径**（Plan-Execute）：2-3 次 mainModel 调用（plan + execute + synthesize）

---

## S4：Formatter（格式化）

**职责**：将 S2 的"逻辑骨架"转为"奚童风格"的精美笔记

**读取 state**：
- `analysisResult`（来自 S2，带 wiki 链接）
- `toolResultsSnapshot`（来自 S2，用于验证）
- `rewrittenQuery`、`pdfName`
- `tocSummary`、`structuralAnalysis`
- `betterQuestion`

**核心流程**（`src/agent/graph/nodes/formatter.ts`）：

```
┌──────────────────────────────────────────────────┐
│ depth=0（闲聊模式）                               │
│   → 直接 stream 回答，无链接处理                  │
│   → return { formattedOutput: content }           │
├──────────────────────────────────────────────────┤
│ depth≥1（正常模式）                               │
│                                                   │
│ 1. 占位符替换                                     │
│    analysisResult 中的 wiki 链接 → §REF_0§, §REF_1§│
│    例: "[[纳瓦尔宝典/26#^s25-001|判断力]]"         │
│       → "§REF_0§"                                 │
│                                                   │
│ 2. 构建 Prompt（注入 safeAnalysis + 历史 + TOC）  │
│                                                   │
│ 3. mainModel.stream() — 流式输出                  │
│    LLM 只看到 §REF_n§ 占位符，无法篡改链接         │
│                                                   │
│ 4. 还原占位符                                     │
│    §REF_0§ → [[纳瓦尔宝典/26#^s25-001|判断力]]     │
│                                                   │
│ 5. self-verification（安全网）                     │
│    verifyAndCleanContent(content, toolResults)    │
│    检查 block_id 是否在工具结果中存在               │
│    移除不存在的幽灵链接                            │
│                                                   │
│ 6. 可选 HITL 人工审核                             │
└──────────────────────────────────────────────────┘
```

**Prompt 核心**（`src/agent/graph/prompts/formatter-prompt.ts`）：
- 角色：奚童（AI 阅读助理，温和、书卷气）
- 规则：轻度书信体、占位符原样搬运、无幻觉、隐藏机器属性
- 占位符规则：§REF_n§ 必须原样保留并嵌入正文关键词位置

**输出 → 写入 state**：

| 字段 | 值示例 | 说明 |
|------|--------|------|
| `formattedOutput` | `"纳瓦尔将**[[纳瓦尔宝典/26 - 判断力#^s25-001\|判断力]]**定义为..."` | 最终用户看到的文本 |

---

## State 字段全局流转

```
           S0 Router        S1 Inspectional     S2 Analytical          S4 Formatter
           ─────────        ────────────────     ─────────────          ─────────────
读: messages              ← rewrittenQuery      ← scopeNodeIds         ← analysisResult
                           pdfName               betterQuestion         ← toolResultsSnapshot
                                                 rewrittenQuery           rewrittenQuery
                                                 suggestedKeywords        pdfName, tocSummary
                                                                          structuralAnalysis

写: depth ─────────────────→ (路由决策)
    rewrittenQuery ─────────→ (传递给下游)

                           scopeNodeIds ─────────→ (S2 搜索范围)
                           tocSummary ──────────→ (传给 S2+S4)
                           betterQuestion ──────→ (传给 S2+S4)
                           structuralAnalysis ──→ (depth=1 时直接到 S4)
                           suggestedKeywords ───→ (S2 预检索)

                                                 analysisResult ──────→ (S4 格式化源)
                                                 toolResultsSnapshot ─→ (S4 验证用)

                                                                        formattedOutput → 返回用户
```

---

## S2 vs S4 职责对比

| 维度 | S2 Analytical | S4 Formatter |
|------|--------------|--------------|
| **目标** | 忠实还原作者观点 | 美化呈现给用户 |
| **模型** | mainModel（强模型） | mainModel（强模型） |
| **工具** | search_book + read_book_section | 无 |
| **链接** | **生成** wiki 链接（带精确 block_id） | **保护** wiki 链接（占位符机制） |
| **风格** | 客观分析、逻辑骨架 | 奚童语气、书信体 |
| **知识** | 只来自书中原文 | 只来自 S2 的 analysisResult |
| **输出** | `analysisResult`（带原始链接） | `formattedOutput`（美化+链接不变） |

**关键设计**：S2 是唯一有权**创造** wiki 链接的节点。S4 只负责**搬运**链接（通过占位符机制确保不被篡改）和**美化**文本风格。self-verification 作为安全网，在 S4 输出前最后检查一遍。
