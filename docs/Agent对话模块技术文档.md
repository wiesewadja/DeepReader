# Agent 对话模块技术文档

> 生成日期: 2026-03-06
> 基于 feature/chapter-reading-optimization 分支

---

## 一、模块概述

Agent 对话模块是 DeepReader 的核心交互组件，基于 **ReAct 模式** 实现 Tool-Calling Agent，为用户提供智能文档问答服务。

### 核心特性

| 特性 | 说明 |
|------|------|
| **ReAct 循环** | 推理-行动循环，支持多轮工具调用 |
| **流式输出** | SSE 流式响应，实时展示推理过程 |
| **智能路由** | 根据查询类型自动选择最优策略 |
| **多 LLM 支持** | DeepSeek / OpenAI (OpenAI 兼容 API) |
| **多轮对话** | 会话级别历史记忆 |
| **跨书籍搜索** | 在所有已索引书籍中检索 |

---

## 二、架构设计

### 2.1 模块结构

```
backend/deeppdf-api/src/deeppdf/agent/
├── __init__.py          # 模块导出
├── core.py              # Agent 核心类 (DeepPDFAgent)
├── executor.py          # 工具执行器 (ToolExecutor)
├── tools.py             # 工具定义
├── prompts.py           # System Prompt 和路由逻辑
├── prompt_builder.py    # Prompt 构建器
└── markdown_locator.py  # Markdown 文件定位器
```

### 2.2 类关系图

```
┌─────────────────────────────────────────────────────────────┐
│                      DeepPDFAgent                           │
│  - ReAct 主循环                                              │
│  - 流式/非流式输出                                           │
│  - 会话历史管理                                              │
└─────────────────────────┬───────────────────────────────────┘
                          │ 组合
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      ToolExecutor                           │
│  - 工具注册与调度                                            │
│  - 并行执行支持                                              │
│  - 错误处理                                                  │
└─────────────────────────┬───────────────────────────────────┘
                          │ 管理
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      Tools (工具集)                          │
│  ├── InspectTocTool      # 查看目录                         │
│  ├── ReadPageTool        # 读取页面                         │
│  ├── HybridSearchTool    # 混合检索                         │
│  ├── LLMTreeSearchTool   # LLM 树搜索                       │
│  ├── CrossBookSearchTool # 跨书籍搜索                       │
│  └── ListAvailableBooksTool # 列出书籍                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 数据流

```
用户查询
    │
    ▼
┌─────────────────┐
│  路由判断       │ ──── classify_query() ──── fast/section/slow
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  ReAct 循环     │ ◄────────────────────────────┐
└────────┬────────┘                              │
         │                                       │
         ▼                                       │
┌─────────────────┐                              │
│  LLM 调用       │ ──── tools=[...] ────        │
└────────┬────────┘                              │
         │                                       │
         ▼                                       │
    有工具调用？                                  │
         │                                       │
    ┌────┴────┐                                  │
   Yes        No                                 │
    │          │                                 │
    ▼          ▼                                 │
┌────────┐  ┌────────┐                          │
│ 执行   │  │ 返回   │                          │
│ 工具   │  │ 答案   │                          │
└───┬────┘  └────────┘                          │
    │                                           │
    └───────────────────────────────────────────┘
```

---

## 三、核心组件详解

### 3.1 DeepPDFAgent (core.py)

Agent 核心类，实现 ReAct 推理循环。

#### 初始化参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `index_id` | str | - | PDF 索引 ID |
| `storage_dir` | str | - | 存储目录路径 |
| `tree_structure` | Dict | - | 文档树状结构 |
| `index_metadata` | Dict | {} | 完整索引元数据 |
| `llm_provider` | str | "deepseek" | LLM 提供商 |
| `llm_model` | str | 自动选择 | 模型名称 |
| `temperature` | float | settings.agent_temperature | 采样温度 |
| `top_p` | float | settings.agent_top_p | nucleus 采样 |
| `max_iterations` | int | settings.agent_max_iterations | 最大迭代次数 |
| `cross_book_mode` | bool | False | 跨书籍模式 |
| `enable_llm_tree_search` | bool | False | 启用 LLM 树搜索 |

#### 核心方法

```python
# 非流式对话
def run(
    self,
    query: str,
    force_mode: Optional[str] = None,  # "fast"/"section"/"slow"
    keep_history: bool = True
) -> str

# 流式对话
def run_stream(
    self,
    query: str,
    force_mode: Optional[str] = None,
    keep_history: bool = True
) -> Generator[str, None, None]

# 重置历史
def reset_history(self)

