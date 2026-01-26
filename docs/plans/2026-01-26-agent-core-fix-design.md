# Agent 核心问题修复设计

**日期**: 2026-01-26
**版本**: v1.0
**作者**: Claude & 用户

---

## 诊断摘要

通过代码审查发现 DeepPDF Agent 的三个核心问题：

1. **记忆丧失 (Critical Memory Loss)**: `_build_messages` 完全忽略 `self.history`，每次 query 都像"第一次见面"
2. **路由虚设 (Inactive Routing)**: `RouteDecision` 类存在但从未被调用，Agent 完全依赖 LLM 自主决策
3. **循环逻辑割裂 (Loop Disconnect)**: `tool_results` 和 `self.history` 两套系统并行，没有统一为单一真理源

---

## 设计目标

- **多轮对话支持**: 单 query 内多轮工具调用保持上下文，新 query 时重置历史
- **智能路由**: 对明确简单查询使用硬约束，复杂查询保持灵活（混合模式）
- **流式输出优化**: 确保 `<thought>` 标签在后端正确闭合，在前端正确解析渲染

---

## 第一部分：统一上下文源

### 核心思想

将 `self.history` 建立为**唯一真理源（Single Source of Truth）**。

### 实现要点

#### 1. Query 启动时立即写入历史

```python
def run(self, query: str) -> str:
    # 启动新轮次: 清空旧历史
    self.history.clear()

    # 记录用户查询
    self.history.append({"role": "user", "content": query})

    # 迭代循环（不再需要 tool_results）
    while iterations < self.max_iterations:
        messages = self._build_messages()  # [System] + self.history
        # ...
```

#### 2. `_build_messages` 简化

**新签名**: `_build_messages() -> List[Dict[str, Any]]`

**逻辑**: `[System] + self.history`

**自动包含**: 之前所有的对话、工具调用、工具结果

#### 3. 废除 `tool_results` 临时列表

每次迭代后，assistant 消息和 tool 结果都追加到 `self.history`，下一次迭代直接从 `self.history` 读取完整上下文。

---

## 第二部分：激活显式路由（混合模式）

### 路由策略

| 查询类型 | 判断标准 | 可用工具 |
|---------|---------|---------|
| `fast` | 包含"哪年"、"何时"、"谁"、"什么" | 仅 `hybrid_search` |
| `slow` | 包含"分析"、"对比"、"演变"、"总结" | 全部工具 |
| `section` | 提到具体章节或页码 | `read_page` + `hybrid_search` |

### 实现要点

#### 1. 路由判断

```python
def run(self, query: str) -> str:
    route_type = RouteDecision.classify_query(query)
```

#### 2. 动态工具过滤

修改 `_get_tool_schemas()` 支持工具过滤：

```python
def _get_tool_schemas(self, allowed: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    schemas = []
    for name, tool in self.executor.tools.items():
        if allowed is None or name in allowed:
            schemas.append({...})
    return schemas
```

#### 3. LLM 调用时传入过滤后的工具

```python
response = self.client.chat.completions.create(
    model=self.llm_model,
    messages=messages,
    tools=self._get_tool_schemas(allowed=allowed_tools),  # 动态过滤
    # ...
)
```

---

## 第三部分：优化输出体验

### 后端：思考状态机

#### 状态定义

```python
class ThoughtState(IntEnum):
    CLOSED = 0   # 无待闭合标签
    PENDING = 1  # 检测到内容，准备输出
    OPENED = 2   # 已输出 <thought>，待闭合
```

#### 状态转换方法

```python
def _maybe_open_thought_tag(self) -> Generator[str, None, None]:
    """在适当时机输出开启标签"""
    if self.thought_state == ThoughtState.PENDING:
        self.thought_state = ThoughtState.OPENED
        yield "<thought>"

def _flush_thought_tag(self) -> Generator[str, None, None]:
    """输出闭合标签（如果需要）"""
    if self.thought_state == ThoughtState.OPENED:
        self.thought_state = ThoughtState.CLOSED
        yield "</thought>"
```

#### finally 保证闭合

```python
try:
    # 流式处理逻辑
    ...
finally:
    # 确保标签闭合
    yield from self._flush_thought_tag()
```

### 前端：流式解析 `<thought>` 标签

#### 问题

当前 `parseAgentContent()` 只在全量渲染时调用，流式更新时 `<thought>` 标签会直接显示为文本。

#### 修复

**文件**: `frontend/src/components/message/message.ts`

**方法**: `streamingUpdateContent()`

