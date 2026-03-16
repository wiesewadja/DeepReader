# 系统提示词优化设计

> 日期: 2026-03-16
> 状态: 待实施

## 背景

当前系统提示词过长（约 2,800 tokens），存在以下问题：

1. **Identity 层冗余**：阅读方法论详细说明占用大量 token，且与工具描述重复
2. **Constraints 层过长**：包含过多示例和重复内容
3. **工具描述过于详细**：每个工具描述约 150-200 字符，且包含已在 Identity 层说明的场景信息
4. **核心目标不够突出**：双链引用是产品核心价值，但当前强调不足

## 目标

- 减少系统提示词约 55% tokens（~2,800 → ~1,250）
- **加强**双链引用的核心目标强调
- 将阅读方法论提取为 skill，利用分层加载机制
- 保持功能完整性

## 设计方案

### 1. 新增 Skill: `reading-methodology`

将阅读方法论提取为默认 skill，利用分层机制：
- **Layer 1 (description)**：在系统提示词中可见（~50 tokens）
- **Layer 2 (body)**：按需加载，通过 Skill 工具调用

**文件**: `frontend/src/built-in-skills.ts`

```yaml
---
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
```

### 2. 精简 Identity 层

**文件**: `frontend/src/agent/context/builder.ts`

**改动点**：
- 移除详细的阅读方法论（提取为 skill）
- 移除工具选择指南表格（提取为 skill）
- **新增**核心使命部分，强调双链引用
- 保留 Obsidian 工作环境说明

```typescript
private buildIdentityLayer(metadata?: DocumentMetadata): string {
    let docInfo = '';
    if (metadata?.title) {
        docInfo = `

## 当前文档
- 标题: ${metadata.title}
- 总页数: ${metadata.page_count || '未知'}`;
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

### 3. 精简 Constraints 层

**文件**: `frontend/src/agent/context/builder.ts`

**改动点**：
- 合并为 4 条核心规则
- **保留并加强**双链引用规则（作为第 1 条）
- 移除重复的效率原则说明
- 移除详细示例

```typescript
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
- 平和内敛，偶有点睛感悟`;
}
```

### 4. 精简工具描述

**原则**：保留场景标签，精简到 ~80 字符

| 工具 | 优化前 | 优化后 |
|------|--------|--------|
| search_doc | ~200 字符 | `【检视阅读】搜索文档内容。用于"讲什么/总结"类问题。传入完整问题（非关键词）。` |
| get_chapter | ~150 字符 | `【分析阅读】获取章节完整内容。用于"详细解释/为什么"类问题。支持分页读取。` |
| get_toc | ~100 字符 | `【检视阅读】获取文档目录结构。用于了解书籍整体框架。` |
| outline_structure | ~150 字符 | `【分析阅读】提取书籍结构和纲要。用于"结构如何/如何组织"类问题。` |
| find_key_terms | ~150 字符 | `【分析阅读】识别书籍关键术语。用于理解核心概念。` |
| extract_propositions | ~150 字符 | `【分析阅读】提取核心论点和主旨。用于理解作者观点。` |
| search_read_books | ~150 字符 | `【主题阅读】搜索已读书库。用于跨书比较和关联。` |

## 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `frontend/src/built-in-skills.ts` | 新增 | 添加 `reading-methodology` skill |
| `frontend/src/agent/context/builder.ts` | 修改 | 精简 Identity 和 Constraints 层 |
| `frontend/src/agent/tools/search-doc.ts` | 修改 | 精简 description |
| `frontend/src/agent/tools/get-chapter.ts` | 修改 | 精简 description |
| `frontend/src/agent/tools/get-toc.ts` | 修改 | 精简 description |
| `frontend/src/agent/tools/outline-structure.ts` | 修改 | 精简 description |
| `frontend/src/agent/tools/find-key-terms.ts` | 修改 | 精简 description |
| `frontend/src/agent/tools/extract-propositions.ts` | 修改 | 精简 description |
| `frontend/src/agent/tools/search-read-books.ts` | 修改 | 精简 description |

## Token 节省预估

| 部分 | 优化前 | 优化后 | 节省 |
|------|--------|--------|------|
| Identity | ~900 | ~350 | ~550 |
| Constraints | ~600 | ~400 | ~200 |
| Tools (13个) | ~1,300 | ~500 | ~800 |
| **总计** | **~2,800** | **~1,250** | **~1,550 (55%)** |

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 阅读方法论作为 skill 可能不被触发 | LLM 可能不知道何时用什么工具 | skill 设置为 default:true，description 始终可见；工具描述保留场景标签 |
| 引用格式示例移除后 LLM 可能出错 | 用户可能看到格式错误的引用 | 工具返回的 Link 字段已包含正确格式，LLM 只需直接使用 |
| 约束减少后 LLM 可能过度搜索 | token 消耗增加 | 保留"2-3 章节即回答"的核心效率规则 |

## 验收标准

1. 系统提示词 token 数减少 50% 以上
2. 双链引用的核心目标在系统提示词中明确强调
3. 所有工具功能保持正常
4. 阅读方法论 skill 可被正确触发和加载
