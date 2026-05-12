# DeepReader — CLAUDE.md

> 本文档面向 Claude Code。完整项目信息见 `.project-rules/` 目录。

---

## 快速入口

| 文档 | 内容 |
|------|------|
| `.project-rules/01-overview.md` | 项目概述、定位、技术栈 |
| `.project-rules/02-architecture.md` | 目录结构、架构约定、Agent 系统 |
| `.project-rules/03-development.md` | 构建命令、开发工作流、调试方法 |
| `.project-rules/04-testing.md` | 测试策略（单元 + E2E） |
| `.project-rules/05-conventions.md` | 代码风格、Git 规范、日志系统 |
| `.project-rules/06-security-privacy.md` | 安全与隐私 |
| `.project-rules/agent-specific/claude-code.md` | Claude Code 专属提示（UI 组件、文档索引） |

**开始前，请先阅读以上全部文档。**

---

## 摘要（快速参考）

- **项目**: Obsidian 深度阅读插件（TypeScript + LangGraph）
- **入口**: `src/main.ts`
- **构建**: `npm run build` / `npm run dev`（watch）
- **测试**: `npm run test:run`（Vitest）
- **部署**: `npm run deploy` → `test-vault/.obsidian/plugins/deepreader/`
- **调试**: Obsidian 中 Cmd+Option+I → `app.plugins.plugins['deepreader']`

## 关键原则

1. **不要自行提交代码** — 需要用户审查后提交。
2. **日志用 `utils/logger.ts`** — 按模块分类，错误日志不受开关影响。
3. **文件路径通过 Vault API** — 不要硬编码路径。
4. **Agent 唯一入口**: `FrontendAgent.chat()` → `runGraphEngine()` → LangGraph `stream()`。
5. **Node.js 兼容**: 始终通过 `src/pageindex/node.ts` 导入 PageIndex。