```typescript
private streamingUpdateContent(contentEl: HTMLElement, newContent: string): void {
    if (this.streamingAnimationFrame !== null) {
        cancelAnimationFrame(this.streamingAnimationFrame);
    }

    this.streamingAnimationFrame = requestAnimationFrame(() => {
        // 修复：流式更新时也解析 thought 标签
        const { cleanedContent, thoughts } = parseAgentContent(newContent);

        // 如果解析出思考内容，更新消息数据
        if (thoughts.length > 0) {
            this.data.agentThoughts = thoughts;
        }

        // 渲染清理后的内容（不含 thought 标签）
        if (this.app) {
            contentEl.empty();
            MarkdownRenderer.render(this.app, cleanedContent, contentEl, '', new Component());
        } else {
            contentEl.innerHTML = this.escapeHtml(cleanedContent);
        }

        this.streamingAnimationFrame = null;
    });
}
```

#### 增量更新思考组件

**方法**: `_updateThoughtsComponent()`

```typescript
private _updateThoughtsComponent(): void {
    const bubble = this.el?.querySelector('.deeppdf-message-bubble-ai');
    if (!bubble || !this.data.agentThoughts) return;

    // 移除旧的思考组件
    const oldThoughts = bubble.querySelector('.deeppdf-agent-thoughts');
    if (oldThoughts) oldThoughts.remove();

    // 创建新的思考组件（复用 render() 中的逻辑）
    const thoughtsContainer = document.createElement('div');
    thoughtsContainer.addClass('deeppdf-agent-thoughts');
    // ... 创建思考内容

    // 插入到内容区域之前
    const content = bubble.querySelector('.deeppdf-message-content');
    bubble.insertBefore(thoughtsContainer, content);
}
```

---

## 第四部分：数据流与错误处理

### 修订后的数据流

#### `run(query)` 非流式版本

```
1. run(query) 启动
   ├─ 清空 self.history（新轮次）
   ├─ 追加 {"role": "user", "content": query} 到 history
   └─ 路由判断: route_type = RouteDecision.classify_query(query)

2. 迭代循环 (max_iterations 次)
   ├─ 构建 messages = _build_messages()  # [System] + self.history
   ├─ 调用 LLM（根据 route_type 过滤工具）
   ├─
   ├─ 如果无 tool_calls:
   │  ├─ 追加 {"role": "assistant", "content": answer} 到 history
   │  └─ 返回 answer
   │
   └─ 如果有 tool_calls:
      ├─ 追加 {"role": "assistant", "tool_calls": [...]} 到 history
      └─ 对每个 tool_call:
         ├─ 执行工具
         └─ 追加 {"role": "tool", "tool_call_id": ..., "content": output} 到 history

3. 达到最大迭代次数 → 强制返回
```

### 错误处理增强

#### 1. 工具执行失败

```python
try:
    output = self.executor.execute(tool_name, **args)
except Exception as e:
    logger.error(f"[工具执行失败] {tool_name}: {e}")
    output = f"错误: {str(e)}"
```

#### 2. LLM 调用失败（重试机制）

```python
MAX_RETRIES = 2

for attempt in range(MAX_RETRIES):
    try:
        response = self.client.chat.completions.create(...)
        break
    except Exception as e:
        if attempt == MAX_RETRIES - 1:
            logger.error(f"[LLM错误] 重试失败: {e}")
            yield f"抱歉，服务暂时不可用。请稍后重试。"
            return
        logger.warning(f"[LLM警告] 第 {attempt + 1} 次调用失败，重试中...")
```

#### 3. 历史记录损坏防护

```python
def _build_messages(self) -> List[Dict[str, Any]]:
    messages = [{"role": "system", "content": self.system_prompt}]

    for msg in self.history:
        # 验证必需字段
        if "role" not in msg:
            logger.warning(f"[历史记录] 跳过无效消息: {msg}")
            continue
        messages.append(msg)

    return messages
```

### 超长查询限制

#### 配置参数

**文件**: `backend/deeppdf-api/src/deeppdf/config.py`

```python
agent_max_query_length: int = Field(
    default=8000,
    description="用户查询最大字符长度（启发式，约等于 4K-6K tokens）"
)
```

#### 验证逻辑

```python
def _validate_query_length(self, query: str) -> None:
    """验证查询长度"""
    if len(query) > settings.agent_max_query_length:
        raise AgentError(
            f"查询过长（{len(query)} 字符），"
            f"请精简到 {settings.agent_max_query_length} 字符以内。"
        )
```

#### 长度估算参考

| 语言 | 估算比例 | 8000 字符约等于 |
|------|---------|----------------|
| 纯中文 | 1 token ≈ 2-3 字符 | ~3000-4000 tokens |
| 纯英文 | 1 token ≈ 4 字符 | ~2000 tokens |
| 混合 | 1 token ≈ 2.5-3.5 字符 | ~2300-3200 tokens |

---

## 第五部分：测试策略

### 单元测试

**文件**: `backend/deeppdf-api/tests/agent/test_core.py`

