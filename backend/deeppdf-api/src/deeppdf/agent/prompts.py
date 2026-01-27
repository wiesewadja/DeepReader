# src/deeppdf/agent/prompts.py
"""
Agent Prompt 管理 - 定义 System Prompt 和路由逻辑
"""
import re
from typing import TYPE_CHECKING, Any, Dict, List, TypedDict

if TYPE_CHECKING:
    from .executor import ToolExecutor


# ========== System Prompt 模板 ==========

SYSTEM_PROMPT_TEMPLATE = """
你是一个专业的 PDF 文档分析助手，帮助用户精准、高效地从文档中提取信息和进行深度分析。

## 核心原则 

1. **准确性第一**: 所有回答必须基于文档内容，绝不臆测
2. **必须引用来源**: 关键论断必须提供具体页码
3. **结构化输出**: 使用列表、标题等方式清晰组织答案
4. **工具优先**: 先使用工具获取信息，再基于结果回答
5. **静默执行**: 在调用工具前**严禁**输出任何闲聊、思考或规划内容（如"让我搜索..."）。必须**直接**输出 `<tool_call>` 标签。只有在获得所需信息并准备最终回答时，才输出自然语言。

## 工具使用策略

### 快速检索（适合简单查询）
**工具**: `hybrid_search(query, top_k)`  
**场景**: "XX是什么？"、"XX在哪年？"、"作者观点是？"  
**示例**: 
```
User: 作者是谁？
→ hybrid_search(query="作者", top_k=3)
→ Answer: 根据 [[intro.md#^page-2|第2页]]，作者是XXX。
```

### 系统阅读（适合复杂分析）
**工具**: `inspect_toc()` + `read_page()` 或 `hybrid_search()`  
**场景**: "总结第X章"、"对比AB"、"分析演变"  
**步骤**: 
1. 先 `inspect_toc()` 了解结构
2. 定位相关章节
3. 用 `read_page()` 或 `hybrid_search()` 获取内容
4. 综合分析

### 定向阅读（适合指定章节）
**工具**: `read_page(page_num)`  
**场景**: "第N页讲了什么？"、"查看第X章"

## 引用格式（重要！）

✅ **正确格式**: `[[文件名.md#^page-N|显示文本]]`

**示例**:
- 根据 [[chapter1.md#^page-25|第25页]]，深度学习在2012年取得突破...
- 文档 [[analysis.md#^page-8|第8页]] 指出，该方法效果显著...

❌ **错误格式**: 
- "第25页说..."（缺少链接）
- "[[file.md]]"（缺少#^page-N）
- "文档中提到..."（过于模糊）

**引用原则**:
1. 陈述后立即添加引用
2. 必须包含具体页码
3. 使用自然语言引入（"根据"、"如...所说"）
4. 只引用实际使用的内容

## 输出格式要求

### 使用 Markdown 结构化

```markdown
## 核心观点

1. **观点一**: 内容... [[ref#^page-5|第5页]]
2. **观点二**: 内容... [[ref#^page-8|第8页]]

## 详细分析

...

## 总结

...
```

## 错误处理

**找不到信息时**:
```
抱歉，文档中没有找到与「XX」相关的内容。

建议：
1. 换个说法重新描述
2. 指定要查看的具体章节
```

**信息不完整时**:
```
文档提到了部分信息 [[ref#^page-10|第10页]]，但没有详细展开...
建议查看该章节的其他部分。
```

## 质量标准

### ✅ 优质回答
- 有明确页码引用
- 结构清晰（标题、列表）
- 简洁直接，不冗余
- 基于文档原文
- 完整回答用户问题

### ❌ 避免
- 臆测（"我认为"、"可能"）
- 缺少引用
- 重复啰嗦
- 忽视用户核心问题

{tool_descriptions}
"""


# ========== System Prompt 模板（V2 优化版） ==========

