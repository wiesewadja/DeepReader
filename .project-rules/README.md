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
| `08-mobile-compat.md` | 移动端兼容（Node 核心模块惰性工厂） | 共用 |
| `09-branching.md` | 分支模型（worktree → dev → main） | 共用 |

## 维护原则

- **单一真源**：所有共用规则写在 `01`–`09` 文件。改任一文件即对所有 agent 生效，无需在 `CLAUDE.md` 与 `AGENTS.md` 两处同步。
- **入口文件 = 内联速查 + 选择性 `@` 导入**：`CLAUDE.md`（Claude Code）与 `AGENTS.md`（OpenCode / WorkBuddy）内联高频命令、架构、运行时、红线、约束等每次必用的速查，并对**高频段**（部署 07、分支 09）用 `@.project-rules/XX.md` 内联导入完整规则；其余文件（01–06、08）**不**全量 `@` 导入，避免每会话上下文膨胀，由 agent 按需读取。
- **`@import` 兼容性与成本**：Claude Code、OpenCode 会解析 `@` 并在会话启动时**全量加载**被 `@` 的文件（实时加载、非懒加载，吃 token），故只 `@` 高价值单文件；**不解析 `@import` 的 agent（如 WorkBuddy）只读取入口文件内联内容**，因此红线与高频命令必须留在入口文件内联，不能只靠 `@` 转发。
- **agent 差异**：当前 Claude Code 与 OpenCode 共用全部规则，无独有差异，故不设 `agent-specific/`。将来若出现某 agent 独有的工具行为差异，再新建 `agent-specific/<agent>.md` 并在对应入口 `@` 导入。