# 获取历史
def get_history(self) -> List[Dict[str, Any]]
```

#### LLM Provider 映射

| Provider | Base URL | 默认模型 |
|----------|----------|----------|
| deepseek | https://api.deepseek.com | deepseek-chat |
| openai | https://api.openai.com/v1 | gpt-4o-mini |
| anthropic | - | 暂不支持 |

### 3.2 工具执行器 (executor.py)

#### ToolExecutor

```python
class ToolExecutor:
    def __init__(self, tools: Dict[str, Tool])
    def execute(self, tool_name: str, **kwargs) -> str
    def get_tool_descriptions(self) -> str
```

#### 工具创建函数

```python
def create_tool_executor(
    index_id: str,
    storage_dir: str,
    tree_structure: Dict[str, Any],
    pageindex_lib_path: Optional[str] = None,
    markdown_locator: Optional[MarkdownLocator] = None,
    enable_llm_tree_search: bool = False,
    llm_client: Optional[Any] = None,
    index_metadata: Optional[Dict[str, Any]] = None,
    deepseek_ocr_client: Optional[Any] = None,
) -> ToolExecutor

def create_cross_book_executor(
    storage_dir: str,
) -> ToolExecutor
```

### 3.3 工具集 (tools.py)

#### 工具协议

```python
class Tool(Protocol):
    name: str
    description: str
    def __call__(self, **kwargs) -> str
```

#### 工具清单

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `inspect_toc` | 查看目录结构 | 无 |
| `read_page` | 读取指定页码 | `page_num: int`, `force_visual: bool` |
| `hybrid_search` | 混合检索 | `query: str`, `top_k: int` |
| `llm_tree_search` | LLM 树搜索 | `query: str`, `top_k: int` |
| `cross_book_search` | 跨书籍搜索 | `query: str`, `top_k: int` |
| `list_available_books` | 列出书籍 | 无 |

#### 工具返回格式

**hybrid_search 返回格式**:
```json
[
  {
    "text": "文档片段内容...",
    "page": 5,
    "obsidian_link": "[[chapter1.md#^page-5|第5页]]",
    "anchor": "^page-5",
    "node_id": "node_1"
  }
]
```

**read_page 返回格式**:
```
# 第 N 页内容

**章节**: 章节名称

页面正文内容...
```

### 3.4 System Prompt (prompts.py)

#### Prompt 版本

| 版本 | 说明 |
|------|------|
| V1 | 基础版本，结构化输出 |
| V2 | 优化版本，"读书郎"人设，段落式叙述 |

#### V2 核心约束

```markdown
1. 格式规范: 段落式叙述，避免列表和标题，用**加粗**标记重点
2. 引用要求: 每个论断必须有引用，使用工具返回的 obsidian_link
3. 全面性: 先看目录，整合多章节，引用 3-5 个页码
4. 表达风格: 平和内敛，直接详实
```

#### 路由决策 (RouteDecision)

```python
class RouteDecision:
    # 简单事实查询关键词
    FAST_TRACK_KEYWORDS = ["哪年", "何时", "什么时候", "谁", "什么", "是否", "有没有", "多少"]

    # 复杂分析关键词
    SLOW_TRACK_KEYWORDS = ["分析", "对比", "比较", "演变", "变化", "发展", "总结", "归纳", "为什么", "如何"]

    # 章节查询关键词
    SECTION_KEYWORDS = ["第", "章", "节", "页"]

    @classmethod
    def classify_query(cls, query: str) -> str:
        # 返回: "fast" | "slow" | "section"
```

#### 路由与工具映射

| 路由类型 | 可用工具 | 场景 |
|----------|----------|------|
| `fast` | hybrid_search | 简单事实查询 |
| `section` | read_page, hybrid_search | 章节定位查询 |
| `slow` | 全部工具 | 复杂分析任务 |

---

## 四、API 端点

### 4.1 非流式对话

```http
POST /api/agent/query
Content-Type: application/json

{
  "index_id": "abc123",
  "query": "这本书的核心观点是什么？",
  "force_mode": null,        // 可选: "fast"/"section"/"slow"
  "keep_history": true,      // 可选: 是否保留历史
  "context_docs": []         // 可选: 上下文文档
}
```

**响应**:
```json
{
  "response": "昭见森，这本书的核心思想...",
  "citations": [
    {
      "text": "...",
      "page": 10,
      "obsidian_link": "[[intro.md#^page-10|第10页]]"
    }
  ]
}
```

### 4.2 流式对话

```http
POST /api/agent/stream
Content-Type: application/json

{
  "index_id": "abc123",
  "query": "总结第三章的内容",
  "force_mode": null,
  "keep_history": true
}
```

**响应**: SSE 流式输出

```
data: {"type": "content", "text": "昭见森"}

data: {"type": "content", "text": "，"}

data: {"type": "content", "text": "关于第三章"}