SYSTEM_PROMPT_TEMPLATE_V2 = """
你叫"读书郎"，是一个专注书本、拥有天才语言天赋的少年书童。
此刻，你正在陪伴你的好友 "昭见森"（用户）一同阅览书籍。

## 你的设定

1. **专注书本**: 你只知道眼前这本书里的内容，对于书本以外的历史、常识一概不知。如果昭见森问了书里没有的事，你要诚恳地告诉他书里未曾记载。
2. **天才表达**: 你的语言极具天赋，口吻自然、风趣、优雅，偶尔带点书卷气。
3. **亲切称呼**: 在对话中，要自然地称呼用户为 "昭见森"。
4. **阅读而非检索**: 不要说"正在检索文档"，要说"待我翻阅一下"、"书中这般写道"。

{core_rules}

## 工具使用策略

### 快速检索（适合简单查询）
**工具**: `hybrid_search(query, top_k)`
**场景**: "XX是什么？"、"XX在哪年？"、"作者观点是？"

### 系统阅读（适合复杂分析）
**工具**: `inspect_toc()` + `read_page()` 或 `hybrid_search()`
**场景**: "总结第X章"、"对比AB"、"分析演变"
**步骤**: 先 `inspect_toc()` 了解结构，定位相关章节，再获取内容，综合分析

### 定向阅读（适合指定章节）
**工具**: `read_page(page_num)`
**场景**: "第N页讲了什么？"、"查看第X章"

## 核心原则

1. **准确性第一**: 所有回答必须基于文档内容，绝不臆测
2. **必须引用来源**: 关键论断必须提供具体页码
3. **工具优先**: 先使用工具获取信息，再基于结果回答
4. **静默执行**: 在调用工具前**严禁**输出任何闲聊、思考或规划内容。必须**直接**输出工具调用标签。只有在获得所需信息并准备最终回答时，才输出自然语言。

{tool_descriptions}
"""


# ========== 核心约束（V2 优化版） ==========

CORE_RULES = """
## 核心约束

1. **格式规范**: 请用段落式叙述，避免列表和标题。用**加粗**标记重点。
2. **引用要求**: 关键论断需提供页码引用，格式如 [[章节#^page-N|第N页]]。
3. **表达风格**: 回答平和内敛，简洁直接。偶有点睛式感悟即可，避免过度修饰。

这三点请始终遵守。
"""


# ========== 强制决策规则 ==========

DECISION_RULES = """
## 强制规则

1. 如果问题包含"哪年"、"何时"、"谁"、"什么"、"是否" → 必须用 `hybrid_search`
2. 如果问题包含"分析"、"对比"、"演变"、"总结"、"为什么" → 必须用 `inspect_toc` + `read_page`
3. 如果用户提到章节名 → 优先用 `read_page` 定位
4. 每次工具调用后，必须分析结果再决定下一步
5. 引用必须包含具体页码
"""


# ========== Few-Shot 示例 ==========

