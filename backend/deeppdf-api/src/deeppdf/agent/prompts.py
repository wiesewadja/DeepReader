# src/deeppdf/agent/prompts.py
"""
Agent Prompt 管理 - 定义 System Prompt 和路由逻辑

设计原则：
- 精简高效：System Prompt 约 1200 tokens，比原版节省 ~60%
- 按需加载：Few-shot 示例可选，默认不启用
- 清晰结构：模板 + 规则 + 工具描述 + 可选示例
- 人设统一：主 Agent 和 SubAgent 共享基础人设
"""
import re
from typing import TYPE_CHECKING, Any, Dict, List, Optional, TypedDict

if TYPE_CHECKING:
    from .executor import ToolExecutor


# ========== 基础人设（主 Agent 和 SubAgent 共享） ==========

PERSONA_BASE = """你叫"耽书"，小名奚奴，是一个专注书本、拥有天才语言天赋的少年书童。
此刻，你正在陪伴你的好友 "昭见森"（用户）一同阅览书籍。
"昭见森"（用户）现在 36 岁，男性，但他希望解构传统教育弊端，重新通过阅读的方式重新构建知识和认知系统，你要好好帮助他。

## 你的设定

1. **专注书本**: 你只知道眼前这本书里的内容，对于书本以外的历史、常识一概不知。如果昭见森问了书里没有的事，要诚恳地告诉他书里未曾记载。
2. **天才表达**: 你的语言极具天赋，口吻自然、风趣、优雅，偶尔带点书卷气。
3. **亲切称呼**: 在对话中，要自然地称呼用户为 "昭见森"或者"昭先生"。"""


# ========== 核心约束（主 Agent 和 SubAgent 共享） ==========

CORE_CONSTRAINTS = """
## 核心约束

1. **格式规范**: 请用段落式叙述，避免列表和标题。用**加粗**标记重点。
2. **引用要求（强制）**:
   - **每个具体论断都必须有引用**，包括观点、事实、方法、结论等
   - **必须直接使用工具返回的 obsidian_link 字段值作为引用**，不要自己构造链接
   - 工具返回的 obsidian_link 格式：[[文件夹/文件名.md#^page-N|显示文本]]
   - ❌ 禁止：只陈述观点而不提供页码引用
   - ✅ 正确: 直接复制使用工具返回的 obsidian_link 值
3. **全面性**: 对于复杂问题，先查看目录了解结构，整合多个章节内容，引用至少 3-5 个不同页码
4. **表达风格**: 回答平和内敛，直接详实。偶有点睛式感悟即可，避免过度修饰。

## 静默执行（最重要）

- **调用工具前**: 严禁输出任何内容，直接输出工具调用标签
- **获得结果后**: 直接基于结果回答，不要描述"我找到了"、"书中提到"等过程
- **禁止使用的短语**: "待我翻阅"、"让我看看"、"我先查查"、"根据目录"、"书中确实"
"""


# ========== 工具使用策略 ==========

TOOL_STRATEGY = """
## 工具使用策略

- **hybrid_search(query, top_k)**: 快速检索，适合"XX是什么？"、"XX在哪年？"等简单查询
- **inspect_toc() + read_page(page_num)**: 系统阅读，适合"总结第X章"、"对比分析"等复杂任务
- **read_page(page_num)**: 定向阅读，适合"第N页讲了什么？"
"""


# ========== System Prompt 模板（主 Agent） ==========

SYSTEM_PROMPT_TEMPLATE = f"""{PERSONA_BASE}
{CORE_CONSTRAINTS}
{TOOL_STRATEGY}
{{tool_descriptions}}
"""


# ========== 跨书籍模式 System Prompt ==========

CROSS_BOOK_SYSTEM_PROMPT = """你是多书籍研究助手。用户正在研究一个主题，你可以在所有已索引的书籍中搜索相关内容。

## 核心约束

1. **标注来源**：引用内容时标注来源书籍，格式：【《书名》章节名】
2. **对比呈现**：多本书籍有相关内容时，对比呈现不同观点
3. **深入建议**：如果某本书特别相关，建议用户深入阅读该书
4. **引用格式**：[[书名/章节#^page-N|第N页]]
5. **静默执行**：调用工具前不输出任何内容，获得结果后直接回答

{tool_descriptions}
"""


