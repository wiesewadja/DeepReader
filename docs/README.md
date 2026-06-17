# DeepReader 文档索引

## 快速导航

| 我想了解… | 去哪里 |
|-----------|--------|
| 产品是什么、为什么存在 | [VISION.md](./VISION.md) |
| 功能列表和验收标准 | [features/](./features/) |
| 整体架构鸟瞰 | [architecture/system-overview.md](./architecture/system-overview.md) |
| Agent 状态机（30 分钟读懂） | [architecture/agent-overview.md](./architecture/agent-overview.md) |
| Agent 状态机深度剖析 | [architecture/agent-state-machine/](./architecture/agent-state-machine/) |
| 为什么这样设计 | [decisions/](./decisions/)（ADR-001 ~ ADR-009） |
| 如何测试 | [testing/](./testing/) |
| 开发规范 | [development/](./development/) |

---

## 产品

| 文档 | 说明 |
|------|------|
| [VISION.md](./VISION.md) | 产品愿景、核心信念、设计原则、产品边界 |
| [features/](./features/) | 功能特征（F-01 ~ F-36，按分组独立文件） |
| [product-manual.md](./product-manual.md) | 技术手册——模块、API、数据流（开发者视角） |

## 架构

| 文档 | 说明 |
|------|------|
| [agent-overview.md](./architecture/agent-overview.md) | Agent 系统入口导览（30 分钟读懂） |
| [agent-state-machine/](./architecture/agent-state-machine/) | Agent 认知状态机 9 层深度剖析（L0-L8） |
| [system-overview.md](./architecture/system-overview.md) | 全栈架构鸟瞰（UI → Agent → 索引 → 服务） |
| [book-indexing.md](./architecture/book-indexing.md) | 书籍索引流程与数据结构 |
| [book-search.md](./architecture/book-search.md) | 搜索系统（混合搜索、命题、跨书） |
| [intent-router.md](./architecture/intent-router.md) | 意图路由系统（IntentRouter） |
| [session-and-memory.md](./architecture/session-and-memory.md) | 会话持久化 + 长期记忆 + LangSmith |
| [session-manager.md](./architecture/session-manager.md) | Sidebar 会话管理（生命周期 + 模式切换） |
| [context-manager.md](./architecture/context-manager.md) | 已加载文档上下文管理 |
| [config-system.md](./architecture/config-system.md) | 配置系统（角色、模型、参数） |
| [error-handling-and-degradation.md](./architecture/error-handling-and-degradation.md) | 3 层错误处理（网络/索引/业务） |
| [error-model-and-degradation.md](./architecture/error-model-and-degradation.md) | Agent 节点错误模型（safeNode + fallback） |
| [logger-and-error-handler.md](./architecture/logger-and-error-handler.md) | Logger + ErrorHandler 基础设施 |
| [prompt-modules.md](./architecture/prompt-modules.md) | Prompt 模块化组装 |
| [tools-execution-model.md](./architecture/tools-execution-model.md) | 工具执行模型 |
| [ui-architecture.md](./architecture/ui-architecture.md) | UI 架构（纯 TypeScript + DOM） |
| [wiki-link-system.md](./architecture/wiki-link-system.md) | WikiLink 系统 |
| [early-stop-decision.md](./architecture/early-stop-decision.md) | 早停决策原理与问题 |
| [tech-debt-analysis.md](./architecture/tech-debt-analysis.md) | 技术债务分析 |

## 决策记录（ADR）

| ADR | 主题 |
|-----|------|
| [ADR-001](./decisions/ADR-001-four-layer-reading.md) | 四层阅读体系 |
| [ADR-002](./decisions/ADR-002-local-first-no-backend.md) | Local-first 无后端 |
| [ADR-003](./decisions/ADR-003-langgraph-state-machine.md) | LangGraph 状态机 |
| [ADR-004](./decisions/ADR-004-hybrid-search-bm25-vector.md) | 混合搜索 BM25+Vector |
| [ADR-005](./decisions/ADR-005-data-files-use-fs-not-vault-api.md) | 数据文件用 fs 不用 Vault API |
| [ADR-006](./decisions/ADR-006-dual-model-routing.md) | 双模型路由 |
| [ADR-007](./decisions/ADR-007-memory-and-session-architecture.md) | 记忆与会话架构 |
| [ADR-008](./decisions/ADR-008-proactive-engine-design.md) | 主动引擎设计 |
| [ADR-009](./decisions/ADR-009-s2-multi-layer-early-stop.md) | S2 多层早停 |

## 测试

| 文档 | 说明 |
|------|------|
| [smoke-scenarios.md](./testing/smoke-scenarios.md) | 冒烟测试场景（25 场景） |
| [agent-eval-cli.md](./testing/agent-eval-cli.md) | Agent 评估 CLI 用法 |
| [early-stop-golden-cases.md](./testing/early-stop-golden-cases.md) | 早停黄金测试用例 |
| [excalidraw-visualization.md](./testing/excalidraw-visualization.md) | Excalidraw 可视化测试策略 |

## 集成

| 文档 | 说明 |
|------|------|
| [weread-api-docs.md](./integrations/weread-api-docs.md) | 微信读书 Agent API Gateway |
| [proactive.md](./integrations/proactive.md) | 主动阅读引擎 |
| [profile.md](./integrations/profile.md) | 用户画像 |
| [tts-asr.md](./integrations/tts-asr.md) | TTS/ASR 语音 |
| [zlibrary.md](./integrations/zlibrary.md) | Z-Library 集成 |

## 规格

| 文档 | 说明 |
|------|------|
| [specs/](./specs/) | 功能规格文档（实现前的详细设计） |

## 开发规范

| 文档 | 说明 |
|------|------|
| [worktree-convention.md](./development/worktree-convention.md) | Worktree 使用规范 |
| [SECURITY.md](./SECURITY.md) | 安全策略与漏洞报告 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更日志 |

## 工作流

| 文档 | 说明 |
|------|------|
| [archon-workflow-analysis.md](./workflows/archon-workflow-analysis.md) | Archon 工作流分析 |
| [archon-workflow-usage-guide.md](./workflows/archon-workflow-usage-guide.md) | Archon 使用指南 |
| [archon-workflow-best-practices.md](./workflows/archon-workflow-best-practices.md) | Archon 最佳实践 |

## 归档

| 目录 | 说明 |
|------|------|
| [archive/ideas/](./archive/ideas/) | 历史设计想法 |
| [archive/test-reports/](./archive/test-reports/) | 历史测试报告 |