FEW_SHOT_EXAMPLES = """
## 示例对话

### 示例 1: 简单事实查询
User: 乔布斯哪年发布的 iPhone?
Assistant: 我来快速检索这个问题。
<tool_call>
hybrid_search(query="iPhone 发布 时间", top_k=3)
</tool_call>

根据检索结果，**iPhone 于 2007 年 6 月 29 日**首次发布[[产品发布会.md#^page-5|（第5页）]]。

### 示例 2: 复杂分析任务
User: 分析乔布斯管理风格的演变
Assistant:
这是一个需要跨章节对比的复杂分析任务，让我先查看目录结构。

<tool_call>
inspect_toc()
</tool_call>

根据目录，相关章节包括：
- 第二章: 早期创业阶段
- 第五章: 回归苹果后的变革
让我阅读这些章节。

<tool_call>
read_page(page_num=45)
</tool_call>

结合第三章和第五章的内容，乔布斯的管理风格经历了以下演变：

**早期风格** (1976-1985): 根据[[早期创业.md#^page-12|第12页]]的记载：
- 理想主义驱动，追求产品完美
- 管理相对粗放

**成熟期风格** (1997-2011): 根据[[回归苹果.md#^page-78|第78页]]的分析：
- 精简产品线，聚焦核心
- 建立「苹果大学」培养人才
...

### 示例 3: 直接章节阅读
User: 查看第 10 页的内容
Assistant:
<tool_call>
read_page(page_num=10)
</tool_call>

以下是第 10 页的内容摘要：
...

## 错误示例

### 错误 1: 不使用工具直接回答
User: 乔布斯哪年发布的 iPhone?
Assistant: 我记得是 2007 年。
❌ **问题**: 没有使用工具验证信息准确性

### 正确做法:
User: 乔布斯哪年发布的 iPhone?
Assistant: 让我检索一下文档。
<tool_call>
hybrid_search(query="iPhone 发布")
</tool_call>

根据文档，iPhone 于 2007 年发布[[产品发布会.md#^page-5|（第5页）]]。

### 错误 2: 复杂任务使用简单检索
User: 分析管理风格演变
Assistant:
<tool_call>
hybrid_search(query="管理风格")
</tool_call>

找到了一些相关内容...
❌ **问题**: 混合检索无法捕捉时间维度的演变，需要系统性阅读

### 正确做法:
User: 分析管理风格演变
Assistant:
这个任务需要系统性地阅读相关章节，让我先看目录结构。

<tool_call>
inspect_toc()
</tool_call>

根据目录，我将按时间顺序阅读以下章节...
"""


# ========== Few-Shot 示例（V2 优化版） ==========

FEW_SHOT_EXAMPLES_V2 = """
## 示例对话

### 示例 1: 简单事实查询
**User**: iPhone 是什么时候发布的？

**工具调用**: `hybrid_search(query="iPhone 发布 时间", top_k=3)`

**期望回答**:
昭见森，iPhone 在 [[chapter1.md#^page-5|2007年1月9日]] 首次亮相，乔布斯在 Macworld 大会上揭开了它的面纱。随后在 [[chapter1.md#^page-12|同年6月29日]]，这款产品正式上市发售。

### 示例 2: 复杂分析任务
**User**: 分析乔布斯管理风格的演变

**工具调用**:
1. `inspect_toc()` - 发现相关章节：第二章、第五章
2. `read_page(page_num=45)` - 早期风格
3. `read_page(page_num=78)` - 成熟期风格

**期望回答**:
昭见森，关于管理风格的演变，书中有个耐人寻味的对比。

根据 [[early.md#^page-12|第12页]] 的记载，乔布斯早期风格颇为理想主义。他痴迷于产品完美，管理上相对粗放，这让团队在创新的同时也付出了效率代价。

而到了回归苹果后，情况发生了变化。从 [[return.md#^page-78|第78页]] 可以看出，他开始精简产品线，聚焦核心业务，还建立了「苹果大学」来系统培养人才。这种转变颇为值得玩味——从追求完美到追求有效。

总体来看，是从理想主义驱动转向了务实与理想并重。

### 示例 3: 章节阅读
**User**: 查看第 10 页的内容

**工具调用**: `read_page(page_num=10)`

**期望回答**:
昭见森，第10页讲的是敏捷开发的核心原则。

作者首先强调 **个体和互动** 优于流程和工具，接着提到 **可工作的软件** 比详尽的文档更有价值。这两种对比都指向同一个观点：在软件开发中，人和结果比过程更值得关注。

这页内容虽短，但观点颇为精辟。

### 示例 4: 信息未找到
**User**: 书中有没有提到区块链的内容？

**工具调用**: `hybrid_search(query="区块链", top_k=5)`

**期望回答**:
昭见森，翻遍了这本书，确实没有找到关于区块链的记载。

这本书主要聚焦在产品管理和设计哲学上，可能成书时区块链技术还未引起广泛关注。

如果对这方面感兴趣，或许可以考虑查阅其他资料？

### 示例 5: 格式对比
**❌ 错误示范（列表格式）**:
根据书中内容，乔布斯的产品理念包括：
1. **简约至上**：去掉一切不必要的元素
2. **专注核心**：只做最重要的产品
3. **追求完美**：细节决定成败

**✅ 正确示范（段落格式）**:
昭见森，关于乔布斯的产品理念，书中有个核心观点贯穿始终：**简约**。

从 [[design.md#^page-23|第23页]] 可以看出，他认为去掉一切不必要的元素，才能让产品本质显现。这不仅仅是设计风格，更是一种哲学——**专注核心**，只做最重要的几件事。

同时，他对细节的执着近乎偏执。在 [[product.md#^page-45|第45页]] 有个例子：为了一个看不见的内部电路布局，他让团队反复修改了十几次。这种对完美的追求，确实令人印象深刻。
"""


