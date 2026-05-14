# SPEC: 用户画像两阶段提炼系统

## Objective

将 ProfileBuilder 的画像生成从"分批写叙述 → 合并"改为"分批抽取维度事实 → 按维度整合画像"。

**目标用户**：拥有大量笔记（数百到数千篇）的 DeepReader 用户。

**核心问题**：当前方案将 1000 篇笔记分成 100+ 批，每批独立生成叙述，最后合并。信息压缩比 ~100:1，多维信息（家庭、工作、性格等）大量丢失，且 LLM 倾向于只描述近期状态。

**验收标准**：
- 画像覆盖 7 个默认维度（身份、家庭、工作、兴趣、性格、情绪、价值观）
- 用户可在设置中添加自定义维度标签
- 增量构建只处理新文件，追加事实后重生成画像
- 1000 篇笔记在 3 分钟内完成（网络正常情况下）
- 构建过程中 UI 显示当前阶段和进度

---

## Architecture

### 文件结构

```
DeepReader/
  USER_PROFILE.md          # 最终画像（自然语言叙述，给人+LLM 看）
  .profile-summary.txt     # 精简摘要（注入 agent system prompt）
  .profile-facts.json      # 维度事实库（增量更新用）
  .profile-meta.json       # 元数据（已处理文件列表、构建时间）
```

### 维度定义

默认 7 个维度（固定，不可删除）：

| 维度 key  | 中文名     | 说明                        |
|-----------|-----------|-----------------------------|
| identity  | 身份与阶段 | 人生阶段、身份认同、发展方向 |
| family    | 家庭与关系 | 家庭成员、亲密关系、人际动态 |
| work      | 工作与事业 | 职业、项目、专业成长         |
| interests | 兴趣与投入 | 热情所在、花时间做的事       |
| personality | 性格与思维 | 思考方式、行为模式、决策风格 |
| emotions  | 情绪与状态 | 当下困扰、期待、情绪底色     |
| values    | 价值观与信念 | 相信什么、看重什么、原则   |

自定义维度：用户在设置中添加 `{ key: string, label: string }`，追加到默认 7 个之后。

### 数据流

```
scanFiles() → allFiles (TFile[])
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  buildIndex()            Stage 1: extractFacts()
  (BM25 + 向量)           (分批 LLM 调用)
  全量文件                 全量文件
        │                       │
        │                       ▼
        │              .profile-facts.json
        │              { dimensions: {
        │                  identity: ["事实1", "事实2", ...],
        │                  family: [...],
        │                  ...
        │                } }
        │                       │
        │                       ▼
        │              Stage 2: synthesizeProfile()
        │              (单次 LLM 调用，输入全部事实)
        │                       │
        │              ┌────────┴────────┐
        │              ▼                 ▼
        │      USER_PROFILE.md   .profile-summary.txt
        ▼
  search_journal 工具
  (BM25 + 向量混合检索)
```

---

## Core Features

### F1: Stage 1 — 维度事实抽取

**输入**：一批笔记文本（~6000 字符）
**输出**：按维度的结构化事实

Prompt 要点：
- 不写叙述，只提取笔记中**明确提到的**具体事实
- 每个维度列出观察到的具体事实
- 标注时间范围（从文件名或内容推断）
- 没有涉及的维度留空
- 保留原始引用（用户说的原话、比喻、顿悟）

输出格式（文本，非 JSON，降低 LLM 出错率）：

```
[时间] 2025-01 ~ 2025-03
[身份与阶段] 在XX公司做技术负责人；开始考虑创业可能性
[家庭与关系] 女儿3岁刚上幼儿园；提到和妻子周末去了公园
[工作与事业] 主导XX系统重构，对结果满意；在学 Rust
[兴趣与投入] 开始学钢琴每周练两次；重读了《百年孤独》
[性格与思维] 遇事先想透再动手；不喜欢边做边改
[情绪与状态] 对项目进度焦虑，但觉得方向对了
[价值观与信念] "做有意义的事比赚钱重要"
```

**并发**：3 路并发，每批 ~6000 字符。
**进度**：`extracting` 阶段，每批完成后更新进度。

### F2: Stage 2 — 维度整合画像

**输入**：Stage 1 所有批次的维度事实（~30K 字 ≈ 15K tokens）
**输出**：自然语言画像（500-1000 字）

