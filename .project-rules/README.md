# .project-rules/

本项目统一的 AI Agent 指令库，供 Claude Code（`CLAUDE.md`）和 OpenCode（`AGENTS.md`）共享。

## 文件组织

| 文件 | 内容 | 使用方 |
|------|------|--------|
| `01-overview.md` | 项目概述、定位、技术栈 | 共用 |
| `02-architecture.md` | 目录结构、架构约定 | 共用 |
| `03-development.md` | 构建命令、开发工作流、调试方法 | 共用 |
| `04-testing.md` | 测试策略（单元 + E2E） | 共用 |
| `05-conventions.md` | 代码风格、Git 规范 | 共用 |
| `06-security-privacy.md` | 安全与隐私 | 共用 |
| `07-deployment.md` | 部署规范（worktree 统一覆盖 deepreader-dev） | 共用 |
| `agent-specific/claude-code.md` | Claude Code 专属提示 | Claude Code |
| `agent-specific/opencode.md` | OpenCode 专属提示 | OpenCode |

## 维护原则

- **改一处，两处生效**：共用内容写在 01-06 文件，两个 agent 都引用。
- **agent 差异**写在 `agent-specific/` 下，各 agent 只加载自己的。
- CLAUDE.md 和 AGENTS.md 只做引用转发，不存实质内容。
