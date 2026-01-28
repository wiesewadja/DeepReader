# LLMTreeSearchTool 设计文档

**日期**: 2025-01-28
**作者**: Claude
**状态**: 设计阶段

---

## 概述

`LLMTreeSearchTool` 是一个新的检索工具，与现有的 `HybridSearchTool` 并存，让 AI 根据查询复杂度自主选择使用哪个工具。

### 核心特性

- **两阶段检索**：粗筛（HybridSearchTool）→ 精排（LLM 推理）
- **动态模型选择**：根据子树大小选择轻量或强推理模型
- **优雅降级**：失败时自动回退到 HybridSearchTool
- **5分钟缓存**：平衡性能和一致性
- **统一返回格式**：与 HybridSearchTool 保持一致，包含 `obsidian_link`

---

## 架构设计

### 两阶段检索架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  阶段 1: 粗筛 (HybridSearchTool)                                   │
│  └─ 快速获取 Top-20 候选节点                                        │
│                 ↓                                                   │
│  阶段 2: 精排 (LLM 树搜索)                                         │
│  └─ 候选子树 → LLM 推理 → 最终 node_list                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 模型选择策略

| 子树大小 | 选用模型 | 原因 |
|----------|----------|------|
| ≤ 10 个节点 | 轻量模型（DeepSeek-V3） | 成本低，响应快 |
| > 10 个节点 | 强推理模型（DeepSeek-R1） | 复杂度更高，需要更强推理 |

---

## 组件设计

### LLMTreeSearchTool 类

```python
class LLMTreeSearchTool:
    """基于 LLM 推理的树搜索工具"""

    name: str = "llm_tree_search"
    description: str = "基于深度理解的智能检索，通过分析文档逻辑结构找到相关章节。适合跨章节推理、模糊问题或需要理解文档整体脉络的查询。"

    def __init__(
        self,
        hybrid_search_tool: HybridSearchTool,
        markdown_locator: MarkdownLocator,
        node_map: Dict[str, Any],
        llm_client: LLMClient,
        cache_ttl: int = 300,  # 5分钟
    ):
        ...
```

### PromptBuilder 工具类

```python
class PromptBuilder:
    """根据候选子树动态构建 Prompt"""

    def build(
        self,
        query: str,
        candidate_tree: Dict[str, Any],
    ) -> str:
        """根据树中是否有 summary 字段，选择对应模板"""
        ...
```

---

## 数据流

```
用户查询
   ↓
检查缓存 ({query: result}) → 命中则直接返回
   ↓ 未命中
[STAGE1] 调用 HybridSearchTool(query, top_k=20)
   ↓
构建候选子树（移除 text，保留 summary/title）
   ↓
根据节点数选择 LLM 模型
   ↓
[STAGE2] 调用 LLM → 解析 {"thinking": "...", "node_list": [...]}
   ↓ 解析失败？
   ├─ 是 → [FALLBACK] 返回 HybridSearchTool 原始结果
   └─ 否 → 根据 node_list 生成结构化结果
   ↓
缓存结果（5分钟）→ 返回
```

### 返回格式

```json
[
  {
    "node_id": "node_1",
    "obsidian_link": "[[chapter1.md#^page-5]]",
    "page": 5,
    "anchor": "^page-5",
    "text": "文档片段内容..."
  }
]
```

---

## 工具对比

| 工具 | 适用场景 | 典型查询 |
|------|----------|----------|
| `hybrid_search` | 特定内容定位、关键词查找、向量相似度匹配 | "XXX 是什么"、"在哪些地方提到了 XXX" |
| `llm_tree_search` | 跨章节推理、模糊问题、需要理解文档逻辑 | "XXX 对整个项目的影响是如何传递的"、"作者在不同章节中对 XXX 的态度变化" |

---

## Prompt 模板

### 有 summary 字段

```
问题：{query}

文档候选章节（共 {node_count} 个）：
{tree_structure_with_summary}

请分析上述章节，找出最可能包含答案的节点。

返回 JSON 格式：
{{"thinking": "你的推理过程", "node_list": ["node_id1", "node_id2"]}}
```

### 无 summary 字段

```
问题：{query}

文档候选章节标题（共 {node_count} 个）：
{tree_structure_titles_only}

请根据章节标题判断相关性，找出可能相关的节点。

返回 JSON 格式：
{{"thinking": "你的推理过程", "node_list": ["node_id1", "node_id2"]}}
```

---

## 错误处理

| 错误类型 | 处理方式 |
|----------|----------|
| LLM API 失败 | 记录 `[FALLBACK]` 日志，返回 HybridSearchTool 结果 |
| JSON 解析失败 | 尝试修复，失败则回退 |
| 空结果 | 使用候选节点的 Top-5 |
| 候选 > 50 节点 | 截断到 Top-30 |

---

## Log 标识规范

所有 `LLMTreeSearchTool` 相关的日志使用统一前缀 `[LLM_TREE_SEARCH]`：

| 标识 | 用途 |
|------|------|
| `[LLM_TREE_SEARCH]` | 通用前缀 |
| `[LLM_TREE_SEARCH][CACHE]` | 缓存命中/未命中 |
| `[LLM_TREE_SEARCH][STAGE1]` | 粗筛阶段 |
| `[LLM_TREE_SEARCH][STAGE2]` | 精排阶段 |
| `[LLM_TREE_SEARCH][FALLBACK]` | 降级触发 |
| `[LLM_TREE_SEARCH][PROMPT]` | Prompt 构建 |
| `[LLM_TREE_SEARCH][RESULT]` | 最终结果 |

---

## 测试场景

1. **正常流程**：查询 → 缓存未命中 → 两阶段检索 → 返回结果
2. **缓存命中**：重复查询 → 直接返回缓存结果
3. **LLM 失败降级**：模拟 API 错误 → 验证回退逻辑
4. **JSON 解析失败**：模拟非标准 JSON → 验证修复逻辑
5. **大文档截断**：候选 > 50 节点 → 验证截断逻辑