Prompt 要点：
- 基于全部维度事实写一段完整描绘
- 用"你"称呼，像老朋友聊天
- 保留具体细节（原话、比喻、顿悟）
- 时间线上有明显变化的要写出
- 每个维度至少覆盖到（如果没有信息就略过）
- 不编造

**并发**：单次调用。
**进度**：`synthesizing` 阶段。

### F3: 增量构建

1. 读取 `.profile-facts.json`
2. 扫描文件，对比 `processedFiles` 找出新增/修改的文件
3. 只对新文件跑 Stage 1，将新事实**追加**到对应维度
4. 用合并后的事实重跑 Stage 2
5. 更新 meta 和 facts 文件

**强制重建**（force=true）：清空 facts，全量 Stage 1 + Stage 2。

### F4: 自定义维度

在 `DeepPDFSettings` 中添加：

```typescript
profileDimensions: { key: string; label: string }[]
// 默认空数组，用户添加的追加到 7 个内置维度之后
```

Stage 1 prompt 动态拼接维度列表。Stage 2 同理。

### F5: 画像摘要生成

复用现有的 `generateSummary`，但输入改为 Stage 2 的画像文本（而非原始笔记）。
摘要 ~500 字，注入 agent 的 system prompt。

---

## Data Structures

### .profile-facts.json

```typescript
interface ProfileFacts {
  version: 1;
  sourceDir: string;
  lastExtractTime: string;
  dimensions: Record<string, string[]>;  // key → 事实列表
}
```

### .profile-meta.json（扩展）

```typescript
interface ProfileMeta {
  sourceDir: string;
  lastBuildTime: string;
  processedFiles: Record<string, { mtime: string; size: number }>;
  indexId: string;
  fileCount: number;
  factCount: number;       // 新增：维度事实总数
  dimensionKeys: string[]; // 新增：当前使用的维度列表
}
```

### BuildProgress（扩展 stage）

```typescript
type BuildStage = 'scanning' | 'indexing' | 'extracting' | 'synthesizing' | 'summarizing' | 'done';
```

---

## Code Style

- 遵循项目现有 TypeScript 风格（tab 缩进）
- 文件路径通过 Vault API，不硬编码
- 日志使用 `utils/logger.ts` 的 `serviceLog`
- Prompt 常量定义在文件顶部，同现有风格
- 错误处理：单个 batch 失败 warn 并继续，不阻断整体构建

---

## Testing Strategy

### 单元测试

| 测试目标 | 覆盖内容 |
|---------|---------|
| `extractFactsFromBatch()` | 单批笔记 → 维度事实输出格式验证 |
| `parseFactsText()` | 文本格式的维度事实解析为 `Record<string, string[]>` |
| `mergeFacts()` | 新旧事实合并（追加 + 去重） |
| `buildDimensionPrompt()` | 默认 7 维 + 自定义维度的 prompt 拼接 |

### 集成测试

| 测试目标 | 覆盖内容 |
|---------|---------|
| 全量构建流程 | mock LLM → 验证 facts/profile/summary 文件生成 |
| 增量构建流程 | 已有 facts → 添加新文件 → 验证追加 |
| 强制重建流程 | force=true → 验证 facts 清空后重建 |

---

## Boundaries

### 始终做

- Stage 1 失败的 batch 跳过并 warn，不阻断整体
- 向量索引（buildIndex）始终处理全量文件，不受增量影响
- 画像注入 system prompt 时用 summary 而非完整画像

### 先问再做

- 修改 `DeepPDFSettings` 接口添加 `profileDimensions` 字段
- 修改 `DEFAULT_SETTINGS` 的默认值
- 改变 `.profile-meta.json` 的 schema（需要迁移）

### 永不做

- 不向用户暴露 LLM 内部的维度事实文本（只展示最终画像和摘要）
- 不在构建过程中阻塞 UI（所有操作都是 async + fire-and-forget）
- 不删除用户手动编辑的 `USER_PROFILE.md`（构建前先检查是否用户手动修改过）

---

## Implementation Order

1. **数据结构** — `ProfileFacts` 类型、`.profile-facts.json` 读写
2. **Stage 1** — `extractFactsFromBatch()` + prompt + 并发调度
3. **Stage 2** — `synthesizeProfile()` + prompt
4. **`build()` 重构** — 替换旧的 `generateProfile`/`updateProfileIncremental`
5. **增量构建** — facts 追加 + 去重
6. **设置扩展** — `profileDimensions` 字段 + 设置页 UI
7. **进度优化** — `extracting`/`synthesizing` 阶段 UI
8. **测试** — 单元 + 集成
