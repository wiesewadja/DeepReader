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
  | 'dialogue'   // 💬 对话摘要（新增）
  | 'insight';   // 💡 关键洞察（可选）

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

新增 `save_dialogue_summary` 工具：

```typescript
const SAVE_DIALOGUE_TOOL = [
  {
    type: 'function',
    function: {
      name: 'save_dialogue_summary',
      description: '保存对话摘要到阅读历程记录。',
      parameters: {
        type: 'object',
        properties: {
          dialogue_entry: {
            type: 'string',
            description: '对话摘要条目。格式：关于《书名》讨论了主题，得出结论/建议。',
          },
          references: {
            type: 'array',
            items: { type: 'string' },
            description: '关键引用链接，格式：[[书名#^blockId]]',
          },
          memory_update: {
            type: 'string',
            description: '用户画像更新（如有新的用户特征发现）',
          },
        },
        required: ['dialogue_entry'],
      },
    },
  },
];

// 整合 Prompt
const CONSOLIDATION_PROMPT = `
分析这段对话，提取核心信息并调用 save_dialogue_summary 工具。

## 待分析对话
${formattedMessages}

## 分析要点
1. **讨论主题**：这段对话讨论了什么？（简短概括）
2. **关键结论**：得出的结论或给出的建议是什么？
3. **引用链接**：返回了哪些 [[书名#^blockId]] 链接？（最多保留3个重要引用）
4. **用户特征**：是否有新的用户偏好/兴趣发现？如有则更新 memory_update

## 输出要求
- 每轮对话生成一条摘要（精简，<100字）
- 如果对话无实质内容（闲聊），则跳过（不生成）
- 必须调用 save_dialogue_summary 工具
`;
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
            ├─► 检查 token 是否超过阈值（15000）
            │
            ├─► [超过] MemoryConsolidator.maybeConsolidate()
            │       │
            │       ├─► LLM 分析对话
            │       │
            │       ├─► save_dialogue_summary → HISTORY.md  ← 新增！
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
   - 新增 `DialogueSummaryEntry` 类型
   - 新增 `HistoryEntryType` 类型

2. **src/agent/memory/store.ts**
   - 新增 `appendDialogueSummary()` 方法
   - 新增 `searchDialogueSummaries()` 方法

3. **src/agent/memory/consolidator.ts**
   - 新增 `SAVE_DIALOGUE_TOOL` 工具定义
   - 修改 `consolidate()` 方法，调用新工具
   - 修改整合 Prompt

4. **src/agent/context/builder.ts**
   - 新增 `loadRelevantDialogueSummaries()` 方法
   - 修改 `buildSystemPrompt()` 调用新方法

5. **src/views/sidebar-view.ts**
   - 确保 `restoreFromSessionStore()` 正确处理摘要加载（无需修改，由 ContextBuilder 处理）

### 配置参数

| 参数 | 默认值 | 说明 |
|-----|-------|-----|
| `tokenThreshold` | 15000 | 整合触发阈值 |
| `maxDialogueSummaries` | 10 | 加载到 LLM 的最大摘要数 |
| `maxHistoryEntries` | 200 | HISTORY.md 最大条目数 |
| `summaryMaxLength` | 100 | 每条摘要最大字数 |

---

## 验收标准

1. 多轮对话后，已整合的对话摘要能在后续对话中恢复上下文
2. HISTORY.md 包含对话摘要条目，可通过 grep 搜索
3. 整合后的 token 数量显著降低（目标：<8000）
4. 用户切换书籍时，自动加载相关书籍的对话摘要
5. 无性能明显下降（摘要加载 <50ms）

---

## 风险与缓解

| 风险 | 影响 | 缓解措施 |
|-----|-----|---------|
| LLM 整合质量不稳定 | 摘要不准确或遗漏 | 多轮验证，关键信息优先保留 |
| 摘要过长占用 token | 上下文膨胀 | 限制每条摘要 <100字，最多加载10条 |
| 搜索性能下降 | 用户体验变差 | 延迟加载，异步处理 |
| 数据一致性 | 整合失败导致数据丢失 | 保留原始 JSONL 作为备份 |