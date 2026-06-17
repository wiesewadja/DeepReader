# 会话与记忆系统

> DeepReader 的"用户上下文"层——Session 负责**当前对话的持久化与续跑**，
> Memory 负责**长期用户画像**。LangSmith Tracer 负责**观测**所有 LangGraph 执行。
>
> 配套阅读：[system-overview.md 第 9 节 设计巧思"记忆双层"](../architecture/system-overview.md#tricks)、
> [Profile 集成](../integrations/profile.md)（用户画像的"近期事实层"——本文的 MemoryStore 是"长期"层）、
> ADR-007（记忆与会话架构决策）、[features/memory-observability.md](../features/memory-observability.md)。

---

## 目录

2. [SessionStore：JSONL 追加 + LRU 缓存 + 会话锁](#sessionstore)
3. [MemoryStore：MEMORY.md + HISTORY.md 双文件 + 归档](#memorystore)
4. [LangSmith Tracer：观测隔离 + Proxy 包裹](#langsmith-tracer)
5. [与状态机的集成 (integration)](#integration)
6. [关键源文件](#files)
7. [已知限制](#inference)

---

## 三层架构 (why)

DeepReader 的"用户上下文"分**三层**，生命周期和存储介质都不同：

| 层 | 文件位置 | 生命周期 | 内容 |
|---|---|---|---|
| **Session** | `.obsidian/plugins/deepreader/sessions/{threadId}.jsonl` | 当前会话（续跑 ≤ 30 天） | 对话消息流 + 工具调用 |
| **Memory** | `DeepReader/MEMORY.md` + `DeepReader/HISTORY.md` | 长期（手动清除为止） | 用户画像 + 阅读历程 |
| **Profile** | `DeepReader/profile/facts.jsonl` + `chapter-summaries.json` | 长期（自动累加） | 原子事实 + 章节摘要（自动提取） |

**关键边界**：

- **Session 是 LangGraph 必需**——`MemorySaver` checkpointer 依赖 `thread_id` 重建图状态
- **Memory 是用户可见**——用户可以打开 `MEMORY.md` 直接看 AI "记住了什么"
- **Profile 是 AI 提取**——LLM 自动从对话中提炼事实，**不存原文**

**互补不重叠**：

- Session 存**对话**——给 LangGraph checkpointer 用
- Memory 存**用户画像**——给 system prompt 注入用
- Profile 存**事实提取**——给个性化回答风格用

## SessionStore

**位置**：`src/agent/session/store.ts`（611 行）

### 设计特性

```typescript
/**
 * SessionStore - JSONL 文件会话存储
 *
 * 特性：
 * - 追加写入：只追加新消息，不重写整个文件
 * - 懒加载：按需加载会话，活跃会话缓存
 * - 会话锁：防止并发整合冲突
 */
```

**3 个核心特性**：

### 1. JSONL 追加（不重写）

```jsonl
{"type":"meta","threadId":"...","bookId":"...","createdAt":...}
{"type":"message","role":"user","content":"...","ts":...}
{"type":"message","role":"assistant","content":"...","toolCalls":[...],"ts":...}
```

**为什么 JSONL 而不 JSON**：

- **追加 O(1)**——只往文件末尾加一行，不用 parse 整个
- **崩溃安全**——突然断电只丢最后一条，不会损坏整个会话
- **可流式解析**——`readline` 逐行读，**支持超大会话**

### 2. LRU 内存缓存

```typescript
private cache: Map<string, { session: Session; lastAccess: number }> = new Map();
```

**按最后访问时间排序**——长时间不用的会话自动从内存淘汰，**不污染工作集**。

**典型用户场景**：
- 当前活跃 1-2 个会话（当前 + 上一轮）
- 历史 50+ 个会话存在磁盘
- 内存只保留活跃 1-2 个，**避免 OOM**

### 3. 会话锁（防并发冲突）

```typescript
private locks: Map<string, Promise<void>> = new Map();
```

**为什么需要**：LangGraph 流式输出 + 用户取消 + 同时多个 agent 共享一个 thread 时，**可能并发写同一文件**——会话锁让同一 thread 的写串行化。

**实现**：每个 threadId 对应一个 `Promise` 链——新操作 `await locks.get(threadId)`，完成后再 `set(threadId, undefined)`。

### 关键 API

| 方法 | 职责 |
|---|---|
| `createSession(threadId, meta)` | 新建会话（写 meta 行） |
| `appendMessage(threadId, message)` | 追加消息（write stream） |
| `getSession(threadId)` | 读全量会话（懒加载 + LRU 缓存） |
| `deleteSession(threadId)` | 软删（标记 archived） |
| `listSessions(filter?)` | 列会话（带筛选：bookId / 时间范围 / 关键词） |

### 持久化路径

`.obsidian/plugins/deepreader/sessions/`：
- `index.json` —— 会话索引（threadId → 元数据），**轻量**、**常常驻**
- `{threadId}.jsonl` —— 单个会话（懒加载）
- `archive/` —— 已归档会话（30 天未活动自动迁移）

---

## MemoryStore


**位置**：`src/agent/memory/store.ts`（393 行）+ `consolidator.ts`（391 行）

### 双文件设计

```
DeepReader/
├── MEMORY.md          ← 长期记忆（用户画像 + 偏好），AI 主动维护
├── HISTORY.md         ← 阅读历程（里程碑日志，最近 30 天）
└── history/           ← 归档（按月归档的 HISTORY 快照）
    ├── 2025-12.md
    ├── 2026-01.md
    └── ...
```

**`MEMORY.md` 示例**（用户可见）：

```markdown
# 奚童用户画像

## 偏好
- 偏好简洁回答（5 句话以内）
- 不喜欢 Markdown 表格（"用列表"）

## 阅读习惯
- 平均章节阅读时长：~12 分钟
- 高亮频率：高（每章 8-12 处）

## 当前关注
- 《存在与时间》第 3 节"此在"的展开逻辑
```

**`HISTORY.md` 示例**：

```markdown
# 2026-06-10

- 14:30 完成《纳瓦尔宝典》索引
- 15:42 提问：杠杆 vs 复利
- 16:15 主动引导触发（章节切换 + 8 高亮）
```

### 三道闸门

| 闸门 | 阈值 | 说明 |
|---|---|---|
| `MAX_MEMORY_CHARS` | 8000 | MEMORY.md 单文件上限 |
| `HISTORY_RETENTION_DAYS` | 30 | HISTORY 主文件保留天数 |
| `MAX_HISTORY_ENTRIES` | 200 | HISTORY 单文件最大条数 |

**触发条件**（`consolidator.ts`）：
- 用户主动命令"整理记忆" / "压缩历史"
- 阈值触顶 → 自动调用 `consolidate()`

### Consolidator 算法

**位置**：`src/agent/memory/consolidator.ts:391`

1. **读取 MEMORY.md** 当前内容
2. **读取最近 5 个历史归档**
3. **调 LLM** 总结：哪些信息应该进 MEMORY.md（提炼 / 去重 / 合并）
4. **原子写**：先写 `MEMORY.md.tmp` → 校验 → 替换原文件（避免半写状态）

### 关键设计

- **不存原文对话**——只存"提炼后"的事实（**隐私**）
- **append-only 历史**——追加式写入，崩溃安全
- **按月归档**——避免单文件无限增长
- **AI 主动维护**——不依赖用户手动操作

---

## LangSmith Tracer


**位置**：`src/agent/tracing/langsmith.ts`（98 行）+ `noop-tracer.ts`（57 行）

### 双重设计

```typescript
// 主入口
function getLangSmithTracer(config?: LangSmithConfig): LangChainTracer | null {
  if (!config?.apiKey) return null;  // 配置缺失 → null（不创建）
  // ... 创建并缓存
}
```

**两种状态**：

| 状态 | 触发 | 行为 |
|---|---|---|
| **Active** | `settings.langsmithEnabled = true` + API Key 配齐 | 创建 `LangChainTracer` + 上传 trace |
| **Noop** | 配置缺失 | 注入 `noop-tracer`（空操作） |

**优雅降级**——配置不全**不抛错**，让 LangGraph 正常运行。

### Proxy 包裹（关键设计）

```typescript
function safeWrap(tracer: LangChainTracer): LangChainTracer {
  return new Proxy(tracer, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value === 'function') {
        return (...args) => {
          try { return value.apply(target, args); }
          catch (err) { log('[LangSmith] Silent error:', err); }
        };
      }
      return value;
    },
  });
}
```

**为什么**：

- LangSmith 不可达时**网络超时**会抛错
- 不包裹的话**整个 LangGraph 流卡死**（`tracer` 在 callbacks 里）
- 包裹后**任何错误被吞**——对话继续，trace 静默丢失

**设计原则**：**观测层失败 ≠ 主流程失败**。

### Noop Tracer

```typescript
// src/agent/tracing/noop-tracer.ts
class NoopTracer {
  // 所有方法空实现
  handleLLMStart() {}
  handleLLMEnd() {}
  handleChainStart() {}
  // ... 30+ 方法都是空
}
```

**为什么不用 null**——LangGraph 的 callback 接口要求 `BaseTracer` 实例，**null 会 type error**。NoopTracer 满足类型契约但什么都不做。

### 配置切换

```typescript
// 用户改设置时调用
function resetLangSmithTracer(): void {
  cachedTracer = null;
  cachedConfig = '';
}
```

**缓存失效**——下次 `getLangSmithTracer()` 用新 config 重建。

---

## 与状态机的集成 (integration)

**位置**：`src/agent/index.ts: buildGraphConfigurable()`

```typescript
{
  configurable: {
    thread_id,            // → SessionStore.appendMessage 关联
    _langsmithTracer,     // → callbacks（state machine 流式回调时挂上）
    // ... 其他 LLM / context
  }
}
```

**三个层的关系**：

```
用户问问题
  └─→ FrontendAgent.runGraphEngine
        ├─ thread_id = "thread-{bookId}-{ts}"
        │     └─→ SessionStore.appendMessage(threadId, msg)  ← 会话持久化
        │
        ├─ _langsmithTracer = getLangSmithTracer(settings)
        │     └─→ callbacks 到 LangGraph stream  ← 观测
        │
        └─ sharedContext = { memory, profile, history, ... }
              ├─ MemoryStore.load() → "MEMORY.md 内容"  ← 长期记忆
              ├─ ProfileBuilder.search() → top-3 summary  ← 近期事实
              └─ SessionStore.getSession() → 历史消息摘要  ← 当前会话
```

**注意**——**MemoryStore 不在 LangGraph state 里**（太重），而是通过 `sharedContext` 在每个节点**按需加载**。

---

## 关键源文件 (files)

| 文件 | 职责 |
|---|---|
| `src/agent/session/store.ts` | SessionStore 主类（611 行，JSONL + LRU + 锁） |
| `src/agent/session/types.ts` | Session / SessionMeta / SessionMessageLine 类型 |
| `src/agent/session/index.ts` | 公开 API 入口 |
| `src/agent/memory/store.ts` | MemoryStore 主类（393 行，MEMORY.md + HISTORY.md） |
| `src/agent/memory/consolidator.ts` | 整合算法（391 行，AI 主动压缩） |
| `src/agent/memory/types.ts` | MemoryEntry / HistoryEntry 类型 |
| `src/agent/memory/index.ts` | 公开 API 入口 |
| `src/agent/tracing/langsmith.ts` | LangSmith Tracer 创建 + Proxy 包裹（98 行） |
| `src/agent/tracing/noop-tracer.ts` | 空操作 Tracer（57 行） |
| `src/agent/tracing/types.ts` | TracerConfig 类型 |
| `src/agent/tracing/index.ts` | 公开 API 入口 |
| `src/config/agent-constants.ts` | `MAX_MEMORY_CHARS` / `HISTORY_RETENTION_DAYS` 等常量 |
| `tests/unit/agent/session/store.test.ts` | SessionStore 单测（JSONL + 锁） |
| `tests/unit/agent/memory/store.test.ts` | MemoryStore 单测（双文件 + 归档） |
| `tests/unit/agent/memory/consolidator.test.ts` | Consolidator 算法单测 |

---

## 已知限制 [INFERENCE]

### Session

- **不支持消息编辑**——一旦追加不能改（避免破坏 append-only 语义）
- **不支持跨设备同步**——JSONL 是本地文件，**不通过云同步**
- **不实现 token-aware 截断**——超长会话仍会塞满 context window（需 LangGraph `compressMessagesForLLM`）
- **会话锁是进程内**——多窗口 Obsidian 打开同一 vault，**锁无效**

### Memory

- **不存储反向关联**——`MEMORY.md` 不记录"这条信息来自哪本书"
- **不跨用户**——MEMORY 与 vault 绑定，**换 vault 等于丢 Memory**
- **不实现 forget API**——用户不能"删除某条记忆"
- **consolidator 失败不重试**——LLM 提取失败时静默跳过

### Tracer

- **不支持自定义 endpoint**——只支持 LangSmith 官方 / 自托管 URL，**没有 OTLP 协议**
- **不缓冲 trace**——网络抖动时**直接丢弃**
- **不区分开发 / 生产**——所有 trace 都上传，**生产环境可能浪费 token**

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/agent/session/*` 731 行 + `src/agent/memory/*` 892 行 + `src/agent/tracing/*` 247 行的架构视角文档。3 层（Session/Memory/Profile）边界 + 4 个源文件机制 + 3 个文件已知限制 |
