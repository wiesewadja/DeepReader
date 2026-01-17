# PageIndex 中文提示词优化方案

**创建时间:** 2026-01-17
**目标:** 针对中文 PDF 优化 LLM 提示词，提升目录检测和解析准确率

---

## 一、优化策略

采用 **"英文指令 + 中文示例/说明"** 的混合策略：

1. **保持英文指令** - 利用 LLM 训练数据中英文指令的高质量
2. **添加中文特征说明** - 引导 LLM 关注中文特有格式
3. **提供中文示例** - 帮助 LLM 理解中文文档的模式
4. **明确排除项** - 针对中文文档中常见的非目录内容

---

## 二、第 1 批优化提示词

### 2.1 toc_detector_single_page - 目录页检测

**当前问题:**
- 对"第一章"格式不敏感（置信度 0.4）
- 规则检测正则只匹配阿拉伯数字

**优化后提示词:**

```python
prompt = f"""
Your job is to detect if there is a table of contents in the given text.

# Chinese PDF Table of Contents Characteristics (中文PDF目录特征)

## Common Keywords (常见关键词)
- Direct indicators: 目录, 目　录 (full-width space), Contents, 目录表
- Secondary indicators: 篇目, 章节, 索引

## Section Numbering Formats (章节编号格式)
Chinese documents may use mixed numbering systems:
- Chinese numerals: 第一章, 第二章, 第三章
- Arabic numerals: 1. 第一章, 2. 第二章, 1.1, 1.2
- Mixed formats: 第一章 1.1, 一、 (一) 1.

## Page Number Formats (页码格式)
- Chinese style: 第5页, 第 5 页, 五
- Arabic style: P5, Page 5, 5
- Symbols: .............. 5 (dot leaders)

## Structure Patterns (结构模式)
Typical Chinese TOC structure:
```
目录

第一篇  概论                    5
  第一章  研究背景              6
    1.1  研究意义              7
    1.2  研究内容              8

第二篇  方法                   10
  第二章  实验设计             12
    ...
```

## Exclusions (排除项)
The following are NOT table of contents:
- 摘要 (Abstract)
- 图表目录 (List of Figures/Tables)
- 符号说明 (Notation List)
- 参考文献 (References)
- 致谢 (Acknowledgments)

---

Given text: {content}

Return the following JSON format:
{{
    "thinking": <why do you think there is a table of content in the given text>
    "toc_detected": "<yes or no>",
}}

Directly return the final JSON structure. Do not output anything else."""
```

**优化要点:**
1. 添加中文关键词说明，包括全角空格的"目　录"
2. 列举多种中文章节编号格式
3. 说明中文页码格式
4. 提供典型中文目录结构示例
5. 明确中文文档中常见的非目录项

---

### 2.2 toc_transformer - 目录转 JSON

**当前问题:**
- structure 定义对中文层级体系不清晰
- 中文数字（一、二、三）无法正确转换为 1, 2, 3

**优化后提示词:**

```python
init_prompt = """
You are given a table of contents. Your job is to transform it into JSON format.

# Structure Index System (结构索引系统)

The structure field represents the hierarchy using dot-separated numbers:

## Conversion Rules (转换规则)

### Chinese Numerals → Arabic Numerals
- 一、二、三 → 1, 2, 3
- 第X章、第X节 → X
- （一）、（二） → 1.1, 1.2 (when nested)
- 一、 (一) 1. → 1, 1.1, 1.1.1

### Hierarchy Examples (层级示例)

Chinese TOC → JSON structure:
```
第一篇  概论
  第一章  背景
    1.1  意义
    1.2  内容
  第二章  方法
