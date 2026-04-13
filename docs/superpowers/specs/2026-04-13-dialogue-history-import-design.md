# 对话历史导入与三层记忆架构设计

## 问题背景

### 当前问题

DeepReader 的对话历史导入机制存在断层，导致多轮对话上下文丢失：

1. **对话历史导入断层**：`SessionStore.getLLMHistory()` 只返回 `lastConsolidated` 之后的未整合消息。已整合的消息被 MemoryConsolidator 处理后，只保留了用户画像（写入 MEMORY.md），对话细节完全丢失。

2. **两套压缩机制未协同**：
   - `agent-loop.manageMessageHistory()`：硬截断（token > 20000 时触发）
   - `MemoryConsolidator`：LLM 整合（token > 15000 时触发）
   - 两者各自运行，整合后的对话无法恢复到 LLM 上下文

3. **缺失对话摘要层**：只有短期记忆（agentChatHistory）和长期记忆（MEMORY.md），缺少中间的对话摘要层。

### 目标

设计三层记忆架构，解决对话历史导入问题：
- 短期记忆：完整对话历史（SessionStore JSONL）
- 摘要记忆：对话摘要（HISTORY.md 扩展）
- 长期记忆：用户画像（MEMORY.md）

---

## 设计方案

### 1. 三层记忆架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        三层记忆架构                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Layer 1: 短期记忆                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  agentChatHistory + SessionStore (JSONL)                        │   │
│  │  - 完整对话历史，含 tool_calls                                   │   │
│  │  - 未整合消息（lastConsolidated 之后）                           │   │
│  │  - 内存缓存，易丢失                                              │   │
│  │  - 整合后丢弃！                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Layer 2: 对话摘要层（新增）                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  HISTORY.md（扩展后）                                            │   │
│  │  - 📖 阅读里程碑（原有）                                         │   │
│  │  - 💬 对话摘要条目（新增）─────────────────────────────────────│   │
│  │  - 格式: [时间] 关于《书名》讨论了X，得出结论Y                   │   │
│  │  - 🔍 可搜索（grep/关键词检索）                                  │   │
│  │  - 📏 限制条目数（最多200条，超过则归档）                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Layer 3: 长期记忆                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  MEMORY.md                                                       │   │
│  │  - 用户画像                                                      │   │
│  │  - 阅读偏好                                                      │   │
│  │  - 兴趣主题                                                      │   │
│  │  - 极简，≤100行                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. HISTORY.md 条目类型扩展

```typescript
type HistoryEntryType =
  | 'milestone'  // 📖 阅读里程碑（原有）
  | 'dialogue';  // 💬 对话摘要（新增）
// 注：`insight` 类型留待后续迭代

// 对话摘要条目结构
interface DialogueSummaryEntry {
  type: 'dialogue';
  bookName: string;        // 关联书籍
  topic: string;           // 讨论主题
  conclusion: string;      // 关键结论
  references: string[];    // 引用链接 [[书名#^blockId]]
  sessionId: string;       // 原始会话ID（可追溯）
  timestamp: string;       // 时间戳
}

// HISTORY.md 文件示例
// 阅读历程与对话摘要
// 此文件记录阅读里程碑和对话摘要（最近30天）

// [2024-01-15 14:30] 📖 开始阅读《思考，快与慢》

// [2024-01-15 14:35] 💬 关于《思考，快与慢》讨论了"系统1与系统2的区别"
// 得出结论：系统1是直觉快思考，系统2是理性慢思考。
// 引用：[[思考，快与慢#^block123]]

// [2024-01-15 15:00] 💬 继续讨论"启发式判断"
// 引用：[[思考，快与慢#^block45]], [[思考，快与慢#^block78]]
// 建议阅读第四章"认知偏见"
```

### 3. MemoryConsolidator 修改

**设计决策**：扩展现有 `SAVE_MEMORY_TOOL`，而非新建独立工具。理由：
- 与现有 `history_entry` 字段语义一致
- 避免两个工具调用的复杂性
- 统一整合流程

