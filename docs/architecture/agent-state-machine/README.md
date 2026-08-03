# Agent 状态机分层架构文档

> 从路由开始，一层一层梳理清楚 DeepReader Agent 状态机。
> 重点不是「它是什么」，而是「它现在有哪些问题、可以怎么优化」。

---

## 0. 文档定位

### 与现有文档的关系

| 文档 | 关系 |
|------|------|
| [`../agent-overview.md`](../agent-overview.md) | **入口导览**（30 分钟读懂 Agent），构建全景 |
| **`docs/architecture/agent-state-machine/`**（本目录） | **按 9 层视角**的深度剖析（每层「现状 + 已知问题 + 优化探讨」） |

**互补关系：**
- `agent-overview.md` 适合**新人 onboarding**（30 分钟读懂系统）
- 本目录适合**优化与重构**前的现状盘点（每层都列出"可改"的具体点）

### 谁该读这份文档

- **想优化 Agent 性能/质量**的工程师：从 L4 节点层 + L5 子图层读起
- **想接入新工具/新节点**的工程师：读 L4 + L6
- **想排查 LLM 输出问题**的工程师：读 L7 验证管道 + L3 流处理
- **想理解架构全貌**的新人：按 L0 → L8 顺序读（建议预留 2-3 小时）

### 每篇文档的固定结构

每层文档统一 5 段：

1. **现状**：接口、文件位置、关键代码、调用关系
2. **已知问题**：bug / 反模式 / 性能瓶颈 / 文档缺失
3. **优化探讨**：具体方案 + 收益 + 风险（**不承诺落地**）
4. **关键文件路径**：跳转速查
5. **关联文档**：横向链接到其它层 + ADR

---

## 1. 分层总览

DeepReader Agent 的请求处理链路，按"从外到内、自顶向下"拆为 9 层：

```
┌─────────────────────────────────────────────────────────────┐
│  L0  External Trigger  外部触发层                              │
│      chat-controller / proactive engine / HITL / cross-book  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L1  FrontendAgent     入口层（唯一对外 API）                  │
│      runGraphEngine / IntentRouter / buildConfigurable       │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L2  LangGraph         状态机层（节点编排 + 边路由）           │
│      8 nodes / 5 conditional edges / safeNode / checkpointer │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L3  Stream Processor  流处理层（chunk → 回调 → UI）           │
│      processGraphStream / interrupt / EvalTraceData          │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L4  Nodes             节点层（S0-S4 + Visualizer + Advisor）  │
│      8 个节点各自的 prompt / 早停 / 输出格式                   │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L5  Subgraphs         子图层（Plan-Execute vs ReAct）         │
│      plan-execute / react-loop / tool-execution 共享层        │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L6  Tools             工具层（13 个工具）                     │
│      createLangChainTools / ToolContext / 错误处理             │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L7  Validation        验证与输出处理层（S4 6 道后处理）        │
│      validateLinkPairs / verifyAndCleanContent /             │
│      validateWikiLinks / stripFabricatedLinks / appendErrors  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  L8  Infrastructure    基础设施层（LLM/Memory/Context/Tracer） │
│      LLMClientManager / MemoryStore / ContextBuilder / Tracer │
└─────────────────────────────────────────────────────────────┘
```

**关键观察：**
- **L0-L2 是「调度」**：决定"什么时候、谁、调什么"
- **L3-L4 是「执行」**：决定"怎么调、生成什么"
- **L5-L6 是「能力」**：决定"能调什么工具、怎么并行"
- **L7-L8 是「保障」**：决定"输出是否可信、跑得稳不稳"

---

## 2. 分层索引

| 层 | 文档 | 一句话摘要 | 优化讨论密度 |
|----|------|------------|--------------|
| **L0** | [L0-external-trigger.md](./L0-external-trigger.md) | Agent 是怎么被"叫醒"的 | ★★ |
| **L1** | [L1-frontend-agent.md](./L1-frontend-agent.md) | 唯一对外 API + IntentRouter | ★★★ |
| **L2** | [L2-langgraph-state-machine.md](./L2-langgraph-state-machine.md) | 8 节点 + 5 边 + safeNode | ★★★ |
| **L3** | [L3-stream-processor.md](./L3-stream-processor.md) | chunk 流 → UI 回调 | ★★ |
| **L4** | [L4-nodes.md](./L4-nodes.md) | S0-S4 节点的 prompt/早停/输出 | ★★★★★ |
| **L5** | [L5-subgraphs.md](./L5-subgraphs.md) | Plan-Execute vs ReAct | ★★★★ |
| **L6** | [L6-tools.md](./L6-tools.md) | 13 个工具的注册与执行 | ★★★ |
| **L7** | [L7-validation-pipeline.md](./L7-validation-pipeline.md) | S4 6 道后处理（wiki 链接守护） | ★★★★★ |
| **L8** | [L8-infrastructure.md](./L8-infrastructure.md) | LLM/Memory/Context/Tracer | ★★★ |

（优化讨论密度 = 该层在重构时"可改动的点"数量，★★★★★ 表示最高）