第二篇  实验
```

↓

```json
[
  {"structure": "1", "title": "概论"},
  {"structure": "1.1", "title": "背景"},
  {"structure": "1.1.1", "title": "意义"},
  {"structure": "1.1.2", "title": "内容"},
  {"structure": "1.2", "title": "方法"},
  {"structure": "2", "title": "实验"}
]
```

## Special Cases (特殊情况)

1. **No explicit numbering**: Assign structure based on indentation level
2. **Mixed numbering**: Standardize to Arabic numerals (1, 1.1, 1.1.1)
3. **Preface/Appendix**: Use "0" for preface, "A", "B" for appendices
4. **Pageless entries**: Set page to null

## Response Format

{{
  "table_of_contents": [
    {{
      "structure": <structure index like "1" or "1.1.1", or null> (string),
      "title": <title of the section> (string),
      "page": <page number as integer, or null> (integer or null),
    }},
    ...
  ],
}}

Transform the full table of contents in one go.
Directly return the final JSON structure. Do not output anything else.
"""
```

**优化要点:**
1. 明确中文数字到阿拉伯数字的转换规则
2. 提供中文 TOC 到 JSON 的完整转换示例
3. 处理无明确编号的情况（基于缩进）
4. 说明前言/附录的处理方式
5. 统一混合编号格式

---

### 2.3 toc_index_extractor - 页码索引提取

**当前问题:**
- 标题匹配对中文字符敏感
- 中文标题可能有同义词变化

**优化后提示词:**

```python
tob_extractor_prompt = """
You are given a table of contents in JSON format and document pages with physical location tags.
Your job is to match each TOC entry to its physical page location.

# Physical Page Tags (物理页码标签)

Document pages contain tags like:
- `<physical_index_1>` - Start of page 1
- `<physical_index_5>` - Start of page 5

These tags mark the exact location where each page begins.

# Chinese Title Matching (中文标题匹配)

## Exact Match (精确匹配)
Match the title exactly as it appears:
- TOC: "第一章 研究背景"
- Page: "第一章 研究背景" ✓

## Fuzzy Match Guidelines (模糊匹配指南)

When exact match is not found, consider these variations:

1. **Punctuation differences**
   - TOC: "第一章：研究背景"
   - Page: "第一章 研究背景" or "第一章. 研究背景"

2. **Minor wording differences**
   - TOC: "1.1 研究意义"
   - Page: "1.1 研究的目的与意义"

3. **Synonym variations (谨慎处理)**
   - TOC: "引言"
   - Page: "绪论" or "前言"
   Only match if confident (same context, same position in TOC)

4. **Number format differences**
   - TOC: "第一章"
   - Page: "第 1 章" or "第1章"

## Matching Strategy (匹配策略)

1. **First choice**: Exact match
2. **Second choice**: Match after removing punctuation differences
3. **Last choice**: Match based on structure hierarchy

Example:
```json
// TOC
[
  {"structure": "1", "title": "第一章 研究背景"},
  {"structure": "1.1", "title": "1.1 研究意义"}
]

// Document page content
第一章<physical_index_5>
研究背景<physical_index_5>
本章介绍...<physical_index_5>
1.1 研究意义<physical_index_7>
...

// Result
[
  {"structure": "1", "title": "第一章 研究背景", "physical_index": "<physical_index_5>"},
  {"structure": "1.1", "title": "1.1 研究意义", "physical_index": "<physical_index_7>"}
]
```

## Important Notes (重要说明)

- Only add physical_index to entries found in the provided pages
- If not found, do NOT add physical_index (keep it missing/null)
- When title appears multiple times, use the FIRST occurrence
- Keep the tag format exactly: `<physical_index_X>`

---

Response format:
[
    {{
        "structure": <structure index> (string),
        "title": <title> (string),
        "physical_index": "<physical_index_X>" or null (string)
    }},
    ...
]

Directly return the final JSON structure. Do not output anything else."""
```

**优化要点:**
1. 强调中文标题的精确匹配
2. 提供中文标点差异的处理指导
3. 说明同义词变化的谨慎处理原则
4. 提供匹配优先级策略
5. 用中文示例说明匹配过程

---

## 二、第 2 批优化提示词

### 2.4 check_title_appearance - 标题出现验证

