# 系统提示词优化实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简前端 Agent 系统提示词和后端 LLM 树搜索 prompt，节省约 55% tokens，同时加强双链引用核心目标强调。

**Architecture:**
- 前端：将阅读方法论提取为 skill，精简 Identity/Constraints 层和工具描述
- 后端：精简 TREE_SEARCH_PROMPT，移除冗余人设和格式说明

**Tech Stack:** TypeScript (Obsidian Plugin), Python (FastAPI)

---

## 文件结构

### 前端改动

| 文件 | 职责 |
|------|------|
| `frontend/src/built-in-skills.ts` | 新增 reading-methodology skill |
| `frontend/src/agent/context/builder.ts` | 精简 buildIdentityLayer() 和 buildConstraints() |
| `frontend/src/agent/tools/search-doc.ts` | 精简 description |
| `frontend/src/agent/tools/get-chapter.ts` | 精简 description |
| `frontend/src/agent/tools/get-toc.ts` | 精简 description |
| `frontend/src/agent/tools/outline-structure.ts` | 精简 description |
| `frontend/src/agent/tools/find-key-terms.ts` | 精简 description |
| `frontend/src/agent/tools/extract-propositions.ts` | 精简 description |
| `frontend/src/agent/tools/search-read-books.ts` | 精简 description |

### 后端改动

| 文件 | 职责 |
|------|------|
| `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py` | 精简 TREE_SEARCH_PROMPT 和 _call_llm_async |

---

## Chunk 1: 前端 - 新增 reading-methodology Skill

### Task 1.1: 添加 reading-methodology skill

**Files:**
- Modify: `frontend/src/built-in-skills.ts`

- [ ] **Step 1: 在 BUILT_IN_SKILLS 数组开头添加新 skill**

在 `frontend/src/built-in-skills.ts` 文件中，在 `BUILT_IN_SKILLS` 数组的开头添加：

```typescript
export const BUILT_IN_SKILLS: BuiltInSkill[] = [
    {
        filename: "reading-methodology.md",
        content: `---
name: reading-methodology
description: 分层阅读方法论 - 根据问题类型选择检视/分析/主题阅读，匹配最优工具
default: true
keywords:
  - 怎么读
  - 用什么方法
  - 阅读方法
  - 四层次
---

# 分层阅读方法论

## 四层次阅读法

### 检视阅读
- **触发**: "讲什么"、"总结"、"概览"
- **目标**: 快速抓取重点，了解整体结构
- **策略**: get_toc + search_doc 并行调用

### 分析阅读
- **触发**: "为什么"、"详细解释"、"深入分析"
- **目标**: 完整理解，咀嚼消化
- **策略**: get_chapter 逐段分析

### 主题阅读
- **触发**: "比较"、"其他书"、"关联"
- **目标**: 跨书比较，建立关联
- **策略**: search_read_books 搜索已读书库

## 工具选择指南

| 问题类型 | 首选工具 | 阅读层次 |
|---------|---------|---------|
| "讲什么/总结" | get_toc + search_doc | 检视阅读 |
| "结构/纲要" | outline_structure | 分析阅读 |
| "详细解释" | get_chapter | 分析阅读 |
| "术语/概念" | find_key_terms | 分析阅读 |
| "论点/主旨" | extract_propositions | 分析阅读 |
| "比较/关联" | search_read_books | 主题阅读 |

## 并行调用规则

- "讲什么/总结"类问题 → 同时调用 get_toc 和 search_doc
- 需要多个章节 → 一次调用多个 get_chapter
- 每轮尽可能多调用工具，减少迭代次数

## 效率原则

1. 获得 2-3 个相关章节后立即回答
2. 避免重复获取同一内容
3. 如果检视阅读已能回答，不主动升级到分析阅读
`
    },
    // ... 其他 skills
];
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: Build successful, no TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/built-in-skills.ts
git commit -m "feat(skill): 添加 reading-methodology 分层阅读方法论 skill

- 提取自 Identity 层的阅读方法论
- 设置为默认 skill (default: true)
- 包含四层次阅读法、工具选择指南、并行调用规则

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: 前端 - 精简 Identity 和 Constraints 层

### Task 2.1: 精简 buildIdentityLayer()

**Files:**
- Modify: `frontend/src/agent/context/builder.ts:124-192`

- [ ] **Step 1: 替换 buildIdentityLayer() 方法**

将 `frontend/src/agent/context/builder.ts` 中的 `buildIdentityLayer` 方法替换为：

```typescript
	/**
	 * 构建身份层（Layer 1）
	 */
	private buildIdentityLayer(metadata?: DocumentMetadata): string {
		if (this.config.identity) {
			return this.config.identity;
		}

		let docInfo = '';
		if (metadata?.title) {
			docInfo = `

## 当前文档
- 标题: ${metadata.title}
- 总页数: ${metadata.page_count || '未知'}`;
			if (metadata.author) {
				docInfo += `\n- 作者: ${metadata.author}`;
			}
		}

		return `你叫"奚童"，一个擅长分层阅读的书童，陪伴用户在 Obsidian 中深度阅读。

## 核心使命

帮助用户建立知识网络：
- **每个论断都必须引用原文**
- 使用双链 [[路径|显示名]] 连接知识节点
- 引用是产品的核心价值，不是可选装饰

## 工作环境

在 Obsidian 笔记软件中工作：
- 使用工具返回的 Link 字段（已包含正确格式）
- 引用自然嵌入句子中，不要附在句末
- 调入新文档时使用 [[文档路径]] 指出位置
${docInfo}`;
	}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: Build successful

