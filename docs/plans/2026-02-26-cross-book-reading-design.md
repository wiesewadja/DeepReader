# 跨书籍联合阅读功能设计

## 概述

**功能名称**：跨书籍联合阅读（Cross-Book Reading）

**目标用户**：需要跨多本书籍进行主题研究、观点对比、知识串联的深度阅读用户

**核心价值**：
- 主题研究：在所有已索引书籍中搜索特定主题
- 观点对比：对比不同书籍对同一话题的看法
- 知识串联：发现不同书籍之间的知识关联

---

## 方案选择

### 方案 1：模式切换开关（已选定）

**架构**：
```
用户提问 → 模式判断 →
  单书籍模式 → smart_search (当前书籍)
  跨书籍模式 → cross_book_search (全库搜索)
```

**优点**：
- 最小改动：复用现有架构，只需新增一个工具和前端开关
- 渐进增强：后续可以优化为智能路由
- 可控性强：用户明确知道当前是单书籍还是跨书籍模式
- 风险低：不影响现有单书籍对话功能

---

## 详细设计

### 1. 用户界面

在现有对话面板顶部（输入框上方）添加模式切换开关：

```
┌─────────────────────────────────────────────────────────┐
│  📖 当前书籍：如何阅读一本书                              │
│  ┌─────────────────────────────────────────────────────┐│
│  │  [单书籍模式] ══════════ [跨书籍模式]               ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  [消息列表区域...]                                       │
│                                                         │
│  [输入框]                                                │
└─────────────────────────────────────────────────────────┘
```

**交互细节**：
- **单书籍模式**（默认）：仅在当前选中的书籍中搜索，行为与现在一致
- **跨书籍模式**：在所有已索引书籍中搜索
- 切换时有短暂提示：「已切换到跨书籍模式，将在所有书籍中搜索」
- 状态保存在当前会话中（不持久化）

**前端改动**：
- `sidebar-view.ts`: 添加 `crossBookMode: boolean` 状态
- `chat-input.ts` 或新建组件：添加切换开关 UI

---

### 2. 后端 API

#### 新增端点：POST /api/cross-book/search

**请求体**：
```json
{
  "query": "什么是系统思考",
  "index_ids": ["idx_xxx1", "idx_xxx2"],  // 可选，不传则搜索全部
  "top_k": 5
}
```

**响应体**：
```json
{
  "status": "success",
  "results": [
    {
      "text": "系统思考是一种...",
      "book_name": "如何阅读一本书",
      "index_id": "idx_xxx1",
      "section": "第一篇 阅读的层次",
      "page": 45,
      "obsidian_link": "DeepPDF/如何阅读一本书/01-第一篇.md#^page-45"
    },
    {
      "text": "第一性原理思维...",
      "book_name": "第一性原理",
      "index_id": "idx_xxx2",
      "section": "第一章",
      "page": 12,
      "obsidian_link": "DeepPDF/第一性原理/01-第一章.md#^page-12"
    }
  ],
  "books_searched": 5,
  "total_results": 12
}
```

---

### 3. Agent 集成

#### 模式切换逻辑

修改 `DeepPDFAgent` 以支持两种模式：

```python
class DeepPDFAgent:
    def __init__(
        self,
        index_id: str,
        index_metadata: Dict[str, Any],
        llm_client,
        cross_book_mode: bool = False,  # 新增参数
        all_indexes: List[Dict] = None    # 新增：跨书籍模式需要所有索引信息
    ):
        self.cross_book_mode = cross_book_mode
        self.all_indexes = all_indexes or []

        # 根据模式选择工具集
        if cross_book_mode:
            self.tools = self._init_cross_book_tools()
        else:
            self.tools = self._init_single_book_tools()
```

#### 工具集对比

| 工具 | 单书籍模式 | 跨书籍模式 |
|------|-----------|-----------|
| `inspect_toc` | ✅ 当前书籍 | ❌ 移除（无意义） |
| `read_page` | ✅ 当前书籍 | ❌ 移除（无意义） |
| `smart_search` | ✅ 当前书籍 | ✅ 保留（搜索范围不同） |
| `cross_book_search` | ❌ 移除 | ✅ 新增 |
| `list_available_books` | ❌ 移除 | ✅ 新增（列出可搜索书籍） |

#### 跨书籍模式 System Prompt

```
你是 DeepPDF 跨书籍研究助手。用户正在研究一个主题，你可以在所有已索引的书籍中搜索相关内容。

可用工具：
- cross_book_search: 在所有书籍中搜索关键词
- list_available_books: 列出当前可搜索的所有书籍

回答规范：
1. 引用内容时标注来源书籍，格式：【《书名》章节名】
2. 多本书籍有相关内容时，对比呈现不同观点
3. 如果某本书特别相关，建议用户深入阅读该书
```

---

## 文件改动清单

### 后端文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `backend/deeppdf-api/src/deeppdf/services/cross_book_search.py` | 新建 | 跨书籍搜索服务 |
| `backend/deeppdf-api/src/deeppdf/api/routes.py` | 修改 | 添加 `/api/cross-book/search` 端点 |
| `backend/deeppdf-api/src/deeppdf/api/models.py` | 修改 | 添加请求/响应模型 |
| `backend/deeppdf-api/src/deeppdf/agent/tools.py` | 修改 | 添加 `CrossBookSearchTool` |
| `backend/deeppdf-api/src/deeppdf/agent/core.py` | 修改 | 添加 `cross_book_mode` 参数支持 |
| `backend/deeppdf-api/src/deeppdf/agent/prompts.py` | 修改 | 添加跨书籍模式的 system prompt |

### 前端文件

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `frontend/src/views/sidebar-view.ts` | 修改 | 添加模式切换开关 UI |
| `frontend/src/api/http-client.ts` | 修改 | 添加 `crossBookSearch()` 方法 |
| `frontend/src/components/chat-input/chat-input.ts` | 修改 | 添加模式切换组件 |

---

## 实现步骤

```
Phase 1: 后端核心 (2-3h)
├── 1.1 实现 cross_book_search 服务
├── 1.2 添加 API 端点
└── 1.3 单元测试

Phase 2: Agent 集成 (2h)
├── 2.1 新增工具类
├── 2.2 修改 Agent 初始化逻辑
└── 2.3 调整 system prompt

Phase 3: 前端 UI (2h)
├── 3.1 模式切换开关组件
├── 3.2 API 客户端集成
└── 3.3 状态管理
```

---

## 风险评估

**风险等级**：低

**原因**：
1. 新增功能，不影响现有单书籍对话
2. 默认保持单书籍模式
3. 用户需要主动切换才会启用跨书籍功能

---

## 后续优化方向

1. **智能路由**：LLM 自动判断问题类型，选择合适的搜索模式
2. **书籍推荐**：根据问题自动推荐最相关的书籍
3. **主题聚合**：对跨书籍搜索结果进行主题聚类
4. **阅读路径**：生成跨书籍的推荐阅读路径
