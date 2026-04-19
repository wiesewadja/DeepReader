# 问题驱动阅读 — 技术实现方案

> 核心理念：问题不是 AI 给你出的，而是你阅读时自己冒出来的。AI 要做的是帮你记住、追踪、最终闭环。

## 一、设计哲学

### 错误做法 ❌
AI 在阅读前生成一堆问题 → 用户感觉像在考试 → 有压力 → 弃用

### 正确做法 ✅
用户在阅读中自然提问 → AI 安静记录 → 用户回头看时发现自己的思考脉络 → 主动追踪未解决的问题

**核心转变**：从"AI 出题"到"AI 帮你捕捉好奇心"。

### 三个设计原则

1. **零压力启动**：不需要任何前置操作，开书即读
2. **静默捕捉**：AI 在对话中识别用户的实质性疑问，不打断阅读流
3. **需要时才展示**：问题追踪是"看的时候有，不看的时候不在"的暗层

---

## 二、用户旅程

### 2.1 阅读中的自然流程

```
用户翻开书，开始阅读
    │
    ▼
读到某处，心里有疑问，问 AI："系统1和系统2到底有什么区别？"
    │
    ▼
AI 正常回答，同时后台判断：这是一个实质性阅读问题
    │  （用户完全无感知）
    ▼
AI 回答末尾，轻触一行小字：
    "📌 已记录为阅读问题"
    │
    ▼
几轮对话后，用户点了侧边栏的「阅读线索」按钮
    │
    ▼
看到自己积累的问题列表，自然地想继续探索未解决的
```

### 2.2 问题从哪来

| 来源 | 触发条件 | 用户感知 |
|------|---------|---------|
| **用户提问** | 用户向 AI 提出与书内容相关的实质性疑问 | 最自然，零打扰 |
| **追问标记** | 用户对 AI 回答追问"为什么？""但是…" | AI 识别追问热情 |
| **章节反思** | 读完一章后，AI 可以（非必须）问"还有什么想了解的？" | 可选功能，默认关闭 |
| **手动添加** | 用户主动在问题面板中写一个问题 | 主动行为 |

### 2.3 问题怎么闭环

```
用户提出问题 → AI 回答 → 问题标记为"探索中"
    │
    ├─ 后续对话进一步深入 → 升级为"已有理解"
    │
    ├─ 用户不再追问 → 保持"探索中"
    │
    └─ 用户说"我理解了"/"明白了" → 标记为"已消化"
```

**关键**：问题状态变化不是 AI 强制判断的，而是根据用户行为自然推演的。

---

## 三、数据模型

### 3.1 ReadingQuestion — 阅读问题

```typescript
// src/pageindex/book-types.ts 新增

export type QuestionSource = 'user-asked' | 'user-followup' | 'user-manual' | 'chapter-reflection';
export type QuestionStatus = 'exploring' | 'understood' | 'parked';

export interface ReadingQuestion {
  id: string;                    // q_{bookId}_{seq}
  question: string;              // 用户原始提问文本
  source: QuestionSource;

  // 状态
  status: QuestionStatus;

  // 上下文
  chapterScope?: string;         // 提问时正在读的章节 nodeId
  contextSnippet?: string;       // 提问时引用的原文（如果有）

  // 对话追踪
  threads: QuestionThread[];     // 关于此问题的对话片段

  // 元数据
  createdAt: string;
  updatedAt: string;
  understoodAt?: string;         // 标记为 understood 的时间
}

/** 一次围绕此问题的对话片段 */
export interface QuestionThread {
  sessionId: string;
  triggeredAt: string;           // 触发时间
  messageIds: string[];          // 参与的消息 ID 列表
  depth: number;                 // 讨论深度（几轮追问）
  outcome: 'partial' | 'resolved' | 'unresolved';
}
```

### 3.2 QuestionStore