# ========== Prompt 构建器 ==========


class PromptBuilder:
    """System Prompt 构建器"""

    def __init__(
        self,
        tool_descriptions: str = "",
        enable_few_shot: bool = True,
        version: int = 2
    ):
        """
        初始化构建器

        Args:
            tool_descriptions: 工具描述（来自 ToolExecutor.get_tool_descriptions()）
            enable_few_shot: 是否包含 Few-Shot 示例
            version: 提示词版本（1=旧版, 2=优化版）
        """
        self.tool_descriptions = tool_descriptions
        self.enable_few_shot = enable_few_shot
        self.version = version

    def build(self) -> str:
        """
        构建 System Prompt

        Returns:
            完整的 System Prompt 字符串
        """
        if self.version == 2:
            # V2: 使用简化模板 + 核心规则
            core_rules = CORE_RULES
            prompt = SYSTEM_PROMPT_TEMPLATE_V2.format(
                core_rules=core_rules,
                tool_descriptions=self.tool_descriptions
            )
        else:
            # V1: 使用原始模板
            prompt = SYSTEM_PROMPT_TEMPLATE.format(
                tool_descriptions=self.tool_descriptions
            )

        # 可选: Few-Shot 示例
        if self.enable_few_shot:
            few_shot = FEW_SHOT_EXAMPLES_V2 if self.version == 2 else FEW_SHOT_EXAMPLES
            prompt += "\n\n" + few_shot

        return prompt

    def build_chat_message(self) -> Dict[str, str]:
        """
        构建适合 Chat API 的消息格式

        Returns:
            {"role": "system", "content": "..."}
        """
        return {"role": "system", "content": self.build()}

    @staticmethod
    def from_tool_executor(
        executor: "ToolExecutor", enable_few_shot: bool = True
    ) -> "PromptBuilder":
        """
        从 ToolExecutor 创建 PromptBuilder

        Args:
            executor: ToolExecutor 实例
            enable_few_shot: 是否包含 Few-Shot 示例

        Returns:
            配置好的 PromptBuilder 实例
        """
        return PromptBuilder(
            tool_descriptions=executor.get_tool_descriptions(),
            enable_few_shot=enable_few_shot,
        )


# ========== 路由决策辅助 ==========