```python
# 测试 _build_messages 使用 self.history
def test_build_messages_uses_history():
    agent = create_test_agent()
    agent.history = [
        {"role": "user", "content": "第一问"},
        {"role": "assistant", "content": "第一答"},
    ]
    messages = agent._build_messages()
    assert len(messages) == 3  # system + 2条历史

# 测试路由过滤工具
def test_get_tool_schemas_filters_by_route():
    agent = create_test_agent()
    fast_schemas = agent._get_tool_schemas(allowed=["hybrid_search"])
    assert len(fast_schemas) == 1
    assert fast_schemas[0]["function"]["name"] == "hybrid_search"

# 测试查询长度验证
def test_query_too_long_raises_error():
    agent = create_test_agent()
    long_query = "x" * 10000
    with pytest.raises(AgentError, match="查询过长"):
        agent._validate_query_length(long_query)
```

### 路由决策测试

**文件**: `backend/deeppdf-api/tests/agent/test_prompts.py`

```python
def test_route_decision_classify():
    assert RouteDecision.classify_query("乔布斯哪年发布iPhone？") == "fast"
    assert RouteDecision.classify_query("分析管理风格演变") == "slow"
    assert RouteDecision.classify_query("查看第10页") == "section"
```

### 思考状态机测试

```python
def test_thought_state_transitions():
    agent = create_test_agent()
    assert agent.thought_state == ThoughtState.CLOSED

    chunks = list(agent._maybe_open_thought_tag())
    assert chunks == ["<thought>"]
    assert agent.thought_state == ThoughtState.OPENED

    chunks = list(agent._flush_thought_tag())
    assert chunks == ["</thought>"]
    assert agent.thought_state == ThoughtState.CLOSED
```

### 流式输出测试

```python
def test_stream_thought_tags_closed():
    agent = create_test_agent()
    chunks = list(agent.run_stream("分析管理风格"))
    output = "".join(chunks)
    open_count = output.count("<thought>")
    close_count = output.count("</thought>")
    assert open_count == close_count
```

### 前端测试

**文件**: `frontend/src/components/message/__tests__/message.test.ts`

```typescript
describe('AIMessage.streamingUpdateContent', () => {
  it('应该在流式更新时解析 thought 标签', () => {
    const msg = createAIMessage({ isStreaming: true });
    const content = '<thought>我需要查看目录</thought>让我先看一下。';
    msg.update({ content });
    expect(msg.data.agentThoughts?.length).toBe(1);
  });
});
```

### 手动验证清单

| 功能 | 验证步骤 | 预期结果 |
|------|---------|---------|
| 多轮对话 | 发送追问 | Agent 能记住上一轮的结果 |
| 路由决策 | 发送简单/复杂问题 | 简单问题只用 hybrid_search，复杂问题用深度阅读 |
| 思考标签 | 观察流式输出 | 看到 `<thought>` 标签被正确解析为可折叠组件 |
| 历史重置 | 新查询 | 上一轮的上下文被清除 |
| 超长查询 | 发送 10000 字符查询 | 返回友好错误提示 |

---

## 文件修改清单

### 后端

| 文件 | 修改内容 |
|------|---------|
| `src/deeppdf/agent/core.py` | 统一使用 `self.history`，添加路由逻辑，实现思考状态机 |
| `src/deeppdf/agent/prompts.py` | 确保 `RouteDecision` 导出正确 |
| `src/deeppdf/config.py` | 添加 `agent_max_query_length` 配置 |
| `tests/agent/test_core.py` | 新增单元测试 |

### 前端

| 文件 | 修改内容 |
|------|---------|
| `src/components/message/message.ts` | 修改 `streamingUpdateContent` 解析 thought 标签，添加 `_updateThoughtsComponent` |
| `src/components/message/__tests__/message.test.ts` | 新增流式更新测试 |

---

## 实施顺序

1. **后端核心修改**
   - 修改 `_build_messages` 使用 `self.history`
   - 修改 `_get_tool_schemas` 支持工具过滤
   - 在 `run()` 和 `run_stream()` 中添加路由逻辑

2. **后端状态机**
   - 实现 `ThoughtState` 枚举和状态转换方法
   - 在流式输出中集成状态机

3. **前端修复**
   - 修改 `streamingUpdateContent` 解析 thought 标签
   - 添加增量更新思考组件的逻辑

4. **测试**
   - 编写单元测试
   - 手动验证核心流程

---

## 验收标准

- [ ] 单元测试覆盖率 > 80%
- [ ] 追问能正确获取上一轮的上下文
- [ ] 简单查询只调用 `hybrid_search`
- [ ] 复杂查询能使用全部工具
- [ ] 流式输出中 `<thought>` 标签正确闭合
- [ ] 前端正确显示可折叠的思考组件
- [ ] 超长查询返回友好错误提示