### Task 2.2: 精简 buildConstraints()

**Files:**
- Modify: `frontend/src/agent/context/builder.ts:197-247`

- [ ] **Step 1: 替换 buildConstraints() 方法**

将 `frontend/src/agent/context/builder.ts` 中的 `buildConstraints` 方法替换为：

```typescript
	/**
	 * 构建核心约束
	 */
	private buildConstraints(): string {
		return `## 强制约束

### 1. 双链引用（核心规则）
- **必须引用**：每个论断都使用工具返回的 Link
- **正确嵌入**：[[路径|显示名]] 自然融入句子
- ❌ 不要自己构造链接
- ❌ 不要把引用附在句末

### 2. 静默执行
- 调用工具前不输出任何内容
- 获得结果后直接回答

### 3. 效率原则
- 2-3 章节即回答，不要过度搜索
- 传入完整问题搜索（后端使用语义搜索）

### 4. 互动风格
- 结合用户背景调整回答深度
- 洞察时刻给予简短情感回应
- 平和内敛，偶有点睛感悟

## 规则
- 任务匹配 Skill 时立即调用
- 优先使用工具获取信息
- **回答必须包含 Link 引用**`;
	}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: Build successful

- [ ] **Step 3: Commit**

```bash
git add frontend/src/agent/context/builder.ts
git commit -m "refactor: 精简 Identity 和 Constraints 层

Identity 层改动：
- 移除详细的阅读方法论（提取为 skill）
- 移除工具选择指南表格（提取为 skill）
- 新增核心使命部分，强调双链引用
- 保留 Obsidian 工作环境说明

Constraints 层改动：
- 合并为 4 条核心规则
- 保留并加强双链引用规则（作为第 1 条）
- 移除详细示例

节省约 750 tokens

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: 前端 - 精简工具描述

### Task 3.1: 精简 search_doc 工具描述

**Files:**
- Modify: `frontend/src/agent/tools/search-doc.ts:14-38`

- [ ] **Step 1: 替换 SEARCH_DOC_DEFINITION**

将 `frontend/src/agent/tools/search-doc.ts` 中的 `SEARCH_DOC_DEFINITION` 替换为：

```typescript
const SEARCH_DOC_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_doc',
    description: `【检视阅读】搜索文档内容。用于"讲什么/总结"类问题。传入完整问题（非关键词）。`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '用户的完整问题（不要简化为关键词）',
        },
        top_k: {
          type: 'number',
          description: `Maximum number of results to return (default: ${DEFAULT_TOP_K})`,
        },
      },
      required: ['query'],
    },
  },
};
```

### Task 3.2: 精简 get_chapter 工具描述

**Files:**
- Modify: `frontend/src/agent/tools/get-chapter.ts:14-40`

- [ ] **Step 1: 替换 GET_CHAPTER_DEFINITION**

将 `frontend/src/agent/tools/get-chapter.ts` 中的 `GET_CHAPTER_DEFINITION` 替换为：

```typescript
const GET_CHAPTER_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_chapter',
    description: `【分析阅读】获取章节完整内容。用于"详细解释/为什么"类问题。支持分页读取。`,
    parameters: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'The unique identifier of the chapter/node to retrieve',
        },
        max_length: {
          type: 'number',
          description: 'Maximum characters to return (default: 4000)',
        },
        start_offset: {
          type: 'number',
          description: 'Start reading from this character position',
        },
      },
      required: ['node_id'],
    },
  },
};
```

### Task 3.3: 精简 get_toc 工具描述

**Files:**
- Modify: `frontend/src/agent/tools/get-toc.ts`

- [ ] **Step 1: 查看当前 get_toc 定义**

Run: `head -40 /Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/get-toc.ts`

- [ ] **Step 2: 精简 get_toc description**

将 `frontend/src/agent/tools/get-toc.ts` 中的工具描述精简为：
```typescript
description: `【检视阅读】获取文档目录结构。用于了解书籍整体框架。`
```

### Task 3.4: 精简 outline_structure 工具描述

**Files:**
- Modify: `frontend/src/agent/tools/outline-structure.ts:14-33`

- [ ] **Step 1: 替换 OUTLINE_STRUCTURE_DEFINITION**

将 `frontend/src/agent/tools/outline-structure.ts` 中的 `OUTLINE_STRUCTURE_DEFINITION` 的 description 替换为：

```typescript
description: `【分析阅读】提取书籍结构和纲要。用于"结构如何/如何组织"类问题。`
```

### Task 3.5: 精简 find_key_terms 工具描述

**Files:**
- Modify: `frontend/src/agent/tools/find-key-terms.ts`

