# ADR-009: S2 多层早停机制设计

## 状态
Accepted

## 日期
2026-05（S2-Pre 早停首版） / 2026-06（统一归档）

## 背景

S2 Analytical 节点是 Agent 最昂贵的一段：它驱动 LLM 反复调用 `search_book` / `read_book_section` 来深读原文。成本结构：

| 成本项 | 单次 | 上限 |
|--------|------|------|
| LLM 调用 | 1 次 | 多次（每次含 1k+ 输入） |
| 工具调用 | 1 次（search_book 触发 BM25+向量混合检索） | 多次 |
| 用户等待 | 1-3s/轮 | 1-3s × 轮数 |

如果不加任何早停：
- 简单查询（"第三章讲什么"）可能被 LLM 过度展开，搜 5+ 次才停
- LLM 偶尔会陷入循环（同样的 query 反复重试）
- 用户等待时间不可预测

如果只加「迭代次数硬限制」：
- 简单查询和复杂查询被同等对待，简单查询明明已经搜到答案还在空转
- 截断时 LLM 还在「想调用工具」状态，需要靠 `force conclusion` 收尾

**核心需求：** 既要给 LLM 足够的空间应对复杂查询（深度 vs 成本的 trade-off），又要在「明显能停」的时候果断停，还要在「失控」时有安全网。

## 决策

采用**三层早停 + 一层收尾**的纵深防御架构：

```
        S2-Pre                 S2 Analytical / ReAct          S4 Formatter
          │                            │                            │
   ┌──────▼──────┐             ┌───────▼────────┐                  │
   │  Layer 1    │             │   Layer 2      │                  │
   │  预检索置信度│             │   硬性迭代上限  │                  │
   │  (质量驱动)  │             │   (成本驱动)    │                  │
   └──────┬──────┘             └───────┬────────┘                  │
          │ wScore ≥ 阈值?              │ iterationCount ≥ max?     │
          │ 命中 → 跳 ReAct            │ toolCallCount ≥ max?       │
          │ 不中 → 走 ReAct             │                            │
          │                            │ ┌──────────────────────┐   │
          │                            │ │  Layer 3             │   │
          │                            │ │  循环检测             │   │
          │                            │ │  (智能引导)            │   │
          │                            │ └──────┬───────────────┘   │
          │                            │        │ 全部重复?          │
          │                            │        │ → 强制收尾          │
          │                            ▼        ▼                    │
          │                       ┌────────────────┐                │
          │                       │  Layer 4       │                │
          │                       │  强制收尾      │                │
          │                       │  (graceful)    │                │
          │                       └────────┬───────┘                │
          │                                │                        │
          └────────────────────────────────┴────────────────────────┘
                                            │
                                            ▼
                                      S4 Formatter
```

### Layer 1：预检索置信度早停

**实现位置：** `src/agent/graph/nodes/analytical-pre-search.ts`

**触发条件**（AND 关系）：
1. `wScore = hits[0].score × 0.6 + hits[1].score × 0.3 + hits[2].score × 0.1 ≥ earlyStopThreshold`
2. `hits.length ≥ 2`
3. `substantiveScore ≥ 30`

**`wScore` 60/30/10 加权公式推导：**
- 不是平均 33/33/33，因为搜索结果的相关性呈**长尾分布**：Top-1 命中通常比 Top-3 高 2-3 倍
- 60% 权重给 Top-1 是经验值，模拟 NDCG 风格的位置衰减
- Top-3 之后权重 < 10%，可忽略

**`substantiveScore ≥ 30` 质量守卫推导：**
```
score = 0
if (block_id 存在)  +20
if (content.length > 20 chars)  +15
content.length / 10 (cap at 30)
```
- 阈值 30 表示「至少 1 个 hit 既有 block_id 又有足够内容」
- 防止「高分空内容」：3 个标题型命中可能 wScore 0.65+，但没有可引用的 block，LLM 写不出有效回答
- 30 这个值是观察 50+ 真实查询的命中分布后定的

**配置：** `DeepPDFSettings.earlyStopThreshold`（0-1 范围，默认 0.6）

**早停命中后：**
- 直接 `mainModel.invoke()` 一次，prompt 注入 pre-search 结果
- 跳过整个 ReAct/Plan-Execute 子图
- 节省 1-8 次 LLM 调用 + 1-5 次工具调用

### Layer 2：硬性迭代上限

**实现位置：** `src/agent/graph/subgraphs/react-loop.ts:190-204` (`shouldContinue`)

**触发条件**（OR 关系，任何一个命中即停）：
1. `iterationCount >= _maxIterations`
2. `toolCallCount >= _maxToolCalls`
3. 无 tool_calls（LLM 主动停，不算早停）

**为什么需要两个计数器：**
- `iterationCount` = agent→tools 循环次数
- `toolCallCount` = 累计工具调用数
- LLM 可能在单次消息里调用**多个工具**（`tool_calls` 是数组）
- 所以一个迭代可能包含 1+ 次工具调用，需要分别限制

