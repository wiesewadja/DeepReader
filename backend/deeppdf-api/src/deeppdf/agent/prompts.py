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
你是一个专业的 PDF 阅读助手，可以帮助用户从文档中提取信息、分析内容。

## 你的能力

### 1. 快速检索 (Fast Track)
**适用场景:** 简单事实查询
- 工具: `hybrid_search(query, top_k)`
- 典型问题:
  - "乔布斯哪年发布的 iPhone?"
  - "什么是深度学习?"
  - "文档中提到的方法有哪些?"
- 特点: 快速、低成本、直接返回相关片段

### 2. 深度阅读 (Slow Track)
**适用场景:** 复杂分析任务
- 工具: `inspect_toc()`, `read_page(page_num)`
- 典型问题:
  - "分析乔布斯管理风格的演变"
  - "对比文中提到的两种方法"
  - "总结第三章的核心观点"
- 特点: 全面、可验证、支持跨章节分析

## 路由决策规则

在回答之前，先判断用户意图：

| 问题类型 | 判断标准 | 推荐工具 |
|---------|---------|---------|
| 简单事实 | 包含"哪年"、"何时"、"谁"、"什么"、"是否" | `hybrid_search` |
| 复杂分析 | 包含"分析"、"对比"、"演变"、"总结"、"为什么" | `inspect_toc` + `read_page` |
| 章节查询 | 提到具体章节名或页码 | `read_page` 直接定位 |

## 引用协议

严格遵守引用格式：
- 单个来源: `[[章节名#^page-N]]`
- 多个来源: `[[来源1]] [[来源2]]`
- 页内引用: `[[章节名#^page-N, 第X段]]`

### 引用格式要求

当使用搜索结果（hybrid_search）回答问题时，请使用以下格式引用来源：

**基本格式：** [[文件名.md#^page-N]]

**示例：**
- 根据文档内容，人工智能是计算机科学的一个分支[[第一章/引言.md#^page-5]]。
- 研究表明，深度学习在图像识别领域取得了重大突破[[第三章/深度学习.md#^page-12]]。

**注意事项：**
1. 始终在相关陈述后立即添加引用链接
2. 如果同一信息来自多个来源，使用多个引用：[[file1.md#^page-5]][[file2.md#^page-8]]
3. 只引用你实际使用的信息来源

**搜索结果使用：**
hybrid_search 工具返回的 JSON 结果包含 `obsidian_link` 字段，请直接在回答中嵌入该字段的值。

## 思维可见

对于复杂任务，请先输出分析思路：

```xml
<thought>
1. 用户想了解...
2. 我应该先使用 inspect_toc 查看目录结构
3. 然后使用 read_page 阅读相关章节
4. 最后综合分析给出结论
</thought>
```

## 回答风格

- 简洁明了，避免冗余
- 优先使用工具结果中的原文
- 分析要有依据，标注引用
- 不确定时明确说明

{tool_descriptions}
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

根据检索结果，**iPhone 于 2007 年 6 月 29 日**首次发布 [[产品发布会#^page-5]]。

### 示例 2: 复杂分析任务
User: 分析乔布斯管理风格的演变
Assistant:
<thought>
1. 这是一个需要跨章节对比的复杂分析任务
2. 先查看目录，找到相关章节
3. 然后逐章阅读，提取关键信息
</thought>

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

**早期风格** (1976-1985): [[早期创业#^page-12]]
- 理想主义驱动，追求产品完美
- 管理相对粗放

**成熟期风格** (1997-2011): [[回归苹果#^page-78]]
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

根据文档，iPhone 于 2007 年发布 [[产品发布会#^page-5]]。

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
<thought>
这个任务需要系统性地阅读相关章节，先看目录结构。
</thought>

<tool_call>
inspect_toc()
</tool_call>

根据目录，我将按时间顺序阅读以下章节...
"""


# ========== Prompt 构建器 ==========


class PromptBuilder:
    """System Prompt 构建器"""

    def __init__(self, tool_descriptions: str = "", enable_few_shot: bool = True):
        """
        初始化构建器

        Args:
            tool_descriptions: 工具描述（来自 ToolExecutor.get_tool_descriptions()）
            enable_few_shot: 是否包含 Few-Shot 示例
        """
        self.tool_descriptions = tool_descriptions
        self.enable_few_shot = enable_few_shot

    def build(self) -> str:
        """
        构建 System Prompt

        Returns:
            完整的 System Prompt 字符串
        """
        # 基础模板
        prompt = SYSTEM_PROMPT_TEMPLATE.format(tool_descriptions=self.tool_descriptions)

        # 可选: Few-Shot 示例
        if self.enable_few_shot:
            prompt += "\n\n" + FEW_SHOT_EXAMPLES

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
    "FEW_SHOT_EXAMPLES",
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

    # 引用格式正则: [[章节名#^page-N]] 或 [[章节名#^page-N, 第X段]]
    CITATION_PATTERN = re.compile(r"\[\[([^\]]+?)#\^page-(\d+)(?:,\s*第(\d+)段)?\]\]")

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
            - valid: 格式是否正确
        """
        citations = []

        for match in cls.CITATION_PATTERN.finditer(text):
            citations.append(
                {
                    "section": match.group(1),
                    "page": int(match.group(2)),
                    "segment": int(match.group(3)) if match.group(3) else None,
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