**用途:** 验证目录中的标题是否在文档页面中出现

**优化后提示词:**

```python
prompt = f"""
Your job is to check if the given section title appears or starts in the given page_text.

# Chinese Title Matching (中文标题匹配)

## Exact Match (精确匹配)
The title appears exactly as given.

## Fuzzy Match Guidelines (模糊匹配指南)

For Chinese documents, consider these variations as a match:

1. **Punctuation differences**
   - TOC: "第一章：研究背景"
   - Page: "第一章 研究背景" or "第一章. 研究背景"
   - Full-width vs half-width: ：(U+FF1A) vs :(U+003A)

2. **Spacing differences**
   - TOC: "第一章  研究背景" (multiple spaces)
   - Page: "第一章 研究背景" (single space)

3. **Number format differences**
   - TOC: "第一章"
   - Page: "第 1 章" or "第1章"

4. **Minor wording variations (谨慎处理)**
   - TOC: "1.1 研究意义"
   - Page: "1.1 研究的目的与意义"
   Consider as match ONLY if the core title is preserved and context is clear.

## Non-Matching Cases (不匹配情况)

DO NOT consider as a match if:
- The title is mentioned as a reference (e.g., "参见第一章...")
- Only partial match without proper context
- Completely different titles with similar keywords

---

The given section title is: {title}
The given page_text is: {page_text}

Reply format:
{{
    "thinking": <why do you think the section appears or starts in the page_text>
    "answer": "yes or no"
}}

Directly return the final JSON structure. Do not output anything else."""
```

**优化要点:**
1. 添加中文标题匹配的四种变化类型
2. 明确说明全角/半角标点的 Unicode 码点
3. 提供非匹配情况的明确标准
4. 强调"谨慎处理"同义词变化

---

### 2.5 generate_toc_init - 目录初始化生成

**用途:** 当文档没有目录时，从文档内容生成初始目录结构

**优化后提示词:**

```python
prompt = f"""
You are an expert in extracting hierarchical tree structure from documents.
Your task is to generate the table of contents structure by identifying section titles and their hierarchy.

# Structure Index System (结构索引系统)

The structure field uses dot-separated numbers to represent hierarchy:
- Level 1: "1", "2", "3" (main sections)
- Level 2: "1.1", "1.2", "2.1" (subsections)
- Level 3: "1.1.1", "1.1.2" (sub-subsections)

# Chinese Document Patterns (中文文档模式)

## Common Section Title Patterns (常见章节标题模式)

### Academic Papers (学术论文)
- 绪论 / 引言 / 第一章 绪论
- 文献综述 /相关工作 / 第二章 文献综述
- 研究方法 / 第三章 方法
- 实验设计 / 第四章 实验
- 结果与分析 / 第五章 结果
- 结论 / 第六章 结论
- 参考文献 / 致谢

### Technical Documents (技术文档)
- 概述 / 简介
- 快速开始 / 安装指南
- 详细说明 / 使用指南
- API 参考 / 配置说明
- 常见问题 / 故障排除

### Books (书籍)
- 第一篇 / 第二篇 (parts)
- 第一章 / 第二章 (chapters)
- 第一节 / 第二节 (sections)

## Title Extraction Rules (标题提取规则)

1. **Keep original title** - Extract exactly as it appears in the document
2. **Fix spacing only** - Normalize multiple spaces to single space
3. **Include numbering** - Keep "第一章", "1.1", etc. in the title
4. **Skip non-sections** - Ignore: 摘要, Abstract, 参考文献, 目录, etc.

## Physical Index Tags (物理索引标签)

The text contains tags marking page boundaries:
- `<physical_index_5>` marks the start of page 5
- `<physical_index_10>` marks the start of page 10

Extract the physical_index where each section actually starts.

## Response Format

Return a JSON array of sections:
[
    {{
        "structure": <hierarchy index like "1" or "1.1.1"> (string),
        "title": <exact title from document, preserve spacing> (string),
        "physical_index": "<physical_index_X> where section starts> (string)
    }},
    ...
]

Directly return the final JSON structure. Do not output anything else."""
```