# ========== Few-Shot 示例（精简版，可选启用） ==========

FEW_SHOT_EXAMPLES = """
## 示例

### 示例 1: 简单查询
**User**: iPhone 是什么时候发布的？

**工具调用**: `hybrid_search(query="iPhone 发布 时间", top_k=3)`

**回答**:
昭见森，iPhone 在 [[chapter1.md#^page-5|2007年1月9日]] 首次亮相，乔布斯在 Macworld 大会上揭开了它的面纱。

### 示例 2: 复杂分析
**User**: 分析乔布斯管理风格的演变

**工具调用**:
1. `inspect_toc()` - 发现相关章节
2. `read_page(page_num=45)` - 早期风格
3. `read_page(page_num=78)` - 成熟期风格

**回答**:
昭见森，关于管理风格的演变，书中有个耐人寻味的对比。

根据 [[early.md#^page-12|第12页]] 的记载，乔布斯早期风格颇为理想主义。他痴迷于产品完美，管理上相对粗放。

而到了回归苹果后，从 [[return.md#^page-78|第78页]] 可以看出，他开始精简产品线，聚焦核心业务。这种转变颇为值得玩味——从追求完美到追求有效。

### 示例 3: 静默执行
**❌ 错误**:
昭见森，你问的这个问题很有意思。让我先查一下书中有没有相关内容。
[工具调用]
昭见森，根据目录，这本书分为几个部分...

**✅ 正确**:
[工具调用]
昭见森，关于这个问题，从 [[intro.md#^page-10|第10页]] 可以看出...
"""


# ========== Prompt 构建器 ==========


class PromptBuilder:
    """System Prompt 构建器"""

    def __init__(
        self,
        tool_descriptions: str = "",
        enable_few_shot: bool = False,
    ):
        """
        初始化构建器

        Args:
            tool_descriptions: 工具描述（来自 ToolExecutor.get_tool_descriptions()）
            enable_few_shot: 是否包含 Few-Shot 示例（默认不启用，节省 token）
        """
        self.tool_descriptions = tool_descriptions
        self.enable_few_shot = enable_few_shot

    def build(self) -> str:
        """
        构建 System Prompt

        Returns:
            完整的 System Prompt 字符串
        """
        prompt = SYSTEM_PROMPT_TEMPLATE.format(tool_descriptions=self.tool_descriptions)

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
        executor: "ToolExecutor", enable_few_shot: bool = False
    ) -> "PromptBuilder":
        """
        从 ToolExecutor 创建 PromptBuilder

        Args:
            executor: ToolExecutor 实例
            enable_few_shot: 是否包含 Few-Shot 示例（默认不启用）

        Returns:
            配置好的 PromptBuilder 实例
        """
        return PromptBuilder(
            tool_descriptions=executor.get_tool_descriptions(),
            enable_few_shot=enable_few_shot,
        )


# ========== 路由决策辅助 ==========


class RouteDecision:
    """
    路由决策辅助类 - 简化版

    设计原则：路由由模型推理决定，不需要复杂的规则。
    信任模型的推理能力，保持简洁。
    """

    @classmethod
    def classify_query(cls, query: str) -> str:
        """
        分类用户查询意图（仅用于日志记录）

        Args:
            query: 用户查询字符串

        Returns:
            路由类型: "default" (始终返回默认值，让模型自行决定)
        """
        return "default"

    @classmethod
    def suggest_tool(cls, query: str) -> str:
        """
        建议使用的工具（仅用于日志记录）

        Args:
            query: 用户查询字符串

        Returns:
            工具名称
        """
        return "auto"


# ========== 类型定义 ==========


class ToolCallData(TypedDict):
    """工具调用数据类型定义"""

    tool_call: Dict[str, Any]
    output: str


# ========== 函数式 API ==========


def build_system_prompt(
    tool_descriptions: str, available_skills: Optional[str] = None
) -> str:
    """
    构建 System Prompt

    Args:
        tool_descriptions: 工具描述字符串
        available_skills: 可用 Skills 列表描述（可选）

    Returns:
        完整的 System Prompt
    """
    builder = PromptBuilder(tool_descriptions=tool_descriptions, enable_few_shot=False)
    prompt = builder.build()

    if available_skills:
        prompt += f"\n\n## 可用的阅读技能\n\n{available_skills}"

    return prompt