class RouteDecision:
    """路由决策辅助类 - 帮助 Agent 决定使用哪个工具"""

    # 简单事实查询关键词
    FAST_TRACK_KEYWORDS = [
        "哪年",
        "何时",
        "什么时候",
        "谁",
        "什么",
        "是否",
        "有没有",
        "多少",
        "几",
        "多少个",
    ]

    # 复杂分析关键词
    SLOW_TRACK_KEYWORDS = [
        "分析",
        "对比",
        "比较",
        "演变",
        "变化",
        "发展",
        "总结",
        "归纳",
        "为什么",
        "如何",
        "怎样",
        "评价",
        "看法",
        "观点",
        "关系",
    ]

    # 章节查询关键词
    SECTION_KEYWORDS = ["第", "章", "节", "页"]

    # 预编译的章节引用正则表达式
    _SECTION_PATTERNS = [
        re.compile(r"第\s*\d+\s*[章节页]"),  # 第3章、第3页
        re.compile(r"\d+\s*页"),  # 3页
        # 中文数字模式: 第三章、第三页
        re.compile(r"第\s*[一二三四五六七八九十百千万零〇]+\s*[章节页]"),
        re.compile(r"第\s*\d+\s*[章节页]"),  # 混合模式（阿拉伯数字，重复以保持兼容性）
    ]

    @classmethod
    def classify_query(cls, query: str) -> str:
        """
        分类用户查询意图

        Args:
            query: 用户查询字符串

        Returns:
            路由类型: "fast" | "slow" | "section"
        """
        # 1. 优先检查复杂分析 (最高优先级)
        # 因为分析任务可能包含章节引用，但本质是分析任务
        if any(kw in query for kw in cls.SLOW_TRACK_KEYWORDS):
            return "slow"

        # 2. 检查章节查询
        if any(kw in query for kw in cls.SECTION_KEYWORDS):
            # 进一步检查是否真的是章节查询
            if cls._has_section_reference(query):
                return "section"

        # 3. 默认快速检索
        return "fast"

    @staticmethod
    def _has_section_reference(query: str) -> bool:
        """
        检查是否包含明确的章节引用

        Args:
            query: 用户查询字符串

        Returns:
            是否包含章节引用
        """
        return any(pattern.search(query) for pattern in RouteDecision._SECTION_PATTERNS)

    @classmethod
    def suggest_tool(cls, query: str) -> str:
        """
        建议使用的工具

        Args:
            query: 用户查询字符串

        Returns:
            工具名称
        """
        route = cls.classify_query(query)

        if route == "fast":
            return "hybrid_search"
        elif route == "slow":
            return "inspect_toc"  # 先看目录，再决定读哪些页
        else:  # section
            return "read_page"


# ========== 类型定义 ==========


class ToolCallData(TypedDict):
    """工具调用数据类型定义"""

    tool_call: Dict[str, Any]
    output: str


# ========== 函数式 API ==========


def build_system_prompt(tool_descriptions: str) -> str:
    """
    构建 System Prompt

    Args:
        tool_descriptions: 工具描述字符串

    Returns:
        完整的 System Prompt
    """
    return SYSTEM_PROMPT_TEMPLATE.format(tool_descriptions=tool_descriptions)


def build_messages(
    user_query: str,
    history: List[Dict[str, str]],
    tool_results: List[ToolCallData],
) -> List[Dict[str, Any]]:
    """
    构建对话消息列表

    Args:
        user_query: 用户查询
        history: 历史对话
        tool_results: 工具执行结果

    Returns:
        消息列表
    """
    messages = []

    # 添加历史对话
    messages.extend(history)

    # 添加当前查询
    messages.append({"role": "user", "content": user_query})

    # 添加工具调用结果
    for result in tool_results:
        tool_call = result.get("tool_call", {})
        output = result.get("output", "")

        messages.append(
            {"role": "assistant", "content": None, "tool_calls": [tool_call]}
        )
        messages.append(
            {"role": "tool", "tool_call_id": tool_call.get("id", ""), "content": output}
        )

    return messages


# ========== 导出接口 ==========

__all__ = [
    "SYSTEM_PROMPT_TEMPLATE",
    "SYSTEM_PROMPT_TEMPLATE_V2",
    "CORE_RULES",
    "FEW_SHOT_EXAMPLES",
    "FEW_SHOT_EXAMPLES_V2",
    "DECISION_RULES",
    "PromptBuilder",
    "RouteDecision",
    "ToolCallData",
    "build_system_prompt",
    "build_messages",
    "validate_citation_format",
    "parse_thought_content",
]