---

## 3. 推荐阅读路径

### 路径 A：自顶向下（新人 / 全局理解）

```
L0 → L1 → L2 → L3 → L4 → L5 → L6 → L7 → L8
```

- **耗时**：2-3 小时
- **目标**：建立"用户输入 → 屏幕输出"的完整心智模型
- **副作用**：会看到大量"已知问题"，做好心理准备 😄

### 路径 B：自底向上（优化 / 重构）

```
L8 → L6 → L5 → L4 → L7 → L3 → L2 → L1 → L0
```

- **耗时**：2-3 小时
- **目标**：从基础设施开始，逐层向上"找可改的点"
- **适用**：写重构方案、估算工作量

### 路径 C：按主题切入（特定问题）

| 你想解决的问题 | 推荐阅读 |
|----------------|----------|
| LLM 输出有 wiki 死链 / 链接错位 | L7 → L4-S4 → L6 |
| 工具调用太慢 / 经常超时 | L5 → L6 → L8 |
| S2 节点 token 消耗太高 | L4-S2 → L5 → L8（LLM 常量） |
| 新书加载时第一次响应卡顿 | L8（MemoryStore / ContextBuilder） |
| 主动引擎触发时机不准 | L0 → L2（routeFromStart） |
| 流式输出 UI 不同步 | L3 → L4-S4（流式 chunks） |
| 跨书模式链接错位 | L7 → L4-S4（fixupWikiLinks） |

### 路径 D：纵向追踪（一个用户请求的生命周期）

> 适合：理解"一次用户提问经过哪些层"。

```
1. 用户在 chat-controller 输入问题
   → L0
2. AgentChatController.callAgent() → FrontendAgent.chat()
   → L1
3. runGraphEngine() 编译 configurable、调用 IntentRouter
   → L1
4. cognitiveEngine.stream() 启动 LangGraph
   → L2
5. Inspectional (含 S0 Router) 决定 depth + scope → 边 routeAfterInspectional
   → L2 + L4
6. 路径 1：S1 → S2-Pre → S2 → S4
   路径 2：S1 → S3（跨书）→ S4
   路径 3：S1 → Advisor
   → L2 + L4
7. S2 节点调 runPlanExecute
   → L5
8. Plan-Execute 调 createLangChainTools 选白名单工具
   → L5 + L6
9. 工具结果回流 → S2 Synthesize → 写入 state
   → L5
10. S4 formatterNode 流式输出
    → L4
11. 6 道后处理：validateLinkPairs → verify → cleanOutput → validateWikiLinks → strip → append
    → L7
12. 格式化 output 推回 stream
    → L3
13. UI 收到 chunk 渲染
    → L0
```

---

## 4. 跨文档关键主题

这些主题横跨多层，单独拎出来便于交叉定位：

### 主题 1：双模型分工（main + fast）

| 层 | 体现 |
|----|------|
| L1 | LLMClientManager 持有双客户端 |
| L4 | S0/S1 用 fast；S2/S4 用 main |
| L5 | Plan-Execute 子图也用 main |
| L8 | 详细接口 + fallback 机制 |
| ADR | [ADR-006](../../../decisions/ADR-006-dual-model-routing.md) |

### 主题 2：工具调用与早停

| 层 | 体现 |
|----|------|
| L4 | S2-Pre / S2 各自的早停阈值（`0.6` / `0.3`） |
| L5 | `maxIterations` / `maxToolCalls` / `maxPlanRounds` |
| L6 | 工具白名单（`s2ToolNames`） |
| ADR | [ADR-009](../../../decisions/ADR-009-s2-multi-layer-early-stop.md) |

### 主题 3：Wiki 链接可信度

| 层 | 体现 |
|----|------|
| L4 | S4 6 道后处理总入口 |
| L6 | `search_book` / `read_book_section` 工具结果中含 block_id |
| L7 | 6 道后处理细节：link 配对 / 工具结果校验 / vault 真实校验 / 变形文件名清理 |
| L8 | 引用 `MAX_TOOL_RESULT_LENGTH=4000`（影响工具结果是否被截断） |

### 主题 4：HITL（人机协同）中断与恢复

| 层 | 体现 |
|----|------|
| L0 | chat-controller 接收 `__interrupt__` |
| L2 | MemorySaver checkpointer |
| L3 | stream 中识别 `__interrupt__` chunk |
| L4 | S2-Pre / S2 节点的 `humanReviewRequired` 信号 |

### 主题 5：跨书模式

| 层 | 体现 |
|----|------|
| L0 | chat-controller 注入 `crossBookMode: true` |
| L1 | `buildConfigurable` 透传 crossBook 字段 |
| L4 | S3 Syntopical 节点；S4 fixupWikiLinks 跨书守卫 |
| L7 | L7 文档 2.4 节"跨书误加书名"问题 |
| L6 | `search_read_books` 跨书工具 |

---

## 5. 优化建议优先级（按"成本/收益"排序）

> 这是基于文档中"已知问题 + 优化探讨"的横向汇总。
> **不承诺落地**，仅作决策参考。

