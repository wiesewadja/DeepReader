# Claude Code 专属指令

本文档补充 `.project-rules/` 通用规则中未覆盖的 Claude Code 特有内容。

## 相关文档

| 文档 | 位置 | 内容 |
|------|------|------|
| Agent 设计 | `docs/architecture/agent-overview.md` | Agent 系统完整架构 |
| 状态机流程 | `docs/architecture/agent-state-machine/README.md` | Agent 认知状态机流程 |
| 索引设计 | `docs/architecture/book-indexing.md` | 书籍索引流程设计 |

## UI 组件参考

| 组件 | 文件 | 功能 |
|------|------|------|
| SidebarView | `views/sidebar/sidebar-view.ts` | 主侧边栏（对话 + 书籍选择） |
| AIMessage | `message/message.ts` | AI 消息气泡（信笺图案、最大化展示） |
| ReadingModeService | `reading-mode-service.ts` | 分页阅读模式 |
| ReadingTopbar | `reading-topbar/` | 阅读顶栏（书籍封面 + 书名 + 作者） |

### 消息数据流

```
sidebar-view.ts → sidebar/agent-chat-controller → MessageList → AIMessage → 全屏展示（openFullscreen）
```

## 类型检查

- 确保 `obsidian` 类型定义存在。
- 使用 `// @ts-ignore` 时注明原因。

## 异步操作

- PageIndex API 全部异步，必须 `await`。
- 流式输出使用 `AbortController` 控制。
