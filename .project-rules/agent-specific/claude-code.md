# Claude Code 专属指令

本文档补充 `.project-rules/` 通用规则中未覆盖的 Claude Code 特有内容。

## 相关文档

| 文档 | 位置 | 内容 |
|------|------|------|
| Agent 设计 | `docs/ARCHITECTURE-agent.md` | Agent 系统完整架构 |
| Agent 技术文档 | `docs/Agent对话模块技术文档.md` | 对话模块技术细节 |
| LangChain 重构 | `docs/LANGCHAIN-REFACTOR-WALKTHROUGH.md` | LangChain 集成指南 |
| 设计文档 | `docs/plans/` | 功能设计文档 |
| 系统提示词 | `docs/system-prompt-current.md` | 当前使用的 System Prompt |

## UI 组件参考

| 组件 | 文件 | 功能 |
|------|------|------|
| SidebarView | `sidebar-view.ts` | 主侧边栏（对话 + 书籍选择） |
| AIMessage | `message/message.ts` | AI 消息气泡（信笺图案、最大化展示） |
| ReadingModeService | `reading-mode-service.ts` | 分页阅读模式 |
| ReadingTopbar | `reading-topbar/` | 阅读顶栏（书籍封面 + 书名 + 作者） |

### 消息数据流

```
sidebar-view.ts → MessageList → AIMessage → 全屏展示（openFullscreen）
```

## 类型检查

- 确保 `obsidian` 类型定义存在。
- 使用 `// @ts-ignore` 时注明原因。

## 异步操作

- PageIndex API 全部异步，必须 `await`。
- 流式输出使用 `AbortController` 控制。
