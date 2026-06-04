# ADR-006: 双模型分层架构（main + fast）

## 状态
Accepted

## 日期
2026-04（认知引擎 v0.10）

## 背景

认知引擎在 LangGraph StateGraph 中有 4 个 LLM 调用节点（S0 Router、S1 Inspectional、S2 Analytical、S4 Formatter）。不同节点对模型能力的需求差异巨大：

| 节点 | 任务 | 所需能力 | 频次 |
|------|------|----------|------|
| S0 Router | 分类 + 查询重写 | 低（结构化输出） | 每次对话 1 次 |
| S1 Inspectional | 目录分析 + 范围锁定 | 中（需要理解结构） | 每次对话 1 次 |
| S2 Analytical | 深度阅读 + 工具调用推理 | 高（复杂推理） | 每次对话 1-8 次 |
| S4 Formatter | 排版输出 + 风格化 | 中（流式生成） | 每次对话 1 次 |

如果全部用「强模型」（如 GPT-4o、DeepSeek-V3），每轮对话成本约为弱模型（如 GPT-4o-mini、DeepSeek-Chat）的 10-30 倍。S0/S1 占总调用次数的 50%，却不需要 S2 那样的推理能力。

## 决策

采用 **双模型分层** 架构：
- `main`：用于 S2 Analytical + S4 Formatter（强模型）
- `fast`：用于 S0 Router + S1 Inspectional（快/廉模型）
- 用户可独立配置两个模型的 provider、API key、baseUrl
- `fast` 未配置时回退到 `main`（向后兼容）

**配置入口：** `DeepPDFSettings.fastModelEnabled` + `fastApiKey` + `fastModel` 等字段。

**实现位置：** `src/agent/models/chat-model.ts: createChatModels(main, fast?)`。

## 替代方案

### 单一模型（全部用 main）
- 优点：配置简单，行为可预测
- 缺点：成本高 5-10 倍，对轻量任务浪费
- 放弃原因：S0/S1 占 50% 调用但只贡献 ~10% 质量提升

### 路由层动态选择（按 query 复杂度）
- 优点：更细粒度
- 缺点：复杂度高、需要先用一个模型判断「该用哪个模型」
- 放弃原因：状态机本身已按 depth 路由到不同节点，节点-模型绑定更简单

### 三层模型（main + mid + fast）
- 优点：更精细分层
- 缺点：用户配置负担重，mid 与 fast 边界模糊
- 放弃原因：实际效果差异不显著，配置成本高

## 后果

**收益：**
- 典型对话成本下降 60-70%（S0/S1 切换到 fast）
- 用户可独立选择：DeepSeek-Chat (fast) + DeepSeek-V3 (main)，平衡成本与质量
- 弱模型也能跑 S0/S1，因为这两层是结构化输出，容错性高

**风险与缓解：**
- **fast 模型能力不足** → S0 用 `withStructuredOutput(schema)` 强制 JSON 输出，失败回退到 depth=2；S1 同样结构化输出。两者都是「答案格式确定」的任务，弱模型能处理
- **行为不一致** → 两模型 prompt 相同，结构化 schema 兜底；如出现回归，关闭 `fastModelEnabled` 即可回退
- **配置复杂度** → 5 个新字段（`fastModelEnabled` / `fastApiKey` / `fastBaseUrl` / `fastModel` / `fastProviderName`），UI 集中在「双模型配置」分组

**架构约束：**
- `ChatModels` 接口是双模型唯一访问点，节点通过 `config.configurable.fastModel` / `mainModel` 注入
- 不要在 S0/S1 节点内直接调用 `mainModel`（绕过约定）
- 新增节点需明确声明属于哪一层（main 还是 fast）
