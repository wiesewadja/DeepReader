# Feedback Sensors — Agent 自纠错传感器系统

## Problem Statement

**How might we** 让 AI Agent 在编码过程中自动感知错误、架构退化并自我纠错，而不是积累改动后在最后才发现问题？

## Recommended Direction

三阶段递进式构建 Agent 反馈传感器系统。每阶段独立可用、价值递增。

**阶段 1：补基础设施（ESLint + TypeScript 严格规则）**
项目目前零 lint。ESLint 是投入产出比最高的传感器——配置完成后自动捕获未使用变量、不安全类型操作、import 错误等。接入现有 Stop hook，Agent 每次完成工作时自动跑一遍。这是地基，后续所有高级传感器都建立在「代码能通过 lint」的前提上。

**阶段 2：架构守卫（Import 方向检查）**
把 `.project-rules/` 里的架构约束从文档变成可执行的规则。核心是一个自定义 ESLint 规则或独立脚本，验证 import 方向：views → services → pageindex，禁止跨层直接引用。Agent 改代码时如果打破模块边界，立刻被捕获。这直接解决「代码质量随时间退化」的根因。

**阶段 3：渐进式关卡（Per-file Checkpoints）**
不等 Stop hook 最后一道门，而是在 Agent 每次写文件后自动触发分层检查：ESLint（<1s）→ tsc 增量（<3s）→ 相关单测（<5s）。任何一层失败，Agent 立刻修，不积累技术债。这解决「Agent 改坏东西不知道」的痛点。

## Key Assumptions to Validate

- [ ] **ESLint 规则能覆盖 Agent 常犯错误** — 检查最近 20 次 Agent 引入的 bug，分类看多少是 lint 可捕获的。如果 <50%，优先级需要重新评估
- [ ] **Import 方向规则能用简单模式表达** — 扫描现有代码，看是否有大量「合理但违反规则」的 import（灰色地带太多则规则无效）
- [ ] **Agent 能理解 lint 输出并自修** — 对 Claude Code 而言大概率成立，但需要实际验证闭环成功率
- [ ] **增量检查延迟 <5s** — 在项目规模下测量实际耗时

## MVP Scope

**阶段 1 MVP（先做这个）：**
- 添加 ESLint + @typescript-eslint 插件
- 配置核心规则集（no-unused-vars, no-explicit-any, no-console, import 规范等）
- 接入 `npm run lint` 命令
- 修改 Stop hook：build + test:run + **lint**
- 排除已有代码的 lint 错误（用 eslint-disable 或分批修复）

**阶段 2 MVP：**
- 设计模块依赖方向规则（从 .project-rules/ 提取）
- 实现为 ESLint 自定义规则或独立脚本
- 配置为禁止/警告级别

**阶段 3 MVP：**
- 设计 per-file checkpoint hook（PostToolUse hook on Write/Edit）
- 实现 ESLint → tsc → vitest related tests 分层检查
- 失败时自动反馈给 Agent（hook 输出即反馈）

## Not Doing (and Why)

- **Review Agent 循环（方向 C）** — 复杂度高，可能陷入死循环。现有 review skill 手动触发已够用
- **覆盖率门禁（方向 D）** — 项目测试有大量 mock，覆盖率数字可能虚假。等测试质量提升后再考虑
- **Pre-commit hooks** — 项目规则要求 Agent 不直接 git commit，commit 由用户审查后执行，pre-commit hook 意义不大
- **Prettier 格式化** — 格式化不解决质量/正确性问题，属于锦上添花
- **CI 改造** — CI 已有 build + test，等本地传感器成熟后再升级 CI 层
- **全量架构分析（ArchUnit 等）** — 简单 import 方向检查已覆盖 80% 场景，不需要重量级工具

## Open Questions

- ESLint 配置应该多严格？初期只开 `error` 级别规则，还是 `warn` 也纳入 Agent 反馈？
- 阶段 3 的「相关单测」怎么确定？Vitest 支持 `--related` flag 吗？
- 是否需要为 Agent 提供自定义的「修复提示」模板，帮助它更准确地修复 lint 错误？

## Phased Delivery

| Phase | Scope | Est. Time | Deliverable |
|-------|-------|-----------|-------------|
| 1 | ESLint 基础 + Stop hook 集成 | 2-4h | `npm run lint` + 更新的 Stop hook |
| 2 | Import 方向规则 | 4-8h | 自定义 ESLint 规则 + 模块边界文档 |
| 3 | Per-file Checkpoints | 8-16h | PostToolUse hook + 分层检查脚本 |