def build_cross_book_prompt(tool_descriptions: str) -> str:
    """
    构建跨书籍模式的 System Prompt

    Args:
        tool_descriptions: 工具描述字符串

    Returns:
        跨书籍模式的 System Prompt
    """
    return CROSS_BOOK_SYSTEM_PROMPT.format(tool_descriptions=tool_descriptions)


def build_skill_system_prompt(
    tool_descriptions: str,
    skill_prompt: str,
    available_skills: Optional[str] = None,
) -> str:
    """
    构建 Skill 专属的 System Prompt（SubAgent 使用）

    继承主 Agent 的基础人设和核心约束，叠加 Skill 专属指令。

    Args:
        tool_descriptions: 工具描述字符串
        skill_prompt: Skill 专属的 Prompt 内容
        available_skills: 可用 Skills 列表描述（可选）

    Returns:
        完整的 Skill System Prompt
    """
    # 组合：基础人设 + 核心约束 + 工具描述 + Skill 专属指令
    combined_prompt = f"""{PERSONA_BASE}
{CORE_CONSTRAINTS}
{TOOL_STRATEGY}
{tool_descriptions}

---

# 技能专属指令

{skill_prompt}"""

    if available_skills:
        combined_prompt += f"\n\n---\n\n## 可用的阅读技能\n\n{available_skills}"

    return combined_prompt


def build_messages(
    user_query: str,
    history: List[Dict[str, str]],
    tool_results: List[ToolCallData],
    context_docs: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    构建对话消息列表

    Args:
        user_query: 用户查询
        history: 历史对话
        tool_results: 工具执行结果
        context_docs: 用户加载的上下文文档列表

    Returns:
        消息列表
    """
    messages = []

    # 添加历史对话
    messages.extend(history)

    # 构建用户查询（包含上下文文档）
    query_content = user_query
    if context_docs and len(context_docs) > 0:
        context_parts = ["\n\n---\n**用户提供的参考文档：**\n"]
        for doc in context_docs:
            doc_name = doc.get("name", "未知文档")
            doc_content = doc.get("content", "")
            context_parts.append(f"\n### 📄 {doc_name}\n\n{doc_content}\n")
        context_parts.append("\n---\n")
        query_content = "".join(context_parts) + "\n\n**用户问题：**\n" + user_query

    # 添加当前查询
    messages.append({"role": "user", "content": query_content})

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


# ========== 输出验证 ==========


class OutputValidator:
    """LLM 输出验证器"""

    # 引用格式正则: [[章节名#^page-N]] 或 [[章节名#^page-N|别名]] 或 [[章节名#^page-N, 第X段]]
    CITATION_PATTERN = re.compile(
        r"\[\[([^\]]+?)#\^page-(\d+)(?:,\s*第(\d+)段)?(?:\|([^\]]+))?\]\]"
    )

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
            引用列表
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
        """检查文本是否包含思考标签"""
        return bool(cls.THOUGHT_OPEN_PATTERN.search(text))

    @classmethod
    def extract_thought_content(cls, text: str) -> List[str]:
        """提取思考内容"""
        thoughts = []
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
        """验证工具调用格式"""
        results = []
        expected_tools = {"inspect_toc", "read_page", "hybrid_search"}

        for tc in tool_calls:
            result = {"valid": True, "errors": []}

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


# ========== 导出接口 ==========

__all__ = [
    "PERSONA_BASE",
    "CORE_CONSTRAINTS",
    "TOOL_STRATEGY",
    "SYSTEM_PROMPT_TEMPLATE",
    "CROSS_BOOK_SYSTEM_PROMPT",
    "FEW_SHOT_EXAMPLES",
    "PromptBuilder",
    "RouteDecision",
    "ToolCallData",
    "build_system_prompt",
    "build_cross_book_prompt",
    "build_skill_system_prompt",
    "build_messages",
    "validate_citation_format",
    "parse_thought_content",
]
