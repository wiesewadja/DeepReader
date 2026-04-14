import type { Tool } from "@langchain/core/tools";
import type { ToolContext } from "../types";

/**
 * 工具创建工厂函数类型。
 * 每个工具通过闭包捕获 ToolContext，返回 LangChain Tool 实例。
 */
export type ToolFactory = (ctx: ToolContext) => Tool;
