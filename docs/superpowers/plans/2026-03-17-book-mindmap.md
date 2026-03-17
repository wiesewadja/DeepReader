# Book Mindmap Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `book-mindmap` skill to DeepReader that generates knowledge structure mindmaps for entire books, with book type detection and chapter linking.

**Architecture:** This is a pure LLM-instruction implementation. The skill content guides the Agent to call existing tools (get_toc, get_chapter, excalidraw) in a specific workflow. No new code modules needed.

**Tech Stack:** TypeScript, Obsidian Plugin API

---

## File Structure

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/built-in-skills.ts` | Modify | Add `book-mindmap` skill definition to the array |

---

## Chunk 1: Add book-mindmap Skill

### Task 1: Add book-mindmap skill to built-in-skills.ts

**Files:**
- Modify: `frontend/src/built-in-skills.ts:549-551` (before the closing `];`)

- [ ] **Step 1: Add the new skill object before the closing bracket**

Find the end of the `BUILT_IN_SKILLS` array (the `];` on line 551) and add the new skill before it:

```typescript
    },
    {
        filename: "book-mindmap.md",
        content: `---
name: book-mindmap
description: 生成书籍知识结构思维导图 - 基于书籍类型自动选择合适的结构，提取核心知识而非简单罗列章节
keywords:
  - 书籍思维导图
  - 全书结构
  - 知识框架
  - 书籍概览
  - 整理这本书
---

# Book Mindmap 书籍思维导图

## 触发场景

- "生成这本书的思维导图"
- "帮我梳理这本书的知识结构"
- "这本书讲了什么，画个图"
- "整理这本书的框架"

## 核心原则

**书籍思维导图 ≠ 章节目录图**

- ❌ 错误：简单罗列章节标题
- ✅ 正确：提取知识结构，呈现概念关系

## 执行流程

### 步骤 1：获取目录

调用 \`get_toc\` 获取书籍目录结构。

**错误处理**：
- 如果目录为空或获取失败，告知用户"无法获取目录，请确认书籍已正确索引"
- 如果书籍只有 1-2 个章节，提示用户"章节较少，可能不适合生成思维导图"

### 步骤 2：判断书籍类型

根据目录特征判断书籍类型：

| 类型 | 目录特征 | 标题特征 |
|------|----------|----------|
| **理论性** | "理论"、"原理"、"哲学"；递进论证结构 | "论"、"分析"、"研究" |
| **实用性** | "指南"、"手册"、"方法"；步骤/模块结构 | "如何"、"步骤"、"技巧" |
| **叙事性** | "章"、"卷"、"部"；时间/情节结构 | 人物名、地名、事件名 |

**默认**：无法判断时默认为理论性

### 步骤 3：选择结构模板

根据书籍类型选择对应的结构：

**理论性 → 问题驱动**：
\`\`\`
书名
├── 核心问题1 [[对应章节]]
│   ├── 论点
│   └── 论据
├── 核心问题2 [[对应章节]]
└── 核心结论 [[对应章节]]
\`\`\`

**实用性 → 目标驱动**：
\`\`\`
书名
├── 目标1 [[对应章节]]
│   ├── 步骤
│   └── 要点
├── 目标2 [[对应章节]]
└── 总结清单 [[对应章节]]
\`\`\`

**叙事性 → 情节驱动**：
\`\`\`
书名
├── 主要人物 [[对应章节]]
├── 情节主线 [[对应章节]]
│   ├── 起因
│   ├── 发展
│   ├── 高潮
│   └── 结局
└── 主题寓意 [[对应章节]]
\`\`\`

### 步骤 4：提取知识结构

遍历章节，提取核心概念：

1. 对于每个一级章节，调用 \`get_chapter\` 获取内容
2. 根据书籍类型提取对应元素：
   - 理论性：问题、论点、论据
   - 实用性：目标、步骤、要点
   - 叙事性：人物、情节、主题
3. 组织成 3-7 个核心分支

### 步骤 5：生成思维导图

调用 \`excalidraw\` tool 生成：

\`\`\`json
{
  "tool": "excalidraw",
  "arguments": {
    "action": "mindmap",
    "topic": "书名",
    "branches": [
      {
        "label": "核心概念1 [[章节标题]]",
        "children": ["子概念A", "子概念B"]
      }
    ],
    "filename": "书名-知识结构"
  }
}
\`\`\`

## 深度选择

生成前询问用户：

> "请选择思维导图的详细程度：
> - **概览**：只显示核心结构（3-5 个分支）
> - **详细**：包含子概念展开（每个分支 3-5 个子节点）"

## 注意事项

1. 分支数量控制在 3-7 个
2. 每个分支子节点不超过 5 个
3. 嵌套深度不超过 3 层
4. 节点文本简洁，突出核心概念
5. 每个节点附加章节链接 \`[[章节标题]]\`

## 与 mindmap skill 的区别

| 维度 | mindmap | book-mindmap |
|------|---------|--------------|
| 适用范围 | 任意概念/主题 | 整本书 |
| 结构来源 | 用户/Agent 自由组织 | 书籍类型模板 |
| 提取方式 | 基于上下文 | 基于目录+章节分析 |
| 节点跳转 | 无 | 有（章节链接） |
`
    }
];
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit the changes**

```bash
git add frontend/src/built-in-skills.ts
git commit -m "feat: add book-mindmap skill for generating book knowledge structure mindmaps"
```

---

## Verification

After implementation, verify:

1. **Build passes**: `npm run build` in frontend directory
2. **Skill is registered**: The skill appears in the built-in skills list
3. **Manual test**: In Obsidian, trigger the skill by saying "生成这本书的思维导图"

---

## Dependencies

- Existing `get_toc` tool
- Existing `get_chapter` tool
- Existing `excalidraw` tool

No new dependencies required.