data: {"type": "done"}
```

---

## 五、ReAct 循环详解

### 5.1 流式输出阶段

```python
def run_stream(self, query: str, ...):
    # 阶段1: 初始化
    # - 验证查询长度
    # - 清空/保留历史
    # - 构建用户消息

    # 阶段2: 路由判断
    # - 自动路由 或 强制模式
    # - 确定可用工具列表

    while iterations < max_iterations:
        # 阶段3: 迭代推理
        # - 构建消息列表

        # 阶段4: LLM 调用
        # - 流式请求
        # - 发送进度提示

        # 阶段5: 解析响应
        # - 收集内容
        # - 收集工具调用

        if tool_calls:
            # 阶段6: 工具调用
            # - 并行执行工具
            # - 记录结果
        else:
            # 阶段7: 最终答案
            # - 保存历史
            # - 返回结果

    # 阶段8: 达到最大迭代
    # - 强制结束
```

### 5.2 进度提示

| 迭代 | 提示文本 |
|------|----------|
| 第1轮 | `\n\n分析中\n\n` |
| 第2轮+ | `\n\n整理中\n\n` |
| 工具: inspect_toc | `\n\n查目录\n\n` |
| 工具: hybrid_search | `\n\n查看中\n\n` |
| 工具: read_page | `\n\n阅读中\n\n` |

### 5.3 并行工具执行

```python
with ThreadPoolExecutor(max_workers=3) as executor:
    future_to_task = {
        executor.submit(self.executor.execute, task["tool_name"], **task["args"]): task
        for task in tool_tasks
    }
    for future in as_completed(future_to_task):
        output = future.result()
        # 记录结果
```

---

## 六、视觉密集型 PDF 支持

### 6.1 检测机制

```python
# 索引时检测
visual_heavy = index_metadata.get("visual_heavy", False)
```

### 6.2 ReadPageTool 读取策略

```
is_visual_heavy = True
    │
    ├── force_visual = True
    │       └── DeepSeek OCR 视觉推理
    │
    └── force_visual = False (默认)
            │
            ├── 尝试从 markdown 文件读取
            │       └── 缓存命中 → 返回内容
            │
            └── 缓存未命中 → DeepSeek OCR
```

### 6.3 Markdown 缓存命中逻辑

1. 根据页码查找包含该页的章节节点
2. 选择范围最小的节点（最精确匹配）
3. 从 markdown 文件中提取页面内容
4. 使用正则匹配页面分隔符 `### 第 N 页^page-N`

---

## 七、会话管理

### 7.1 历史结构

```python
# 会话级别历史（多轮对话）
self.session_history: List[Dict[str, Any]] = []

# 当前轮次历史（工具调用等）
self.current_turn_history: List[Dict[str, Any]] = []
```

### 7.2 消息格式

```python
# 用户消息
{"role": "user", "content": "..."}

# 助手消息（含工具调用）
{
    "role": "assistant",
    "content": "...",
    "tool_calls": [{"id": "...", "type": "function", "function": {...}}]
}

# 工具结果
{"role": "tool", "tool_call_id": "...", "content": "..."}
```

### 7.3 历史保存时机

- 正常结束：工具调用完成后返回最终答案时
- 达到最大迭代：强制结束时
- 仅当 `keep_history=True` 时保存

---

## 八、错误处理

### 8.1 异常类型

| 异常 | 说明 |
|------|------|
| `AgentError` | Agent 基础异常 |
| `LLMError` | LLM 调用失败 |
| `ToolExecutionError` | 工具执行失败 |
| `MaxIterationsError` | 达到最大迭代 |

### 8.2 工具执行错误处理

```python
try:
    result = tool(**kwargs)
    return f"[SUCCESS] {result}"
except ValueError as e:
    return f"[ERROR] 参数错误: {e}"
except FileNotFoundError as e:
    return "[ERROR] 文件不存在，请确认索引有效"
except Exception as e:
    return f"[ERROR] 工具执行失败: {str(e)[:100]}"
```

### 8.3 DeepSeek 内部标签清理

```python
# 清理 <|DSML|function_calls> 等内部格式
DEEPSEEK_INTERNAL_TAG_PATTERN = re.compile(
    r"<[|｜]DSML[|｜]function_calls[|｜]>.*?</[|｜]DSML[|｜]function_calls[|｜]>|"
    r"<[|｜]DSML[|｜][^>]*>.*?</[|｜]DSML[|｜][^>]*>|"
    r"</?[|｜]DSML[|｜][^>]*>",
    re.DOTALL
)
```

---

## 九、配置项

### 9.1 后端配置 (config.py)

| 配置项 | 说明 |
|--------|------|
| `agent_temperature` | 采样温度 |
| `agent_top_p` | nucleus 采样参数 |
| `agent_max_iterations` | 最大迭代次数 |
| `agent_max_query_length` | 最大查询长度 |
| `deepseek_ocr_api_key` | OCR API 密钥 |