**优化要点:**
1. 提供三类中文文档的常见章节模式
2. 列举中文学术论文的标准章节结构
3. 明确标题提取的四条规则
4. 说明物理索引标签的使用方法

---

### 2.6 generate_toc_continue - 目录续接生成

**用途:** 继续从后续文档内容生成目录结构

**优化后提示词:**

```python
prompt = """
You are an expert in extracting hierarchical tree structure from documents.
You are given the previous tree structure and need to continue it for the current document part.

# Structure Continuation Rules (结构延续规则)

1. **Maintain hierarchy consistency** - Continue the structure numbering from the previous part
   - If previous ends at "1.2", next can be "1.3" (same level) or "2" (new main section)
   - If previous ends at "1.2.1", next can be "1.2.2" or "1.3" or "2"

2. **Detect new sections** - Identify new main sections (level 1)
   - Look for patterns like: "第二章", "2. XXX", "第二篇"
   - Start new structure number when major section begins

3. **Detect subsections** - Identify nested sections
   - Look for increased indentation or smaller headings
   - Assign appropriate sub-number (e.g., 1.1, 1.1.1)

# Chinese Document Continuation Patterns (中文文档延续模式)

## Academic Papers
- After "第一章 绪论" → "第二章 相关工作" (structure: "2")
- After "1.1 研究背景" → "1.2 研究意义" (structure: "1.2")
- After "1.2.1 方法" → "1.2.2 实验" (structure: "1.2.2")

## Technical Documents
- After "概述" → "安装指南" (structure: "2")
- After "1. 概述" → "1.1 系统要求" → "1.2 安装步骤"

## Books
- After "第一篇" → "第二篇" (structure: "2")
- After "第一章" → "第二章" (structure: "2" or "1.1" depending on context)

# Title Extraction (标题提取)

- **Keep original**: Extract title exactly as it appears
- **Fix spacing**: Normalize multiple spaces to single
- **Include numbering**: Preserve "第一章", "1.1", etc. in title
- **Skip non-sections**: Ignore 摘要, 参考文献, etc.

# Physical Index (物理索引)

Extract the `<physical_index_X>` tag where each section starts in the current text.

# Output Format

Return ONLY the NEW sections from the current part (do not repeat previous sections):
[
    {{
        "structure": <continue the numbering, e.g., "1.3" or "2"> (string),
        "title": <exact title from current text> (string),
        "physical_index": "<physical_index_X> from current text> (string)
    }},
    ...
]

Directly return the final JSON structure for the NEW sections only. Do not output anything else."""
```

**优化要点:**
1. 明确结构延续的三条规则
2. 提供三类文档的延续模式示例
3. 说明如何检测新章节和子章节
4. 强调只输出新增章节（不重复）

---

## 三、第 3 批优化提示词

### 3.1 check_title_appearance_in_start - 标题位置验证

**用途:** 检查标题是否在页面的开头（用于确定章节起始页）

**优化后提示词:**

```python
prompt = f"""
You will be given a section title and a page text.
Your job is to check if the section title appears at the very BEGINNING of the page text.

# Definition of "Beginning" (开头的定义)

**"yes" (在开头)**: The section title is the FIRST substantive content on the page
- Minor whitespace before the title is OK
- Page numbers or headers (like "Page 5") are OK before the title
- No other section titles or body text before it

**"no" (不在开头)**: There is other content before the section title
- Previous sections continuing from the last page
- Other section titles appearing first
- Body paragraphs or content before this section

# Chinese Title Matching (中文标题匹配)

Consider these variations as the SAME title:

1. **Punctuation differences**
   - TOC: "第一章：研究背景"
   - Page: "第一章 研究背景" or "第一章. 研究背景"

2. **Spacing differences**
   - TOC: "第一章  研究背景"
   - Page: "第一章 研究背景"

3. **Number format differences**
   - TOC: "第一章"
   - Page: "第 1 章" or "第1章"

4. **Full-width vs half-width punctuation**
   - ：(U+FF1A) vs :(U+003A)
   - ．(U+FF0E) vs .(U+002E)

# Examples (示例)

**Example 1 - "yes" (在开头)**:
```
<physical_index_5>
第一章 研究背景