```typescript
export interface QuestionStore {
  version: number;               // schema version, 初始 1
  bookId: string;
  bookName: string;
  questions: ReadingQuestion[];
  nextSeq: number;               // 自增序号
}
```

### 3.3 存储位置

```
.pageindex/{bookId}/
├── tree.json
├── bm25.json
├── propositions.json
├── questions.json         # 新增
└── book-meta.json
```

---

## 四、LangGraph 管线集成

### 4.1 设计策略：后置处理而非前置拦截

问题捕捉**不改变现有管线拓扑**。不增加新节点，不修改边路由。

而是在 S2（Analytical）和 S4（Formatter）的**后处理**中嵌入逻辑：

```
S0 → S1 → S2 → S4 → END
               │      │
               │      └─ S4 后处理：匹配问题、更新状态、格式化提示
               │
               └─ S2 后处理：判断本轮是否产生了新问题
```

### 4.2 State Schema 扩展

```typescript
// src/agent/graph/state.ts 新增字段

export const CognitiveEngineAnnotation = Annotation.Root({
  // ... 现有字段保持不变 ...

  // === 新增：问题追踪（可选，后置填充） ===
  detectedQuestion: Annotation<DetectedQuestion | null>(),
  matchedQuestions: Annotation<QuestionMatch[]>(),
  questionUpdates: Annotation<QuestionUpdate[]>(),
});

/** S2 检测到的用户问题（如果本轮对话包含实质性疑问） */
export interface DetectedQuestion {
  question: string;               // 用户的问题（复述/精炼后）
  chapterScope?: string;          // 相关章节
  contextSnippet?: string;        // 引用原文
  confidence: 'high' | 'medium';  // 是实质性问题的置信度
}

export interface QuestionMatch {
  questionId: string;
  relevance: 'direct' | 'tangential';
  threadOutcome: 'partial' | 'resolved';
}

export interface QuestionUpdate {
  questionId: string;
  newStatus: QuestionStatus;
  thread: QuestionThread;
}
```

### 4.3 S2 Analytical 后处理 — 问题检测

**文件**: `src/agent/graph/nodes/analytical.ts`

S2 的 ReAct 循环结束后，增加一步**轻量问题检测**（fast model）：

```typescript
// analytical.ts，ReAct 循环结束后

// 检查本轮对话是否包含用户的实质性疑问
const lastUserMessage = getLastUserMessage(state.messages);
if (lastUserMessage && state.depth >= 2) {
  const detection = await detectQuestion(
    lastUserMessage.content,
    state.analysisResult,
    fastModel
  );

  if (detection.confidence === 'high') {
    return {
      ...existingReturns,
      detectedQuestion: detection,
    };
  }
}
```

**detectQuestion 的 Prompt**：

```
判断用户的消息是否包含对这本书的实质性阅读问题。

用户消息：{userMessage}
AI 分析结果摘要：{analysisSummary}

"实质性阅读问题"的标准：
- 用户在试图理解书中的某个概念、论证或观点
- 不是闲聊、不是操作指令、不是系统命令
- 用户表现出好奇心或困惑

如果是，输出：
{ "isQuestion": true, "question": "精炼后的问题", "confidence": "high|medium" }

如果不是，输出：
{ "isQuestion": false }
```

同时，如果该书已有 open 状态的问题，检查本轮分析是否回答了它们：

```typescript
// 加载现有 open 问题
const openQuestions = await questionManager.getOpenQuestions(state.bookId);

if (openQuestions.length > 0) {
  const matches = await matchAnalysisToQuestions(
    openQuestions,
    state.analysisResult,
    fastModel
  );

  if (matches.length > 0) {
    return {
      ...existingReturns,
      matchedQuestions: matches,
    };
  }
}
```

### 4.4 S4 Formatter 后处理 — 问题持久化和提示

**文件**: `src/agent/graph/nodes/formatter.ts`

S4 是管线终点，在这里：

**a) 新问题：保存 + 轻提示**