### 9.2 前端设置

| 设置项 | 说明 |
|--------|------|
| `force_mode` | 强制路由模式 |
| `keep_history` | 是否保留历史 |
| `debug_log` | 调试日志开关 |

---

## 十、性能优化

### 10.1 缓存策略

| 组件 | 缓存类型 |
|------|----------|
| `InspectTocTool` | 实例级缓存 `_cache` |
| `HybridSearchTool` | 查询缓存 `_search_cache` |
| `LLMTreeSearchTool` | TTL 缓存 (300s) |
| `ListAvailableBooksTool` | 实例级缓存 |

### 10.2 并行执行

- 工具调用并行执行 (`ThreadPoolExecutor`, max_workers=3)
- 使用 `as_completed` 按完成顺序收集结果

### 10.3 Token 优化

- 路由限制可用工具，减少 token 消耗
- fast 模式仅使用 hybrid_search
- section 模式仅使用 read_page + hybrid_search

---

## 十一、引用格式规范

### 11.1 正确格式

```markdown
[[文件名.md#^page-N|显示文本]]
[[chapter1.md#^page-25|第25页]]
[[intro.md#^page-10|第10页]]
```

### 11.2 验证正则

```python
CITATION_PATTERN = re.compile(
    r"\[\[([^\]]+?)#\^page-(\d+)(?:,\s*第(\d+)段)?(?:\|([^\]]+))?\]\]"
)
```

### 11.3 引用原则

1. 陈述后立即添加引用
2. 必须包含具体页码
3. 使用自然语言引入（"根据"、"如...所说"）
4. 只引用实际使用的内容

---

## 十二、调试日志

### 12.1 日志级别

Agent 模块使用详细的日志输出，便于调试：

```
🚀 [Agent推理] 开始新的推理过程
📝 [用户查询] {query}
📊 [查询长度] {len} 字符
💬 [保留历史] {keep_history}
📚 [会话历史] 当前有 {n} 条历史消息

🧭 [路由判断] 开始分析查询类型
🔍 [自动路由] 查询类型: {route_type}
🛠️  [可用工具] {tools}

🔄 [第 {n} 轮迭代] 开始推理
🤖 [LLM调用] 准备调用 {model}
✅ [LLM调用] 成功，开始接收流式响应

🔧 [工具调用] 检测到 {n} 个工具调用
🛠️  [{n}/{total}] 完成工具: {tool_name}
📤 返回长度: {len} 字符

🎉 [推理完成] LLM 返回最终答案
💾 [会话历史] 已保存本轮对话
```

---

## 十三、扩展指南

### 13.1 添加新工具

1. 在 `tools.py` 中定义工具类：

```python
class MyNewTool:
    name: str = "my_new_tool"
    description: str = "工具描述..."

    def __init__(self, ...):
        pass

    def __call__(self, **kwargs) -> str:
        # 实现工具逻辑
        return "结果字符串"
```

2. 在 `core.py` 中添加参数 schema：

```python
def _get_tool_parameters(self, name: str, tool: Tool) -> Dict[str, Any]:
    if name == "my_new_tool":
        return {
            "type": "object",
            "properties": {
                "param1": {"type": "string", "description": "..."}
            },
            "required": ["param1"]
        }
```

3. 在 `executor.py` 中注册工具：

```python
tools["my_new_tool"] = MyNewTool(...)
```

### 13.2 自定义 Prompt

```python
from deeppdf.agent.prompts import PromptBuilder

builder = PromptBuilder(
    tool_descriptions=executor.get_tool_descriptions(),
    enable_few_shot=True,
    version=2
)
system_prompt = builder.build()
```

---

## 十四、常见问题

### Q1: 如何切换 LLM Provider？

```python
agent = DeepPDFAgent(
    ...,
    llm_provider="openai",
    llm_model="gpt-4o-mini",
    api_key="sk-..."
)
```

### Q2: 如何禁用历史记忆？

```python
response = agent.run(query, keep_history=False)
# 或流式
for chunk in agent.run_stream(query, keep_history=False):
    yield chunk
```

### Q3: 如何强制使用特定模式？

```python
# 强制快速检索
response = agent.run(query, force_mode="fast")

# 强制复杂分析
response = agent.run(query, force_mode="slow")
```

### Q4: 视觉密集型 PDF 如何处理？

确保配置 `DEEPSEEK_OCR_API_KEY`，Agent 会自动检测 `visual_heavy` 标记并使用 OCR。

---

*本文档基于 DeepReader Agent 对话模块源码整理，涵盖核心架构、工具系统、Prompt 设计和扩展指南。*
