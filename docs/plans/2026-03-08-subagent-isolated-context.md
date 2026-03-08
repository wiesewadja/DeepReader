# 子 Agent 上下文隔离架构实现计划（简化版）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用最简单的代码实现上下文隔离，信任模型的推理能力，不预设工作流。

**Philosophy:**
> The model already knows how to be an agent. Your job is to get out of the way.
> Give the model capabilities and knowledge. Let it figure out how to use them.

**Architecture:**
- 子 Agent = 同样的 ReAct 循环 + 全新的消息历史 + Skill 知识注入
- 不限制工具，让模型自己选择
- Skill 是知识，不是脚本
- 渐进式披露：按需加载，不要预加载

**Tech Stack:** Python 3.10+, Pydantic, OpenAI API (DeepSeek)

---

## 设计原则

### 1. 信任模型

```
❌ 不要：预设工作流、限制工具、复杂决策树
✅ 要做：提供能力、注入知识、让模型推理
```

### 2. Skill 是知识，不是配置

```
❌ 当前设计：
   - tools: ["hybrid_search"]  # 限制工具
   - default_params: {...}      # 预设参数
   - keywords: [...]            # 强制触发词

✅ 简化设计：
   - prompt_content: "学术阅读的方法论..."  # 只有知识
   # 工具让模型自己选，参数让模型自己填
```

### 3. 渐进式披露

```
Layer 1: 元数据（始终）     ~50 tokens  - name, description
Layer 2: 知识内容（按需）   ~500-2000 tokens - prompt_content
Layer 3: 资源文件（按需）   无限制 - references/
```

### 4. 上下文隔离

```
主 Agent 历史 = [用户问题, 最终回答]  # 干净
子 Agent 历史 = [用户问题, 工具调用, 工具结果, ..., 最终回答]  # 隔离
```

---

## Task 1: 简化 Skill 模型

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/skills/models.py`

**Step 1: 简化 Skill 模型，移除限制性字段**

```python
# src/deeppdf/skills/models.py
"""
Skills 数据模型 - 简化版

Skill 是知识包，不是配置脚本。
- 知识告诉模型"怎么做"
- 工具让模型自己选择
- 参数让模型自己填写
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class Skill(BaseModel):
    """
    Skill 定义 - 纯知识，不限制

    参考 learn-claude-code 的设计哲学：
    "Skills are knowledge, not scripts. Trust the model to figure out how to use them."
    """

    # === 核心字段 ===
    name: str = Field(..., description="Skill 唯一标识符")
    description: str = Field(..., description="简短描述，用于路由决策")

    # === 知识内容 ===
    prompt_content: Optional[str] = Field(
        default=None,
        description="Skill 的知识内容（方法论、最佳实践等）"
    )

    # === 路由辅助（可选，不强制） ===
    keywords: Optional[List[str]] = Field(
        default=None,
        description="建议的触发关键词（仅供参考，不强制匹配）"
    )
    book_types: Optional[List[str]] = Field(
        default=None,
        description="建议的书籍类型（仅供参考）"
    )

    # === 资源文件（按需加载） ===
    resource_dir: Optional[str] = Field(
        default=None,
        description="资源文件目录路径"
    )

    # === 元数据 ===
    source_path: Optional[str] = Field(default=None)
    is_builtin: bool = Field(default=False)

    # 注意：移除了 tools 和 default_params
    # 原因：让模型自己决定用什么工具、填什么参数


class RoutingResult(BaseModel):
    """路由结果"""
    skill: Skill
    match_type: str  # keyword, llm_intent, default
    confidence: float = 1.0
    reason: Optional[str] = None
```

**Step 2: 运行代码检查**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run ruff check src/deeppdf/skills/models.py`

**Step 3: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/skills/models.py
git commit -m "refactor(skills): simplify Skill model - knowledge not configuration"
```

---

## Task 2: 创建 SubAgentExecutor（极简版）

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/agent/sub_agent.py`

**Step 1: 编写极简的 SubAgentExecutor**

```python
# src/deeppdf/agent/sub_agent.py
"""
子 Agent 执行器 - 极简版

