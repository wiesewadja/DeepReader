# ADR-003: LangGraph 状态机作为 Agent 框架

## 状态
Accepted

## 日期
2026-03（项目创始）

## 背景

AI 对话需要框架来编排多步推理。选择影响：开发效率、可调试性、灵活性。

## 决策

使用 LangGraph（基于 LangChain）的状态图（StateGraph）作为 Agent 编排框架。定义明确的节点和边，状态在节点间传递。

## 替代方案

### 纯 LangChain Agent（ReAct）
- 优点：实现更快，社区文档多
- 缺点：无法精确控制状态流转，调试困难，无法实现"提早停止"等条件逻辑
- 放弃原因：四层阅读法需要精确的状态控制，纯 ReAct 无法满足

### 自研状态机
- 优点：零依赖，完全控制
- 缺点：需要自己实现流式输出、错误恢复、工具调用协议
- 放弃原因：重复造轮子，LangGraph 已覆盖这些需求

### Direct LLM API（无框架）
- 优点：最轻量，无依赖
- 缺点：需要自己管理对话历史、工具调用、流式处理
- 放弃原因：工作量大，且容易出 bug

## 后果
- 依赖 `@langchain/core` + `@langchain/langgraph` + `@langchain/openai`（增加包体积）
- LangGraph 的编译模型使调试需要 trace 工具（F-34 LangSmith、F-31 PI 可视化器）
- 状态机节点可独立测试，架构清晰