- [ ] **Step 1: 精简 find_key_terms description**

将 `frontend/src/agent/tools/find-key-terms.ts` 中的工具描述精简为：
```typescript
description: `【分析阅读】识别书籍关键术语。用于理解核心概念。`
```

### Task 3.6: 精简 extract_propositions 工具描述

**Files:**
- Modify: `frontend/src/agent/tools/extract-propositions.ts`

- [ ] **Step 1: 精简 extract_propositions description**

将 `frontend/src/agent/tools/extract-propositions.ts` 中的工具描述精简为：
```typescript
description: `【分析阅读】提取核心论点和主旨。用于理解作者观点。`
```

### Task 3.7: 精简 search_read_books 工具描述

**Files:**
- Modify: `frontend/src/agent/tools/search-read-books.ts`

- [ ] **Step 1: 精简 search_read_books description**

将 `frontend/src/agent/tools/search-read-books.ts` 中的工具描述精简为：
```typescript
description: `【主题阅读】搜索已读书库。用于跨书比较和关联。`
```

### Task 3.8: 验证并提交

- [ ] **Step 1: 验证 TypeScript 编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: Build successful

- [ ] **Step 2: Commit**

```bash
git add frontend/src/agent/tools/
git commit -m "refactor: 精简工具描述，保留场景标签

- search_doc: 200 → 80 字符
- get_chapter: 150 → 80 字符
- get_toc: 精简描述
- outline_structure: 150 → 80 字符
- find_key_terms: 150 → 80 字符
- extract_propositions: 150 → 80 字符
- search_read_books: 150 → 80 字符

节省约 800 tokens

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 4: 后端 - 精简 LLM 树搜索 Prompt

### Task 4.1: 精简 TREE_SEARCH_PROMPT

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py:36-66`

- [ ] **Step 1: 替换 TREE_SEARCH_PROMPT**

将 `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py` 中的 `TREE_SEARCH_PROMPT` 替换为：

```python
# Prompt 模板（精简版）
TREE_SEARCH_PROMPT = """在目录中找到与问题最相关的 {max_results} 个章节。

文档: {doc_name}

{tree_structure_text}

问题: {query}

返回 JSON: {{"node_list": ["node_id"], "thinking": "简短推理"}}
"""
```

### Task 4.2: 移除系统消息

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py:437-479`

- [ ] **Step 1: 修改 _call_llm_async 函数**

将 `_call_llm_async` 函数中的 messages 从：

```python
messages=[
    {"role": "system", "content": "你是一个专业的文档检索助手。"},
    {"role": "user", "content": prompt},
],
```

改为：

```python
messages=[
    {"role": "user", "content": prompt},
],
```

### Task 4.3: 验证并提交

- [ ] **Step 1: 运行后端测试**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run pytest tests/ -v -k "llm_tree" --no-header`
Expected: Tests pass (or skip if no LLM tree search tests)

- [ ] **Step 2: 验证代码格式**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run ruff check src/deeppdf/services/llm_tree_search.py`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/deeppdf-api/src/deeppdf/services/llm_tree_search.py
git commit -m "refactor: 精简 LLM 树搜索 Prompt

- TREE_SEARCH_PROMPT: 600 → 150 字符 (75% 精简)
- 移除系统消息（不需要人设）
- 保持核心信息（文档名、目录结构、问题）

节省约 235 tokens/次调用

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 5: 验收测试

### Task 5.1: 前端集成测试

- [ ] **Step 1: 构建前端**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: Build successful

- [ ] **Step 2: 运行前端测试**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run test:run`
Expected: All tests pass

### Task 5.2: 验证系统提示词长度

- [ ] **Step 1: 添加临时日志输出 token 数**

在 `frontend/src/agent/context/builder.ts` 的 `buildSystemPrompt` 方法末尾添加临时日志：

```typescript
// 临时日志：输出系统提示词长度
const tokenEstimate = Math.ceil(systemPrompt.length / 4); // 粗略估算
agentLog(`[ContextBuilder] 系统提示词长度: ${systemPrompt.length} 字符, 约 ${tokenEstimate} tokens`);
```

- [ ] **Step 2: 在 Obsidian 中测试**

1. 重新加载插件 (Cmd+R)
2. 打开一个 PDF 文档
3. 发送一条消息
4. 检查控制台日志，确认 token 数减少

- [ ] **Step 3: 移除临时日志**

### Task 5.3: 最终提交

- [ ] **Step 1: 确认所有改动已提交**

Run: `git status`
Expected: No uncommitted changes

- [ ] **Step 2: 推送到远程分支**

Run: `git push origin feature/skill-platform-improvement`

---

## 验收标准 Checklist

- [ ] 前端系统提示词 token 数减少 50% 以上（~2,800 → ~1,250）
- [ ] 双链引用的核心目标在系统提示词中明确强调
- [ ] 所有工具功能保持正常
- [ ] 阅读方法论 skill 可被正确触发和加载
- [ ] 后端 LLM 树搜索 prompt 减少 70% 以上（~600 → ~150 字符）
- [ ] 前端测试通过
- [ ] 后端代码检查通过
