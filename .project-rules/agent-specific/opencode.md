# OpenCode 专属指令

本文档补充 `.project-rules/` 通用规则中未覆盖的 OpenCode 特有内容。

OpenCode 的 Skill 体系不同于 Claude Code 的集中式仓库。本项目遵循 OpenCode 的项目级指令模式，所有项目信息已纳入 `.project-rules/` 目录。

## 与 Claude Code 的差异

| 方面 | OpenCode | Claude Code |
|------|----------|-------------|
| 指令文件 | `AGENTS.md`（本文件） | `CLAUDE.md` |
| 技能管理 | 项目级 `.project-rules/` | 同上 + 全局 skill 仓库 |
| 代码理解 | understand-anything 插件 | understand-anything 插件 |
| 测试运行 | 同上 | 同上 |

本文件为精简转发版，完整项目信息见 `.project-rules/` 目录。
