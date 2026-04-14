import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ToolContext } from "../types";

/**
 * 工具创建工厂函数类型。
 * 每个工具通过闭包捕获 ToolContext，返回 LangChain Tool 实例。
 * 使用 StructuredToolInterface 而非 Tool，兼容 DynamicStructuredTool。
 */
export type ToolFactory = (ctx: ToolContext) => StructuredToolInterface;