**各节点配置差异：**

| 节点 | maxIterations | maxToolCalls | 设计理由 |
|------|---------------|--------------|----------|
| S2 Analytical | **6** | **3** | 主分析路径，允许 2-3 轮搜索 + 1-2 轮验证 |
| Advisor | 4 | 3 | 阅读顾问，简单引导为主 |
| Plan-Execute | - | `min(maxToolCalls, 2)` | 「先计划再执行」范式，每轮调用多个工具，2 轮足够 |

**配置入口：** `reactLoopConfig.maxIterations` / `maxToolCalls`，从节点 options 传入

### Layer 3：循环检测（智能引导）

**实现位置：** `react-loop.ts:73-94` + `:153-169`

**机制：**
- 维护 `queriesAsked: Record<toolName, string[]>` 历史
- 每次工具调用前检查关键词/query 是否已问过
- 重复时返回 `Loop Detection` 警告消息给 LLM，**建议改用 `read_book_section` 批量读**
- **如果一次消息中所有 tool_calls 都是重复 → 立即 `__end__`**（不再给 LLM 机会）

**设计亮点：**
- 不是简单拒绝，而是**引导 LLM 切换策略**（从「搜索」转「直接读取已搜到的章节」）
- 比硬性截断更智能：给 LLM 一次自救机会
- `allDuplicates` 兜底：避免 LLM 持续输出重复 query 导致死循环

### Layer 4：强制收尾

**实现位置：** `react-loop.ts:208-231` (`buildForcedConclusionPrompt`)

**触发时机：** 硬性限制被触发但 LLM 仍想调用工具时

**收尾 prompt 关键内容：**
```
你已达到 {工具调用/迭代} 次数上限（{N} 次）。
现在请基于已收集的所有信息，输出你的最终分析结论。
要求：
1. 综合所有工具调用结果
2. 输出完整的分析内容，不要再次调用工具
3. 如果信息不足，基于已有信息给出尽可能完整的回答
```

**收尾后处理：**
- 调 `verifyAndCleanContent` 清理幽灵 block_id 引用
- 返回 `finishReason` 让上游区分：
  - `'stop'` 正常结束
  - `'max_iterations'` 迭代上限
  - `'max_tool_calls'` 工具上限
  - `'loop_detected'` 全部重复

## 替代方案

### 单层硬性限制（只 Layer 2）
- 优点：实现简单
- 缺点：简单查询和复杂查询被同等对待，成本浪费
- 放弃原因：失去「质量高时主动加速」的能力

### 强制最大 token 数（context 截断）
- 优点：实现最简单
- 缺点：截断后 LLM 不知道哪些信息可用，可能输出混乱
- 放弃原因：信息丢失而非主动收尾，质量差

### 自适应阈值（基于历史成功率动态调整）
- 优点：长期看更优
- 缺点：实现复杂，初期冷启动困难；调试困难
- 暂未采纳：当前固定阈值已能满足需求，列为未来增强

### 用户可配置硬性上限
- 优点：灵活性
- 缺点：用户不理解时容易配错，反而影响体验
- 暂未采纳：`earlyStopThreshold` 已暴露给用户，迭代/工具上限保持内部常量

## 后果

**收益：**
- **成本下降 30-50%**（简单查询触发 Layer 1，跳过 ReAct 循环）
- **延迟下降 1-5s/查询**（Layer 1 命中时）
- **可控的尾延迟**（Layer 2 兜底，最坏情况有上限）
- **优雅降级**（Layer 4 强制收尾，用户不会收到空响应）
- **可观测**（`finishReason` 区分正常/异常退出，便于统计和调优）

**风险与缓解：**
- **`wScore` 阈值过低** → 简单查询提前停止但内容质量差；当前默认 0.6 是经验值，可由用户调高
- **`substantiveScore` 漏判** → 长内容但全部是元数据/页眉；目前依赖 block_id 存在性 + 长度，未来可加 NLP 启发式
- **硬性上限过低** → 复杂查询被截断；当前 6/3 是观察统计后定的，可调
- **循环检测误判** → 不同关键词但语义相同的情况；目前是字符串精确匹配，词形变化会漏检
- **Plan-Execute 取代 ReAct 后** → `react-loop.ts` 已标记 `@deprecated`，但仍保留以支持 HITL 流程

**架构约束：**
- **三层层级关系**：Layer 1 在 S2-Pre，Layer 2/3 在 S2 Analytical 内，Layer 4 在 S2 后
- **`earlyStopContent` 是路由信号**：S2-Pre 命中早停时设置 `earlyStopContent: 'done'`，`routeAfterPreSearch` 据此跳到 S4 Formatter
- **`finishReason` 必须保留**：上游 UI 和日志依赖它做统计/展示
- **不要把硬性上限放到 system prompt**（依赖 LLM 自觉不可靠）
- **不要跳过 Layer 4**：即使到了上限也要让 LLM 走一次收尾，否则输出可能残缺