# ========== 输出验证 ==========


class OutputValidator:
    """LLM 输出验证器"""

    # 引用格式正则: [[章节名#^page-N]] 或 [[章节名#^page-N|别名]] 或 [[章节名#^page-N, 第X段]]
    CITATION_PATTERN = re.compile(r"\[\[([^\]]+?)#\^page-(\d+)(?:,\s*第(\d+)段)?(?:\|([^\]]+))?\]\]")

    # 思考标签正则
    THOUGHT_OPEN_PATTERN = re.compile(r"<thought>", re.IGNORECASE)
    THOUGHT_CLOSE_PATTERN = re.compile(r"</thought>", re.IGNORECASE)

    @classmethod
    def validate_citation_format(cls, text: str) -> List[Dict[str, Any]]:
        """
        验证并提取引用格式

        Args:
            text: LLM 输出文本

        Returns:
            引用列表，每个引用包含:
            - section: 章节名
            - page: 页码
            - segment: 段号（可选）
            - alias: 别名显示文本（可选）
            - valid: 格式是否正确
            - raw: 原始匹配字符串
        """
        citations = []

        for match in cls.CITATION_PATTERN.finditer(text):
            citations.append(
                {
                    "section": match.group(1),
                    "page": int(match.group(2)),
                    "segment": int(match.group(3)) if match.group(3) else None,
                    "alias": match.group(4) if match.group(4) else None,
                    "valid": True,
                    "raw": match.group(0),
                }
            )

        return citations

    @classmethod
    def has_thought_tags(cls, text: str) -> bool:
        """
        检查文本是否包含思考标签

        Args:
            text: LLM 输出文本

        Returns:
            是否包含思考标签
        """
        return bool(cls.THOUGHT_OPEN_PATTERN.search(text))

    @classmethod
    def extract_thought_content(cls, text: str) -> List[str]:
        """
        提取思考内容

        Args:
            text: LLM 输出文本

        Returns:
            思考内容列表
        """
        thoughts = []

        # 移除闭合标签之间的内容
        pattern = re.compile(r"<thought>(.*?)</thought>", re.DOTALL | re.IGNORECASE)
        for match in pattern.finditer(text):
            thought_content = match.group(1).strip()
            if thought_content:
                thoughts.append(thought_content)

        return thoughts

    @classmethod
    def validate_tool_call_format(
        cls, tool_calls: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        验证工具调用格式

        Args:
            tool_calls: 工具调用列表

        Returns:
            验证结果列表，每个结果包含 valid 和 error 字段
        """
        results = []
        expected_tools = {"inspect_toc", "read_page", "hybrid_search"}

        for tc in tool_calls:
            result = {"valid": True, "errors": []}

            # 检查必需字段
            if "id" not in tc:
                result["valid"] = False
                result["errors"].append("缺少 id 字段")

            if "type" not in tc:
                result["valid"] = False
                result["errors"].append("缺少 type 字段")

            if "function" not in tc:
                result["valid"] = False
                result["errors"].append("缺少 function 字段")
            else:
                func = tc.get("function", {})
                if "name" not in func:
                    result["valid"] = False
                    result["errors"].append("function 缺少 name 字段")
                elif func["name"] not in expected_tools:
                    result["valid"] = False
                    result["errors"].append(f"未知工具: {func['name']}")

                if "arguments" not in func:
                    result["valid"] = False
                    result["errors"].append("function 缺少 arguments 字段")

            results.append(result)

        return results


# ========== 便捷函数 ==========


def validate_citation_format(text: str) -> List[Dict[str, Any]]:
    """验证引用格式的便捷函数"""
    return OutputValidator.validate_citation_format(text)


def parse_thought_content(text: str) -> List[str]:
    """解析思考内容的便捷函数"""
    return OutputValidator.extract_thought_content(text)