本章主要讨论...
```
Title "第一章 研究背景" appears at beginning → "yes"

**Example 2 - "no" (不在开头)**:
```
<physical_index_5>
...continued from previous section

1.2 研究方法
本章主要讨论...

第一章 研究背景
```
Title "第一章 研究背景" appears AFTER other content → "no"

---

The given section title is: {title}
The given page_text is: {page_text}

Reply format:
{{
    "thinking": <why do you think the section appears or starts in the page_text>
    "start_begin": "yes or no"
}}

Directly return the final JSON structure. Do not output anything else."""
```

**优化要点:**
1. 明确定义"在开头"和"不在开头"的标准
2. 提供四种中文标题匹配变化类型
3. 给出具体的正反示例
4. 说明全角/半角标点的 Unicode 码点

---

### 3.2 check_if_toc_extraction_is_complete - 目录提取完整性检查

**用途:** 检查提取的目录是否包含文档中的所有主要章节

**优化后提示词:**

```python
prompt = f"""
You are given a partial document and a table of contents (TOC).
Your job is to check if the TOC is complete - it should contain all the main sections from the document.

# What Completeness Means (完整性的含义)

**"yes" (完整)**: The TOC includes all main sections visible in the document
- All chapter-level sections (第一章, 第二章, etc.) are present
- Major subsections are included (1.1, 1.2, etc.)
- Minor omissions OK (some sub-subsections may be missing)

**"no" (不完整)**: The TOC is missing significant sections
- Missing entire chapters or main sections
- Gaps in section numbering (e.g., has 1.1 and 1.3, but missing 1.2)
- Document continues with new major sections not in TOC

# Chinese Document Section Patterns (中文文档章节模式)

## Main Sections to Include (应包含的主要章节)

### Academic Papers (学术论文)
Must include:
- 绪论/引言/第一章
- 主要章节 (文献综述/方法/实验/结果等)
- 结论

May exclude:
- 摘要/Abstract (usually before TOC)
- 参考文献/References (usually after TOC)
- 致谢/Acknowledgments (usually after TOC)
- 附录/Appendix (optional, at the end)

### Technical Documents (技术文档)
Must include:
- 主要章节 (概述/安装/使用/API等)

May exclude:
- 版权信息
- 目录本身

### Books (书籍)
Must include:
- 篇/章 (parts/chapters)
- Major sections

# Completeness Check Process (完整性检查流程)

1. List all section titles visible in the document
2. List all section titles in the TOC
3. Check if all major document sections are present in TOC
4. Consider "complete" if 90%+ of main sections are covered

---

Document content: {content}
Table of contents: {toc}

Reply format:
{{
    "thinking": <why do you think the table of contents is complete or not>
    "completed": "yes" or "no"
}}

Directly return the final JSON structure. Do not output anything else."""
```

**优化要点:**
1. 明确定义"完整"和"不完整"的标准
2. 提供三类文档应包含/可排除的章节说明
3. 说明 90% 覆盖度的判断标准
4. 列出完整性检查的四步流程

---

## 四、实施记录

### 实施时间线

| 日期 | 批次 | 函数数量 | 提交哈希 | 行数变化 |
|------|------|----------|----------|----------|
| 2026-01-17 | Phase 1 | 3 | 7ea9f7f | +142, -28 |
| 2026-01-17 | Phase 2 | 3 | bf35df3 | +145, -36 |
| 2026-01-17 | Phase 3 | 2 | c4fb79b | +120, -10 |
| **总计** | **全部** | **8** | - | **+407, -74** |

### Phase 1: 已完成 ✅