```typescript
// 如果检测到新问题
if (state.detectedQuestion && state.detectedQuestion.confidence === 'high') {
  const question = await questionManager.addQuestion(state.bookId, {
    question: state.detectedQuestion.question,
    source: 'user-asked',
    chapterScope: state.detectedQuestion.chapterScope,
    contextSnippet: state.detectedQuestion.contextSnippet,
    threads: [{
      sessionId: currentSessionId,
      triggeredAt: new Date().toISOString(),
      messageIds: [lastUserMsgId, currentAssistantMsgId],
      depth: 1,
      outcome: 'partial',
    }],
  });

  // 在 AI 回复末尾追加一行轻提示（用户可选择关闭）
  formattedOutput += '\n\n---\n> 📌 已记录为阅读问题';
}
```

**b) 已有问题的更新**

```typescript
// 如果本轮对话匹配到了已有问题
if (state.matchedQuestions && state.matchedQuestions.length > 0) {
  for (const match of state.matchedQuestions) {
    await questionManager.updateThread(match.questionId, {
      sessionId: currentSessionId,
      messageIds: relevantMessageIds,
      outcome: match.threadOutcome,
    });

    // 如果标记为 resolved，更新状态
    if (match.threadOutcome === 'resolved') {
      await questionManager.updateStatus(match.questionId, 'understood');
    }
  }

  // 在回复中追加提示
  const resolvedCount = state.matchedQuestions.filter(m => m.threadOutcome === 'resolved').length;
  if (resolvedCount > 0) {
    formattedOutput += `\n\n---\n> ✅ 本次对话深化了对 ${resolvedCount} 个阅读问题的理解`;
  }
}
```

### 4.5 为什么不修改 Router 和 Edges

**关键设计决策**：问题追踪是"观察者"而非"参与者"。

- Router（S0）不需要知道问题追踪的存在 → 不增加路由复杂度
- Edges 不变 → 不影响现有深度分类的准确性
- 问题检测是 S2 的后处理 → 只在 analytical 阅读时触发，inspectional/casual 不触发
- 问题持久化是 S4 的后处理 → 不影响格式化逻辑

**好处**：
- 零侵入：现有管线的每个节点核心逻辑不变
- 可插拔：问题追踪功能可以独立开关，关掉后管线完全不受影响
- 渐进式：可以先实现数据层，管线集成按需开启

---

## 五、QuestionManager

### 5.1 核心类

```typescript
// src/agent/tools/question-manager.ts（新文件）

export class QuestionManager {
  private app: App;
  private cache: Map<string, QuestionStore> = new Map();  // LRU 缓存

  constructor(app: App) { this.app = app; }

  // === 写入 ===

  /** 用户对话中产生了新问题 */
  async addQuestion(bookId: string, input: {
    question: string;
    source: QuestionSource;
    chapterScope?: string;
    contextSnippet?: string;
    threads?: QuestionThread[];
  }): Promise<ReadingQuestion>;

  /** 为已有问题追加一次对话线程 */
  async appendThread(questionId: string, thread: QuestionThread): Promise<void>;

  /** 更新问题状态 */
  async updateStatus(questionId: string, status: QuestionStatus): Promise<void>;

  /** 用户手动添加问题 */
  async addManualQuestion(bookId: string, questionText: string): Promise<ReadingQuestion>;

  /** 删除问题 */
  async removeQuestion(bookId: string, questionId: string): Promise<void>;

  // === 读取 ===

  /** 获取所有 exploring 状态的问题 */
  async getOpenQuestions(bookId: string): Promise<ReadingQuestion[]>;

  /** 获取全部问题（含已解决） */
  async getAllQuestions(bookId: string): Promise<ReadingQuestion[]>;

  /** 获取问题统计 */
  async getStats(bookId: string): Promise<{
    total: number;
    exploring: number;
    understood: number;
    parked: number;
    depthAvg: number;            // 平均讨论深度
    avgThreadsPerQuestion: number;
  }>;

  // === 内部 ===

  private async load(bookId: string): Promise<QuestionStore>;
  private async save(store: QuestionStore): Promise<void>;
  private getFilePath(bookId: string): string;
}
```