### P0（低成本 / 高收益 / 应立即做）

| 优化点 | 涉及层 | 预期收益 |
|--------|--------|----------|
| 统一工具错误格式（结构化） | L5 + L6 | LLM 错误处理 prompt 简化；Eval 跑分归类 |
| 工具白名单集中化 | L4 + L6 | 新增工具改 1 处 |
| Plan-Execute 移除 ReAct（评估后） | L5 | 减少维护成本 |
| ContextLoader 标记 deprecated | L8 | 减少新人混淆 |

### P1（中成本 / 中高收益 / 排期做）

| 优化点 | 涉及层 | 预期收益 |
|--------|--------|----------|
| 工具超时控制 | L6 | 慢工具不再卡 LLM 循环 |
| Loop Detection 跨子图共享 | L5 | Plan-Execute 节省 token |
| Tracer 注入标准化 | L2 + L8 | LangSmith trace 完整 |
| MemoryStore 压缩后台化 | L8 | 减少 L1 IO 开销 |
| voice pipeline 边流边合成 | L3 + L8 | 总等待时间 ↓ 30% |

### P2（高成本 / 高收益 / 长期规划）

| 优化点 | 涉及层 | 预期收益 |
|--------|--------|----------|
| SharedContext / ToolContext 瘦身重构 | L1 + L6 + L8 | 边界清晰；依赖注入更精细 |
| LLMClientManager 与 ChatModels 合并 | L1 + L8 | 消除两套模型实例化逻辑 |
| Plan-Execute 工具依赖图模式 | L5 | 复杂场景 LLM 调用次数 ↓ |
| AgentConstants 配置化（可被用户设置覆盖） | L8 | 调参有依据 |

### P3（探索性 / 待观察）

| 优化点 | 涉及层 | 备注 |
|--------|--------|------|
| 9 阶段检索早期终止 | L6 | 性能优化但需测试稳定性 |
| 工具 trace span | L6 | 需 LangSmith 配合 |
| ContextBuilder 与 ContextLoader 合并 | L8 | 涉及向后兼容 |

---

## 6. ADR 索引（关联本目录）

| ADR | 关联层 | 摘要 |
|-----|--------|------|
| [ADR-001](../../../decisions/ADR-001-four-layer-reading.md) | L1, L4 | 四层阅读法（S0/S1/S2/S4） |
| [ADR-003](../../../decisions/ADR-003-langgraph-state-machine.md) | L2 | 选 LangGraph 作为状态机框架 |
| [ADR-006](../../../decisions/ADR-006-dual-model-routing.md) | L1, L4, L8 | 双模型分层架构（main + fast） |
| [ADR-007](../../../decisions/ADR-007-memory-and-session-architecture.md) | L8 | MEMORY.md + JSONL 长期记忆 |
| [ADR-008](../../../decisions/ADR-008-proactive-engine-design.md) | L0 | 主动引擎（Proactive Engine） |
| [ADR-009](../../../decisions/ADR-009-s2-multi-layer-early-stop.md) | L4, L5 | S2 多层早停机制 |
| [ADR-010](../../../decisions/ADR-010-shared-context-convergence.md) | L1, L2, L4 | SharedContext 收敛，State/Context 划界 |
| [ADR-011](../../../decisions/ADR-011-sidebar-view-domain-split.md) | L0, L1 | SidebarView 域拆分：Domain + Presenter + EventBus |
| [ADR-012](../../../decisions/ADR-012-security-boundary-mechanism.md) | L1, L3, L4 | 安全边界：三层防御防系统提示词泄露 |

---

## 7. 维护规则

### 文档更新触发条件

- **代码层面新增/删除层** → 更新本 README 总览图
- **代码层面新增/删除节点或工具** → 更新 L4 / L6 表格
- **新 ADR 与状态机相关** → 在第 6 节 ADR 索引追加
- **重构完成并落地某个优化** → 在对应 L 文档的"已知问题"移除条目

### 文档禁区

- ❌ **不要在这里贴大段代码**：用 `文件:行号` 引用即可
- ❌ **不要把"优化探讨"作为承诺**：每条加"**不承诺落地**"标记
- ❌ **不要写"未来 N 个季度计划"**：优化建议应是技术性的，不含时间表

### 与代码同步

- 每层文档的"关键文件路径"应保持与代码一致
- 每次 PR 修改 agent 模块时，**必须**更新相关 L 文档的"现状"段
- LLMClientManager / LangGraph 版本升级时，全套 L 文档需要 review

---

## 8. 致读者

> 本目录是**为优化而写**的，不是为介绍而写。
> 如果你只想要"30 分钟读懂 Agent"，请读 [`../agent-overview.md`](../agent-overview.md)。
>
> 如果你想要"接下来半年我们要改什么"，请按路径 B 读完全部 9 篇。
>
> 如果你想提 PR 重构，请先选好目标 L 层 → 读"已知问题" → 选 1 个问题 → 写优化方案 → 跑测试。
>
> **不要同时改 3 层**——状态机的耦合度比你想象的高。