核心：同样的循环 + 全新的历史 + Skill 知识注入

参考：/Users/lizhao/workspace/mygithub/learn-claude-code/v3_subagent.py

设计哲学：
1. 信任模型 - 不限制工具，让模型自己选择
2. 隔离上下文 - 全新的消息历史
3. 知识注入 - Skill 内容作为 system prompt 的一部分
4. 返回摘要 - 只有最终回答注入主历史
"""

import json
import logging
from typing import Any, Dict, List, Optional

from openai import OpenAI

from ..skills import Skill
from ..config import settings

logger = logging.getLogger(__name__)


class SubAgentResult:
    """子 Agent 执行结果（简单数据类）"""

    def __init__(
        self,
        summary: str,
        tool_calls: int = 0,
        iterations: int = 0,
    ):
        self.summary = summary
        self.tool_calls = tool_calls
        self.iterations = iterations


class SubAgentExecutor:
    """
    子 Agent 执行器

    与主 Agent 唯一的区别：全新的消息历史。
    其他都一样：同样的工具、同样的循环、同样的模型。

    这就是上下文隔离的全部秘密。
    """

    def __init__(
        self,
        skill: Skill,
        tools: Dict[str, Any],  # 工具字典，从主 Agent 传入
        llm_client: OpenAI,
        llm_model: str,
        temperature: float = None,
        max_iterations: int = None,
    ):
        self.skill = skill
        self.tools = tools  # 不过滤！让模型自己选择
        self.llm_client = llm_client
        self.llm_model = llm_model
        self.temperature = temperature or settings.agent_temperature
        self.max_iterations = max_iterations or settings.agent_max_iterations

        # 构建子 Agent 的 system prompt
        self.system_prompt = self._build_system_prompt()

        logger.info(f"[SubAgent] 初始化，Skill: {skill.name}")

    def _build_system_prompt(self) -> str:
        """
        构建子 Agent 的 System Prompt

        关键：Skill 内容作为知识注入，不是配置
        """
        skill_knowledge = self.skill.prompt_content or f"你正在使用「{self.skill.description}」模式。"

        # 工具描述
        tool_descriptions = []
        for name, tool in self.tools.items():
            tool_descriptions.append(f"- {name}: {tool.description}")

        return f"""你是 DeepReader 的阅读助手。

## 当前模式

{skill_knowledge}

## 可用工具

{chr(10).join(tool_descriptions)}

## 核心规则

