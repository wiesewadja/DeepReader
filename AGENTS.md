# DeepReader — AGENTS.md

> 本文档面向 OpenCode/AI Coding Agent。完整项目信息见 `.project-rules/` 目录。

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
| `.project-rules/agent-specific/opencode.md` | OpenCode 专属提示 |

**开始前，请先阅读以上全部文档。**

---

## 摘要（快速参考）

- **项目**: 奚童：Obsidian 深度阅读插件（TypeScript + LangGraph）
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

---

## OpenCode Skill 集成

### 核心规则

- 如果任务匹配某个 skill，必须使用它
- Skills 位于 `.agents/skills/<skill-name>/SKILL.md`
- 不要在 skill 适用时直接实现
- 严格遵循 skill 指令（不要部分应用）

### Intent → Skill 映射

Agent 应自动将用户意图映射到 skills：

- 功能/新功能 → `spec-driven-development`，然后 `incremental-implementation`，`test-driven-development`
- 规划/分解 → `planning-and-task-breakdown`
- Bug/失败/意外行为 → `debugging-and-error-recovery`
- 代码审查 → `code-review-and-quality`
- 重构/简化 → `code-simplification`
- API 或接口设计 → `api-and-interface-design`
- UI 工作 → `frontend-ui-engineering`

### 生命周期映射

OpenCode 不支持 `/spec` 或 `/plan` 等斜杠命令。

Agent 必须内部遵循此生命周期：

- DEFINE → `spec-driven-development`
- PLAN → `planning-and-task-breakdown`
- BUILD → `incremental-implementation` + `test-driven-development`
- VERIFY → `debugging-and-error-recovery`
- REVIEW → `code-review-and-quality`
- SHIP → `shipping-and-launch`

### 执行模型

对于每个请求：

1. 确定是否有任何 skill 适用（即使 1% 的可能性）
2. 使用 `skill` 工具调用适当的 skill
3. 严格遵循 skill 工作流程
4. 在完成所需步骤（spec、plan 等）后才能继续实现