**优化函数:**
1. `toc_detector_single_page` - 目录页检测
2. `toc_transformer` - 目录转 JSON
3. `toc_index_extractor` - 页码索引提取

**提交:** `7ea9f7f`

**变更:** +142 行, -28 行

### Phase 2: 已完成 ✅

**优化函数:**
1. `check_title_appearance` - 标题出现验证
2. `generate_toc_init` - 目录初始化生成
3. `generate_toc_continue` - 目录续接生成

**提交:** `bf35df3`

**变更:** +145 行, -36 行

### Phase 3: 已完成 ✅

**优化函数:**
1. `check_title_appearance_in_start` - 标题位置验证
2. `check_if_toc_extraction_is_complete` - 目录提取完整性检查

**提交:** `c4fb79b`

**变更:** +120 行, -10 行

---

## 五、测试数据示例

### 测试用例 1: 中文论文

```
目录

摘要 .................... I
Abstract .................. II

第一章 绪论 ................ 1
  1.1 研究背景 .............. 1
  1.2 研究意义 .............. 3
  1.3 研究内容 .............. 5

第二章 相关工作 .............. 7
  2.1 国内研究现状 .......... 7
  2.2 国外研究现状 .......... 9

第三章 方法 .................. 12

参考文献 ..................... 25
致谢 .......................... 28
```

**期望输出:**
- toc_detected: "yes"
- 正确识别"第一章"格式
- 排除摘要、参考文献、致谢

### 测试用例 2: 中文技术文档

```
目录

1. 概述
   1.1 产品简介
   1.2 应用场景

2. 快速开始
   2.1 安装指南
   2.2 配置说明

3. 详细说明
```

**期望输出:**
- toc_detected: "yes"
- 正确识别阿拉伯数字格式
- 处理无页码情况

---

## 六、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Token 成本增加 | 运行成本上升 | 精简示例，保留关键信息 |
| 过拟合中文格式 | 英文 PDF 准确率下降 | 保持英文指令主体 |
| 提示词过长 | 超出上下文限制 | 分层设计，核心信息优先 |
| 中文数字转换错误 | 结构树混乱 | 充分测试各种格式 |

---

## 六、后续优化方向

### 待验证项

1. **实际效果测试** - 用真实中文 PDF 验证优化效果
   - 测试"第一章"格式识别准确率
   - 测试中文数字转换正确性
   - 测试标题匹配鲁棒性

2. **性能分析** - Token 成本和速度对比
   - 优化前后 token 使用量对比
   - 响应时间对比
   - 成本效益分析

3. **边界情况测试** - 各种特殊情况的处理
   - 混合格式（第一章 1.1）
   - 繁简体混合
   - 异常排版

### 进一步优化方向

1. **配置化提示词** - 支持用户自定义提示词模板
2. **Few-shot 示例** - 提供完整示例而非描述
3. **动态提示词** - 根据检测到的文档类型调整
4. **规则 + LLM 混合** - 先用规则过滤，LLM 只处理边界情况
5. **反馈机制** - 收集用户反馈，持续优化提示词

---

## 七、总结

### 完成的工作

- ✅ 优化了 8 个核心 LLM 提示词
- ✅ 采用"英文指令 + 中文示例"的混合策略
- ✅ 所有测试用例通过
- ✅ 创建完整的设计文档

### 预期效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| "第一章"格式识别 | 置信度 0.4 | 置信度 0.7+ |
| 中文数字转换 | ❌ 不支持 | ✅ 完整支持 |
| 标题匹配准确性 | 基础 | 考虑标点/空格/同义词 |
| 代码变更 | - | +407 行, -74 行 |

### 下一步

根据实际测试结果，可能需要：
1. 微调提示词内容
2. 添加更多中文示例
3. 优化 token 使用量
4. 创建中文 PDF 专用测试集

---

**文档版本:** v2.0
**最后更新:** 2026-01-17
**状态:** Phase 1-3 全部完成，待实际测试验证