### 5.2 与 ReadingProgress 联动

```typescript
// plugin-data.ts 扩展

interface ReadingProgressData {
  // ... 现有字段 ...

  questionDigest?: {
    exploring: number;
    understood: number;
    totalThreads: number;
    lastUpdated: string;
  };
}
```

---

## 六、UI 设计

### 6.1 侧边栏「阅读线索」入口

**位置**: Sidebar 顶栏的书名旁边，一个低调的图标按钮

```
┌──────────────────────────────────┐
│  思考，快与慢            [🧵]     │  ← 「阅读线索」按钮
├──────────────────────────────────┤
│  [聊天消息区域]                    │
│  ...                              │
```

**交互**：
- 图标右上角有红色小圆点 = 有新的未回顾问题
- 点击后展开问题抽屉（Drawer），从右侧滑出
- 不展开时，阅读体验完全不受影响

### 6.2 问题抽屉（Drawer）

```
┌─────────────────────────────────────────┐
│  阅读线索                    [+ 添加]    │
│                                         │
│  ─── 探索中 (3) ──────────────────────  │
│                                         │
│  🟡 认知偏差能被克服吗？                 │
│     第15章 · 2次讨论 · 最近 4/12         │
│     [继续探索]  [已理解 ✓]  [搁置]       │
│                                         │
│  🟡 直觉什么时候比推理更可靠？           │
│     第8章 · 1次讨论 · 最近 4/10          │
│     [继续探索]  [已理解 ✓]  [搁置]       │
│                                         │
│  🟡 前景理论如何解释损失厌恶？           │
│     第27章 · 刚记录                     │
│     [继续探索]  [已理解 ✓]  [搁置]       │
│                                         │
│  ─── 已理解 (4) ─────────────────────── │
│                                         │
│  ✅ 系统1和系统2分别是什么？             │
│     第1-3章 · 3次讨论 · 4/15 理解       │
│                                         │
│  ✅ 为什么人类会做出非理性决策？         │
│     第12-15章 · 2次讨论 · 4/13 理解     │
│                                         │
│  ... (折叠)                             │
│                                         │
│  ─── 统计 ──────────────────────────── │
│  7 个问题 · 4 已理解 · 3 探索中         │
│  [导出为笔记]                            │
└─────────────────────────────────────────┘
```

**交互细节**：
- 「继续探索」：将该问题文本作为用户消息发送到聊天，AI 基于已有对话上下文深入分析
- 「已理解 ✓」：用户手动标记，状态变为 understood
- 「搁置」：暂时不追踪，状态变为 parked（不再显示在"探索中"区域）
- 「+ 添加」：打开一个简单输入框，用户手动添加问题
- 「导出为笔记」：生成 Obsidian 笔记，包含所有问题和讨论记录

### 6.3 聊天中的问题提示

**新问题被记录时**，AI 回复末尾追加：

```
> 📌 已记录为阅读问题
```

- 用户可以在设置中关闭此提示
- 点击"📌"可跳转到问题抽屉

**已有问题被深化时**，AI 回复末尾追加：

```
> ✅ 深化了「认知偏差能被克服吗？」的理解
```

- 这行只在确实匹配到已有问题时才出现
- 同样可关闭

### 6.4 QuestionMinimap 增强

在现有的 minimap 中，如果某条 user 消息关联了阅读问题，在该 block 右侧加一个小圆点：

- 🟡 = exploring 的问题
- ✅ = understood 的问题

用户 hover 到圆点时，tooltip 显示问题文本。

---

## 七、实现步骤

### Phase 1: 数据层