1. 基于文档内容回答，不臆测
2. 引用具体页码
3. 先用工具获取信息，再回答
4. 完成后返回清晰完整的回答
"""

    def _get_tool_schemas(self) -> List[Dict[str, Any]]:
        """获取工具 schema（复用主 Agent 的逻辑）"""
        schemas = []
        for name, tool in self.tools.items():
            # 简化版 schema
            schema = {
                "type": "function",
                "function": {
                    "name": name,
                    "description": tool.description,
                    "parameters": {"type": "object", "properties": {}},
                },
            }

            # 为特定工具添加参数
            if name == "read_page":
                schema["function"]["parameters"] = {
                    "type": "object",
                    "properties": {
                        "page_num": {"type": "integer", "description": "页码（从1开始）"},
                    },
                    "required": ["page_num"],
                }
            elif name == "hybrid_search":
                schema["function"]["parameters"] = {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "搜索内容"},
                    },
                    "required": ["query"],
                }

            schemas.append(schema)
        return schemas

    def run(self, query: str) -> SubAgentResult:
        """
        执行子 Agent

        核心：全新的消息历史，其他都一样
        """
        logger.info(f"[SubAgent] 执行，Skill: {self.skill.name}")
        logger.info(f"[SubAgent] 查询: {query[:50]}...")

        # === 关键：全新的消息历史 ===
        sub_history: List[Dict[str, Any]] = []
        sub_history.append({"role": "user", "content": query})

        iterations = 0
        tool_calls_count = 0

        while iterations < self.max_iterations:
            iterations += 1

            # 构建消息
            messages = [{"role": "system", "content": self.system_prompt}] + sub_history

            # 调用 LLM
            try:
                response = self.llm_client.chat.completions.create(
                    model=self.llm_model,
                    messages=messages,
                    tools=self._get_tool_schemas(),
                    temperature=self.temperature,
                )
            except Exception as e:
                logger.error(f"[SubAgent] LLM 错误: {e}")
                return SubAgentResult(f"处理请求时发生错误：{str(e)}", tool_calls_count, iterations)

            message = response.choices[0].message
            tool_calls = message.tool_calls or []

            # 没有工具调用 = 返回最终回答
            if not tool_calls:
                logger.info(f"[SubAgent] 完成，{iterations} 轮，{tool_calls_count} 次工具调用")
                return SubAgentResult(
                    summary=message.content or "",
                    tool_calls=tool_calls_count,
                    iterations=iterations,
                )

            # 记录 assistant 消息
            sub_history.append({
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [{"id": tc.id, "type": tc.type, "function": {"name": tc.function.name, "arguments": tc.function.arguments}} for tc in tool_calls],
            })

            # 执行工具调用
            for tool_call in tool_calls:
                tool_calls_count += 1
                tool_name = tool_call.function.name

                try:
                    args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                logger.info(f"[SubAgent] 工具: {tool_name}({args})")

                # 执行工具
                if tool_name in self.tools:
                    output = self.tools[tool_name](**args)
                else:
                    output = f"未知工具: {tool_name}"

                sub_history.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": output,
                })

        # 达到最大迭代
        logger.warning(f"[SubAgent] 达到最大迭代 {self.max_iterations}")

        # 强制返回
        messages = [{"role": "system", "content": self.system_prompt}] + sub_history
        messages.append({"role": "user", "content": "请基于已有信息直接回答。"})

        try:
            response = self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=messages,
                temperature=self.temperature,
            )
            return SubAgentResult(
                summary=response.choices[0].message.content or "未能完成请求",
                tool_calls=tool_calls_count,
                iterations=iterations,
            )
        except Exception as e:
            return SubAgentResult(f"处理请求时发生错误：{str(e)}", tool_calls_count, iterations)
```

**Step 2: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/sub_agent.py
git commit -m "feat(agent): add minimal SubAgentExecutor - trust the model"
```

---

## Task 3: 修改 DeepPDFAgent 集成子 Agent

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/core.py`

**Step 1: 添加子 Agent 调用逻辑**

在 `DeepPDFAgent` 类中添加：

```python
# 在 __init__ 参数中添加
intent_router: Optional["IntentRouter"] = None,

# 在 __init__ 方法体内添加
self.intent_router = intent_router
self._current_skill: Optional[Skill] = skill
```

**Step 2: 添加 _run_sub_agent 方法**

```python
def _run_sub_agent(self, skill: Skill, query: str) -> Generator[str, None, None]:
    """
    运行子 Agent

    核心：
    1. 创建全新的消息历史（隔离）
    2. 传入所有工具（不限制）
    3. 返回摘要注入主历史
    """
    from .sub_agent import SubAgentExecutor

    yield f"\n\n切换到「{skill.description}」模式...\n\n"

    # 创建子 Agent（传入所有工具，不过滤！）
    executor = SubAgentExecutor(
        skill=skill,
        tools=self.executor.tools,  # 所有工具
        llm_client=self.client,
        llm_model=self.llm_model,
        temperature=self.temperature,
        max_iterations=self.max_iterations,
    )

    # 执行
    result = executor.run(query)

    # 更新状态
    self._current_skill = skill

    # 注入主历史（只有摘要，没有工具调用细节）
    self.session_history.append({"role": "user", "content": query})
    self.session_history.append({"role": "assistant", "content": result.summary})

    logger.info(f"[Agent] 子 Agent 完成: {skill.name}, 工具={result.tool_calls}, 轮次={result.iterations}")

    yield result.summary
```

**Step 3: 修改 run_stream 添加路由检测**

```python
def run_stream(self, query: str, ...) -> Generator[str, None, None]:
    """运行 Agent 主循环"""

    # === Skill 切换检测 ===
    if self.intent_router and not self._is_followup(query):
        routing = self.intent_router.route(query, self._current_skill)

        # 需要切换 Skill？
        if routing.skill.name != self._current_skill?.name:
            yield from self._run_sub_agent(routing.skill, query)
            return
    # === 检测结束 ===

    # ... 原有逻辑 ...

def _is_followup(self, query: str) -> bool:
    """判断是否是追问"""
    followups = {"继续", "然后呢", "还有呢", "展开说说"}
    return query.strip() in followups
```

**Step 4: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/agent/core.py
git commit -m "feat(agent): integrate SubAgentExecutor with skill switching"
```

---

## Task 4: 简化 IntentRouter

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/skills/intent_router.py`

**Step 1: 简化路由逻辑**

```python
# 移除复杂的评分、阈值、LLM 精选
# 信任模型，用最简单的关键词匹配

class IntentRouter:
    """意图路由器 - 简化版"""

    def __init__(self, registry: SkillRegistry):
        self.registry = registry

    def route(
        self,
        query: str,
        current_skill: Optional[Skill] = None,
    ) -> RoutingResult:
        """
        简单路由：关键词匹配 + 粘性策略

        不用 LLM 精选，信任关键词匹配即可
        """
        query_lower = query.lower()

        # 1. 粘性策略：如果当前 Skill 的关键词匹配，保持
        if current_skill and current_skill.keywords:
            for kw in current_skill.keywords:
                if kw.lower() in query_lower:
                    return RoutingResult(
                        skill=current_skill,
                        match_type="sticky",
                        confidence=0.8,
                    )

        # 2. 关键词匹配：找最佳匹配
        best_skill = None
        best_score = 0

        for skill in self.registry.list_all():
            if not skill.keywords:
                continue

            score = sum(1 for kw in skill.keywords if kw.lower() in query_lower)
            if score > best_score:
                best_score = score
                best_skill = skill

        if best_skill:
            return RoutingResult(
                skill=best_skill,
                match_type="keyword",
                confidence=min(best_score / 3, 1.0),  # 简单归一化
            )

        # 3. 默认
        return RoutingResult(
            skill=self.registry.get_default(),
            match_type="default",
            confidence=0.5,
        )
```

**Step 2: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/skills/intent_router.py
git commit -m "refactor(skills): simplify IntentRouter - trust keyword matching"
```

---

## Task 5: 更新 routes.py

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`

**Step 1: 传递 IntentRouter**

```python
agent = DeepPDFAgent(
    index_id=index_id,
    storage_dir=storage_dir,
    tree_structure=tree_structure,
    index_metadata=index_metadata,
    intent_router=intent_router,  # 新增
    skill=current_skill,
)
```

**Step 2: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat(api): pass IntentRouter to DeepPDFAgent"
```

---

## Task 6: 测试

**Files:**
- Create: `backend/deeppdf-api/tests/test_sub_agent.py`

**Step 1: 编写测试**

```python
# tests/test_sub_agent.py
"""SubAgentExecutor 测试"""

import pytest
from unittest.mock import Mock
from deeppdf.agent.sub_agent import SubAgentExecutor, SubAgentResult
from deeppdf.skills.models import Skill


class TestSubAgentExecutor:
    @pytest.fixture
    def skill(self):
        return Skill(
            name="test",
            description="测试",
            prompt_content="你是一个测试助手。",
        )

    @pytest.fixture
    def mock_tools(self):
        return {
            "test_tool": Mock(return_value="工具结果"),
        }

    @pytest.fixture
    def mock_client(self):
        client = Mock()
        # 默认返回无工具调用
        response = Mock()
        response.choices = [Mock()]
        response.choices[0].message.content = "测试回答"
        response.choices[0].message.tool_calls = None
        client.chat.completions.create.return_value = response
        return client

    def test_run_returns_summary(self, skill, mock_tools, mock_client):
        """测试返回摘要"""
        executor = SubAgentExecutor(
            skill=skill,
            tools=mock_tools,
            llm_client=mock_client,
            llm_model="test",
        )

        result = executor.run("测试问题")

        assert isinstance(result, SubAgentResult)
        assert result.summary == "测试回答"
        assert result.tool_calls == 0

    def test_isolated_history(self, skill, mock_tools, mock_client):
        """测试历史隔离"""
        executor = SubAgentExecutor(
            skill=skill,
            tools=mock_tools,
            llm_client=mock_client,
            llm_model="test",
        )

        # 两次调用
        executor.run("问题1")
        executor.run("问题2")

        # 验证第二次调用的消息历史只有 1 条用户消息
        call_args = mock_client.chat.completions.create.call_args
        messages = call_args[1]["messages"]

        # system + user = 2 条（没有累积）
        assert len(messages) == 2
        assert messages[1]["content"] == "问题2"

    def test_all_tools_available(self, skill, mock_client):
        """测试所有工具可用（不限制）"""
        tools = {
            "tool_a": Mock(return_value="A"),
            "tool_b": Mock(return_value="B"),
            "tool_c": Mock(return_value="C"),
        }

        executor = SubAgentExecutor(
            skill=skill,
            tools=tools,
            llm_client=mock_client,
            llm_model="test",
        )

        # 验证所有工具都可用
        assert len(executor.tools) == 3
        assert "tool_a" in executor.tools
        assert "tool_b" in executor.tools
        assert "tool_c" in executor.tools
```

**Step 2: 运行测试**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run pytest tests/test_sub_agent.py -v`

**Step 3: 提交**

```bash
git add backend/deeppdf-api/tests/test_sub_agent.py
git commit -m "test: add SubAgentExecutor tests"
```

---

## 验收标准

1. **上下文隔离**：子 Agent 的历史不污染主 Agent
2. **不限制工具**：所有工具对子 Agent 可用
3. **知识注入**：Skill 内容作为 system prompt 的一部分
4. **返回摘要**：只有最终回答注入主历史
5. **简洁**：核心代码 < 200 行

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/deeppdf/skills/models.py` | 修改 | 简化 Skill 模型，移除 tools/default_params |
| `src/deeppdf/agent/sub_agent.py` | 新增 | 极简的 SubAgentExecutor |
| `src/deeppdf/agent/core.py` | 修改 | 集成子 Agent 调用 |
| `src/deeppdf/skills/intent_router.py` | 修改 | 简化路由逻辑 |
| `src/deeppdf/api/routes.py` | 修改 | 传递 IntentRouter |
| `tests/test_sub_agent.py` | 新增 | 单元测试 |

---

## 与原设计对比

| 方面 | 原设计 | 简化设计 |
|------|--------|----------|
| **Skill 模型** | 10+ 字段（tools, default_params, resources...） | 4 字段（name, description, prompt_content, keywords） |
| **工具限制** | skill.tools 过滤 | 不限制，全部可用 |
| **渐进式披露** | 三层（元数据/内容/资源） | 两层（元数据/内容） |
| **IntentRouter** | 关键词+LLM精选+阈值 | 简单关键词匹配 |
| **SubAgentExecutor** | ~300 行 | ~150 行 |
| **代码总量** | ~800 行 | ~400 行 |

**核心差异**：
- 原设计：预设工作流、限制选择、复杂配置
- 简化设计：信任模型、提供能力、让模型推理