```typescript
// 扩展现有 SAVE_MEMORY_TOOL，添加 references 参数
const SAVE_MEMORY_TOOL = [
  {
    type: 'function',
    function: {
      name: 'save_memory',
      description: '保存记忆整合结果到持久化存储。',
      parameters: {
        type: 'object',
        properties: {
          history_entry: {
            type: 'string',
            description: '对话摘要条目。格式：关于《书名》讨论了主题，得出结论/建议。以 💬 emoji 开头区分对话摘要。如果是闲聊或无实质内容，返回空字符串。',
          },
          references: {
            type: 'array',
            items: { type: 'string' },
            description: '关键引用链接，格式：[[书名#^blockId]]。最多保留3个重要引用。',
          },
          memory_update: {
            type: 'string',
            description: '完整的更新后长期记忆（markdown格式）。包含所有现有事实和新事实。如果没有新信息则返回不变。',
          },
        },
        required: ['history_entry', 'memory_update'],
      },
    },
  },
];

// 整合 Prompt（修改版）
const CONSOLIDATION_PROMPT = `
分析这段对话，提取核心信息并调用 save_memory 工具。

## 待分析对话
${formattedMessages}

## 分析要点
1. **讨论主题**：这段对话讨论了什么？（简短概括）
2. **关键结论**：得出的结论或给出的建议是什么？
3. **引用链接**：返回了哪些 [[书名#^blockId]] 链接？（最多保留3个重要引用）
4. **用户特征**：是否有新的用户偏好/兴趣发现？如有则更新 memory_update

## 输出要求
- history_entry 格式：💬 关于《书名》讨论了主题，得出结论Y。引用：[[书名#^blockId]]
- 每轮对话生成一条摘要（精简，<100字）
- **跳过规则**：如果对话无实质内容（如纯闲聊、条目长度<20字符），history_entry 返回空字符串
- 必须调用 save_memory 工具
`;

// ConsolidationResult 类型扩展（types.ts）
interface ConsolidationResult {
  historyEntry: string;     // 对话摘要条目（以 💬 开头）
  references: string[];     // 关键引用链接（新增）
  memoryUpdate: string;     // MEMORY.md 更新内容
}
```
```

### 4. 智能加载策略

ContextBuilder 新增方法：

```typescript
// ContextBuilder 新增方法
async loadRelevantDialogueSummaries(currentBook: string): Promise<string> {
  // 1. 从 HISTORY.md 搜索包含《当前书籍》的条目
  const history = await this.memoryStore.readHistory(50);
  const bookEntries = history
    .split('\n\n---\n\n')
    .filter(entry => entry.includes(`《${currentBook}》`) || entry.includes(currentBook))
    .slice(-10);  // 最近10条

  // 2. 格式化为 system prompt 片段
  if (bookEntries.length === 0) return '';

  return `## 相关对话摘要\n\n${bookEntries.map(e => e.trim()).join('\n\n')}`;
}

// buildSystemPrompt 中调用
async buildSystemPrompt(...) {
  const parts: string[] = [];

  // Layer 1-4（原有）
  parts.push(this.buildIdentityLayer(...));
  parts.push(await this.loadBootstrapFiles());
  parts.push(await this.store.getMemoryContext());

  // 新增：加载相关对话摘要
  if (documentMetadata?.title) {
    const dialogueSummaries = await this.loadRelevantDialogueSummaries(documentMetadata.title);
    if (dialogueSummaries) {
      parts.push(dialogueSummaries);
    }
  }

  parts.push(this.buildConstraints());
  return parts.join('\n\n---\n\n');
}
```

### 5. 完整生命周期

```
用户提问
    │
    ▼
FrontendAgent.chat()
    │
    ├─► ContextBuilder.buildSystemPrompt()
    │       │
    │       ├─► loadRelevantDialogueSummaries(currentBook)  ← 智能加载相关摘要
    │       │
    │       └─► 返回: systemPrompt + 相关摘要
    │
    ├─► SessionStore.getLLMHistory(session)
    │       │
    │       └─► 返回: 未整合消息（lastConsolidated 之后）
    │
    ├─► AgentLoop.run()
    │       │
    │       └─► LLM 调用 + 工具执行
    │
    └─► 返回: updatedHistory
    │
对话完成
    │
    ├─► SessionStore.appendMessage()
    │
    └─► maybeConsolidateMemory()
            │
            ├─► 检查 token 是否超过阈值（8000）
            │
            ├─► [超过] MemoryConsolidator.maybeConsolidate()
            │       │
            │       ├─► LLM 分析对话
            │       │
            │       ├─► save_memory → HISTORY.md（对话摘要）
            │       │
            │       ├─► memory_update → MEMORY.md
            │       │
            │       └─► SessionStore.updateLastConsolidated()
            │
            └─► [未超过] 跳过
```

### 6. 文件结构

```
DeepReader/
├── MEMORY.md          # 长期记忆：用户画像（≤100行）
├── HISTORY.md         # 阅读里程碑 + 对话摘要（≤200条）
├── history/           # 归档目录（按月归档）
│   ├── 2024-01.md
│   └── 2024-02.md
└── {书名}/            # 书籍章节目录
    ├── {书名}.md
    └── 章节1.md

.obsidian/plugins/deepreader/
└── sessions/          # 会话存储（JSONL）
    ├── index.json
    ├── session-xxx.jsonl
    └── session-yyy.jsonl
```

---

## 实现要点

### 修改文件清单

1. **src/agent/memory/types.ts**
   - 扩展 `ConsolidationResult` 类型，添加 `references` 字段
   - 扩展 `ConsolidatorConfig` 类型，添加 `skipThreshold` 字段
   - 扩展 `DEFAULT_CONSOLIDATOR_CONFIG`，添加新参数默认值

2. **src/agent/memory/store.ts**
   - **不新增方法**，复用现有 `appendHistory()` 方法
   - `appendHistory()` 内部根据条目开头 emoji 自动识别类型：
     - `💬` 开头 → 对话摘要
     - `📖` 开头 → 阅读里程碑
   - 新增 `searchDialogueSummaries(bookName, limit)` 方法用于检索相关对话

3. **src/agent/memory/consolidator.ts**
   - 扩展 `SAVE_MEMORY_TOOL`，添加 `references` 参数
   - 修改 `consolidate()` 方法，处理新增字段
   - 修改整合 Prompt，添加对话摘要生成规则

4. **src/agent/context/builder.ts**
   - 新增 `loadRelevantDialogueSummaries()` 方法
   - 修改 `buildSystemPrompt()` 调用新方法

5. **src/views/sidebar-view.ts**
   - 确保 `restoreFromSessionStore()` 正确处理摘要加载（无需修改，由 ContextBuilder 处理）

### 配置参数

| 参数 | 默认值 | 说明 |
|-----|-------|-----|
| `tokenThreshold` | 8000 | 整合触发阈值（沿用现有配置） |
| `maxDialogueSummaries` | 10 | 加载到 LLM 的最大摘要数 |
| `maxHistoryEntries` | 200 | HISTORY.md 最大条目数 |
| `archiveThreshold` | 150 | 归档触发阈值：超过 150 条时自动归档到 history/ 目录 |
| `summaryMaxLength` | 100 | 每条摘要最大字数 |
| `skipThreshold` | 20 | 跳过阈值：条目长度 <20 字符视为闲聊 |

> 注：`tokenThreshold` 使用现有 `DEFAULT_CONSOLIDATOR_CONFIG.tokenThreshold = 8000`，不修改默认值。
> 归档机制：当 HISTORY.md 条目超过 `archiveThreshold` 时，调用现有 `MemoryStore.maybeArchiveHistory()` 方法自动归档。

---

## Part 2: 当前会话内历史管理 - S2 历史传入

### 问题背景

当前认知引擎中，S2 Analytical State 是真正执行检索和深度分析的状态，但它**完全不知道对话历史**：

```
状态     │ 使用历史 │ 实现                          │ 问题
───────────────────────────────────────────────────────────────
S0 Router│ ✅       │ chatHistory.slice(-10)        │ 重写有损
S1 Insp. │ ❌       │ 只用 standaloneQuery          │ 无历史
S2 Anal. │ ❌       │ 只用 standaloneQuery          │ 无历史（最严重）
S4 Form. │ ✅       │ chatHistory.slice(-10)        │ 内容太重+硬截断
```

**后果**：
- 用户问"再深入讲讲"，S2 可能重复搜索相同内容
- 用户问"那个概念和 X 有什么关系"，S2 不知道"那个概念"是哪个
- S2 无法根据历史调整搜索策略

### 设计方案

#### 1. SharedContext 数据模型扩展

```typescript
// cognitive-engine/types.ts
interface SharedContext {
  // ... 现有字段 ...
  
  // 新增：上一轮 S2 搜索的 block_ids（用于避免重复）
  prevSearchedBlockIds?: string[];
}
```

#### 2. 历史摘要化

传入 S2 的历史采用**摘要化格式**，而非原始全文：

```typescript
// 新增：cognitive-engine/utils/history-summarizer.ts
interface HistorySummary {
  topic: string;        // 讨论 topic
  conclusion: string;   // 核心结论（<100字）
  blockIds: string[];   // 引用的 block_ids
}

// 最终输出格式：
// <history>
// [第1轮] 用户问"MECE是什么"，分析发现MECE=互斥完备，引用 [[书名#^b1]]
// [第2轮] 用户问"MECE的应用"，分析发现用于商业分析框架，引用 [[书名#^b2]]
// </history>
```

#### 3. S2 Prompt 修改

```typescript
// analytical-prompt.ts
function buildAnalyticalUserMessage(
  standaloneQuery: string,
  betterQuestion?: string,
  recentHistory?: HistorySummary[],   // 新增：最近3轮摘要
  prevSearchedBlockIds?: string[]     // 新增：已搜索范围
): string {
  const historyBlock = recentHistory && recentHistory.length > 0
    ? `<history>
${recentHistory.map((h, i) => 
  `[第${i+1}轮] 用户问"${h.topic}"，分析发现${h.conclusion}`
).join('\n')}
</history>\n`
    : '';

  const prevBlock = prevSearchedBlockIds && prevSearchedBlockIds.length > 0
    ? `<prev_searched>
已搜索的段落（避免重复）：${prevSearchedBlockIds.slice(0, 10).join(', ')}
</prev_searched>\n`
    : '';

  return `${historyBlock}${prevBlock}<query>
${betterQuestion || standaloneQuery}
</query>

在限定范围内分析，提取关键内容并附带 block_id。`;
}
```

#### 4. 历史提取流程

```
continueChat(history, ...)
    │
    ├─► cleanHistory = history.filter(user | assistant)
    │
    ├─► extractRecentHistorySummaries(cleanHistory, 3)  ← 新增
    │       │
    │       └─► 从最近 3 轮 assistant 消息中提取：
    │           • topic（从对应 user 消息推断）
    │           • conclusion（assistant 前 100 字）
    │           • blockIds（正则匹配 [[书名#^blockId]]）
    │
    ├─► extractPrevBlockIds(cleanHistory)  ← 新增
    │       │
    │       └─► 从上一轮 assistant 消息提取所有 block_ids
    │
    └─► createSharedContext({
          chatHistory: cleanHistory,
          recentHistorySummaries,  ← 传给 S2
          prevSearchedBlockIds,    ← 传给 S2
        })

S2 Analytical.execute()
    │
    └─► buildAnalyticalUserMessage(
          query,
          betterQuestion,
          ctx.recentHistorySummaries,  ← 使用
          ctx.prevSearchedBlockIds     ← 使用
        )
```

### 修改文件清单

| 文件 | 修改内容 |
|-----|---------|
| `cognitive-engine/types.ts` | SharedContext 新增 `prevSearchedBlockIds`, `recentHistorySummaries` |
| `cognitive-engine/context.ts` | SharedContextImpl 新增字段初始化 |
| `cognitive-engine/prompts/analytical-prompt.ts` | `buildAnalyticalUserMessage` 新增参数和 `<history>` `<prev_searched>` 块 |
| `cognitive-engine/states/analytical.ts` | 调用时传入新参数 |
| `cognitive-engine/utils/history-summarizer.ts` | **新增**：历史摘要化函数 |
| `agent/index.ts` | `continueChat()` 增加历史摘要提取 |

### 配置参数

| 参数 | 默认值 | 说明 |
|-----|-------|-----|
| `maxHistoryForS2` | 3 | S2 传入的历史轮数 |
| `maxSummaryLength` | 100 | 每条摘要最大字数 |
| `maxPrevBlockIds` | 10 | `<prev_searched>` 显示的最大 block_id 数 |

### 验收标准（新增）

7. 用户追问时，S2 不重复搜索已检索的段落
8. 用户说"那个概念"时，S2 能从历史推断具体概念
9. `<history>` 块内容准确反映最近 3 轮讨论主题
10. 历史传入不影响 S2 的工具调用效率（不超过 800 token）

---

## 验收标准

1. 多轮对话后，已整合的对话摘要能在后续对话中恢复上下文
2. HISTORY.md 包含对话摘要条目，可通过 grep 搜索
3. 整合后的 token 数量显著降低（目标：<8000）
4. 用户切换书籍时，自动加载相关书籍的对话摘要
5. 无性能明显下降（摘要加载 <50ms）
6. **失败恢复**：consolidate() 失败时，JSONL 原始数据不丢失，下次对话可继续整合

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|-----|---------|
| LLM 整合质量不稳定 | 摘要不准确或遗漏 | 多轮验证，关键信息优先保留 |
| 摘要过长占用 token | 上下文膨胀 | 限制每条摘要 <100字，最多加载10条 |
| 搜索性能下降 | 用户体验变差 | 延迟加载，异步处理 |
| 数据一致性 | 整合失败导致数据丢失 | 保留原始 JSONL 作为备份 |