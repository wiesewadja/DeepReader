# src/deeppdf/agent/__init__.py
"""
Agent 模块 - DeepPDF 智能阅读助手
"""
from .tools import Tool, InspectTocTool, ReadPageTool, HybridSearchTool
from .executor import ToolExecutor, create_tool_executor
from .prompts import (
    SYSTEM_PROMPT_TEMPLATE,
    FEW_SHOT_EXAMPLES,
    PromptBuilder,
    RouteDecision,
    ToolCallData,
    build_system_prompt,
    build_messages,
)
from .core import DeepPDFAgent
from .sub_agent import SubAgentExecutor

__all__ = [
    "Tool",
    "InspectTocTool",
    "ReadPageTool",
    "HybridSearchTool",
    "ToolExecutor",
    "create_tool_executor",
    "SubAgentExecutor",
    "SYSTEM_PROMPT_TEMPLATE",
    "FEW_SHOT_EXAMPLES",
    "PromptBuilder",
    "RouteDecision",
    "ToolCallData",
    "build_system_prompt",
    "build_messages",
    "DeepPDFAgent",
]
