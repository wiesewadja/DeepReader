# DeepReader Agent Engineer — 认知引擎开发专家

## Problem Statement

如何让 AI 像一个熟悉 DeepReader `src/agent/` 全部架构的资深工程师一样接活干活——理解需求、选对 skill、遵守项目规范、自动交付质量稳定的代码？

## Recommended Direction

创建 `deepreader-agent-engineer` agent——一个专精 LangGraph 认知引擎（S0-S4）开发的领域专家。它内化了路由图、状态机、工具映射、prompt 约定等核心知识，能自动判断任务类型并调度 plan/spec/implement/review/test skill，无需用户手动编排。

核心设计：
- **Reference files 架构知识**（不是动态摘要）—— 3 个精心编写的参考文件，按需加载
- **任务自调度**——根据需求描述自动选择 skill 组合
- **质量门禁**——每个任务完成后自动触发对应层级的验证

## Key Assumptions to Validate

- [ ] Reference files 能覆盖 80% 的日常开发知识需求，剩下 20% 通过 Read 原文件补充
- [ ] Agent 能在 5 种任务类型中正确选择 skill（路由修改 / prompt 调优 / 工具开发 / trace 分析 / 重构）
- [ ] 单个 agent prompt（~300行）+ 3 个 reference files 够用，不需要 sub-agent 拆分

## MVP Scope

### 产出物

一个 agent 定义文件 + 3 个 reference files：

```
.claude/agents/deepreader-agent-engineer.md    # Agent 定义
.claude/skills/deepreader-agent-engineer/       # Skill 目录（供 agent 加载 references）
  references/
    routing-map.md          # 已有：路由图 + 节点表 + 工具映射
    architecture-summary.md # 新增：L0-L8 状态机 + 目录约定 + 编码约束
    prompt-engineering.md   # 新增：prompt 模板约定 + 已知坑 + 调优指南
```

### Agent 核心能力

1. **架构导航**：知道每个修改该碰哪些文件、不该碰哪些
2. **任务分类 + Skill 调度**：

| 任务类型 | 信号词 | Skill 路径 |
|---------|--------|-----------|
| 新功能 | "新增/添加/实现" | plan → spec → implement → test |
| Bugfix | "修复/修/报错/失败" | 诊断 → implement → test |
| Prompt 调优 | "prompt/回答差/调优" | Read references → implement → agent-live-test |
| 重构 | "重构/拆分/合并" | plan → implement → test |
| Trace 分析 | "trace/token/耗时" | langsmith-tracer → 诊断 → implement |

3. **变更影响意识**（不是禁止，是改之前要知道连锁影响）：
   - `formatter.ts` 修改影响所有深度的输出格式 → 改后需跑完整 e2e-cli
   - `preSearchNode` 修改影响早停决策和 scope → 改后需跑 e2e-cli + 检查早停黄金测试集
   - `state.ts` Annotation 修改 → 所有节点都需要同步
   - prompt 模板变量 → 上下游节点可能依赖这些字段
   - 新增/删除工具 → `definitions/` 注册 + router 允许列表 + LangSmith trace 标记

4. **文档意识**：
   - 改完代码后提示更新 `docs/architecture/` 对应文档
   - 重大架构变更提示写 ADR

### Reference Files 内容规划

#### routing-map.md（已有，保持）
- 路由图节点表 + 条件边
- 深度分类规则 + 覆盖规则
- 工具映射
- EvalTraceData 结构

#### architecture-summary.md（新增）
- L0-L8 状态机层级表
- `src/agent/` 目录结构与职责
- 关键类/接口：`CognitiveEngineState`、`FrontendAgent`、`StreamProcessor`
- 数据流：用户消息 → sidebar → FrontendAgent.chat() → runGraphEngine() → stream()
- 编码约定：日志用 logger、数据用 fs、插件 ID 用 manifest.id
- 已知约束：preSearchNode 的 scope 机制、formatter 的三阶段处理

#### prompt-engineering.md（新增）
- 各节点 prompt 文件位置与结构
- 模板变量约定（`${pdfName}`、`${tocSummary}` 等）
- prompt 修改的常见坑：
  - prompt 太长导致 LLM 截断
  - 中文 prompt 的 token 效率
  - system prompt vs user prompt 的分工
- 调优工作流：改 prompt → agent-live-test → LangSmith trace 对比

## Not Doing (and Why)

- **不做 UI 开发覆盖** — UI 修改用通用 Claude 即可，不需要领域专家
- **不做自动 CI/CD** — 开发 agent 只负责写代码 + 本地验证，不负责部署
- **不做 LLM provider 层** — model 配置、API 兼容性是独立的领域
- **不做多 agent 协作** — 单个 agent 足够，不引入调度复杂度
- **不做动态文档摘要** — Reference files 模式更可控、更快

## Open Questions

- architecture-summary.md 的详细程度：应该写到"知道该读哪个文件"还是"读完就不用再看原文"？
- 是否需要为 `tools/` 子目录单独一个 reference file（当前放在 architecture-summary 里）？
- agent 的 model 选择：inherit（跟用户设置）还是强制 sonnet（平衡速度和质量）？