| 步骤 | 文件 | 内容 |
|------|------|------|
| 1.1 | `src/pageindex/book-types.ts` | 新增 ReadingQuestion、QuestionStore 类型 |
| 1.2 | `src/agent/tools/question-manager.ts` | 新建 QuestionManager 类 |
| 1.3 | `src/pageindex/node.ts` | 导出新类型 |
| 1.4 | `src/agent/tools/index.ts` | 注册 QuestionManager |

### Phase 2: 管线集成

| 步骤 | 文件 | 内容 |
|------|------|------|
| 2.1 | `src/agent/graph/state.ts` | 新增 detectedQuestion、matchedQuestions 字段 |
| 2.2 | `src/agent/graph/nodes/analytical.ts` | S2 后处理：问题检测 + 已有问题匹配 |
| 2.3 | `src/agent/graph/nodes/formatter.ts` | S4 后处理：持久化 + 格式化提示 |
| 2.4 | 问题检测 prompt | detectQuestion 和 matchAnalysis 的 prompt 模板 |

### Phase 3: UI 层

| 步骤 | 文件 | 内容 |
|------|------|------|
| 3.1 | `src/components/question-drawer/` | 新建问题抽屉组件 |
| 3.2 | `src/components/question-minimap/question-minimap.ts` | 增强小圆点 |
| 3.3 | `src/views/sidebar-view.ts` | 集成阅读线索按钮和抽屉 |
| 3.4 | `src/components/message/message.ts` | 回复末尾的问题提示渲染 |

### Phase 4: 联动

| 步骤 | 文件 | 内容 |
|------|------|------|
| 4.1 | `src/agent/utils/plugin-data.ts` | ReadingProgress 增加 questionDigest |
| 4.2 | `src/agent/memory/milestones.ts` | 新增问题里程碑 |
| 4.3 | 导出为 Obsidian 笔记功能 | 生成结构化笔记 |

---

## 八、技术要点

### 8.1 问题检测的精度控制

不是每个用户消息都是"阅读问题"。过滤策略：

```
明确的阅读问题：
"系统1和系统2有什么区别？" → ✅ 检测为问题
"前景理论怎么解释损失厌恶？" → ✅ 检测为问题

不是阅读问题：
"帮我总结第三章" → ❌ 这是操作指令
"你好" → ❌ 闲聊
"这段话什么意思" → ⚠️ 低置信度，不记录

追问类：
"但这是不是因为样本偏差？" → ✅ 检测为对已有问题的追问
"我理解了" → ❌ 不记录，但可能触发已有问题状态更新
```

**置信度阈值**：只记录 `confidence === 'high'` 的问题，medium 不记录。

### 8.2 问题去重

同一本书中，用户可能用不同措辞问同一个问题。匹配策略：

1. 先用 cosine similarity 对新问题 vs 已有问题列表做语义相似度
2. 相似度 > 0.85 的，视为同一问题的追加讨论，不创建新问题
3. 相似度 0.6-0.85 的，创建新问题但标记为"可能与 Q_X 相关"
4. 相似度 < 0.6 的，创建新问题

### 8.3 性能

- 问题检测：一次 fast model 调用（~200ms），只在 depth >= 2 时触发
- 问题匹配：只在该书有 open 问题时才触发
- 问题加载：内存缓存，最多缓存 10 本书的问题列表
- Drawer 渲染：lazy load，只在用户点击按钮时才挂载 DOM

### 8.4 开关控制

在插件设置中提供：
- `[开关] 自动记录阅读问题`（默认开启）
- `[开关] 在 AI 回复中显示问题提示`（默认开启）
- `[开关] 章节结束后主动反思`（默认关闭）

---

## 九、与现有系统兼容

- `questions.json` 不存在 → 功能静默不生效，无报错，无 UI 显示
- State 新字段默认 `undefined` → S2/S4 的后处理检查 `if (detectedQuestion)` 再执行
- 关闭开关后 → 管线完全绕过问题逻辑，零性能开销
- 与 propositions 联动：问题的 `chapterScope` 可以映射到 PropositionCard，未来可扩展
