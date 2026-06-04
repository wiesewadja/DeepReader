# ADR-007: MEMORY.md + JSONL 长期记忆与会话架构

## 状态
Accepted

## 日期
2026-03（项目创始）— 2026-05 完善压缩与归档

## 背景

AI Agent 需要两类持久化数据：
1. **跨会话长期记忆**：用户画像、阅读偏好、兴趣主题（跨书、跨周、跨月）
2. **单会话历史**：当前对话的 user/assistant/tool 消息（用于 context 回放）

数据需要：
- 用户可见、可编辑（本地优先原则的体现）
- 支持跨 Obsidian 重启（持久化）
- 不能膨胀（避免 OOM 或文件超大）
- 多会话需要索引（侧边栏列出）

## 决策

采用 **用户可见的 Markdown + JSONL 追加写入** 双轨架构。

### 轨 1：长期记忆（Markdown）

**位置：** `Vault/DeepReader/MEMORY.md`

**结构：**
```markdown
# 长期记忆
## 用户画像          → 称呼、专业背景、认知水平
## 提问倾向          → 提问风格模式
## 阅读偏好          → 理论 vs 实践、精读 vs 概览
## 兴趣主题          → 感兴趣的领域
## 阅读习惯          → 常读时段、阅读节奏
```

**写入策略：**
- 通过 `save_memory` 工具由 Agent 在对话中追加段落
- LLM 触达 `MAX_MEMORY_CHARS`（8000）时自动触发 `compressMemoryWithLLM()`
- 压缩 prompt：合并重复、删除临时状态、极简表达、保留结构

**读取策略：**
- 每次新对话通过 `MemoryStore.getMemoryContext()` 注入 system prompt
- 自动剥离 frontmatter、标题、说明性前缀
- 缺失时返回空串（不报错）

**历史里程碑：** `Vault/DeepReader/HISTORY.md`（最近 30 天）+ `history/{YYYY-MM}.md`（按月归档）
- 保留 200 条上限，超出自动归档
- 归档按月份分文件，便于 Obsidian 检索

### 轨 2：会话历史（JSONL）

**位置：** `.obsidian/plugins/deepreader/sessions/{sessionId}.jsonl`

**结构：**
```jsonl
{"_type":"metadata","sessionId":"...","indexId":"...","createdAt":"...","lastConsolidated":0,...}
{"role":"user","content":"...","timestamp":"2026-06-04 14:30:00"}
{"role":"assistant","content":"...","tool_calls":[...]}
{"role":"tool","content":"...","tool_call_id":"..."}
```

**关键设计：**

| 特性 | 实现 | 原因 |
|------|------|------|
| 追加写入 | `appendMessage` 只 `read + write` 追加一行 | 避免全文件重写；O(1) 而非 O(n) |
| LRU 缓存 | 内存 Map 按 `lastAccess` 排序，超过 50 淘汰 | 频繁访问的活跃会话不重复读文件 |
| 并发锁 | `acquireLock(sessionId)` Promise 链 | 防止 consolidation 与 append 冲突 |
| 整合游标 | `lastConsolidated` 字段标记已整合位置 | 增量 consolidation 而非全量 |
| 索引文件 | `sessions/index.json` 存 SessionMeta 列表 | 侧栏列出会话无需读全文件 |
| 语音占位 | `voice/{sessionId}/{messageId}.wav` 异步落盘 | 音频生成慢，先写占位再补充 |
| 运行时剥离 | `getLLMHistory` 去除 `<system_note>` 和 `[运行时上下文]` | 防止历史污染未来对话 |

## 替代方案

### 纯数据库（SQLite / Dexie）
- 优点：索引、查询、并发原生支持
- 缺点：用户不可见、不可编辑；违反「本地优先 + 用户可控」原则
- 放弃原因：Obsidian 用户的核心理念是数据透明可访问

### 全部塞进 MEMORY.md
- 优点：单一文件、用户可见
- 缺点：会话消息会爆量；查询性能差；不能按书分会话
- 放弃原因：会话与画像是不同语义层级

### 单一文件每会话一文件（不追加）
- 优点：实现简单
- 缺点：每次 append 需重写整个文件；高频对话下 I/O 不可接受
- 放弃原因：JSONL 追加写入成本 O(1)，重写成本 O(n)

### 实时 consolidation（每条消息都整合）
- 优点：内存中始终是「干净的」历史
- 缺点：每次写入触发 LLM 调用，延迟和成本爆炸
- 放弃原因：改为「懒整合 + 游标」：只在加载时按需整合

## 后果

**收益：**
- 用户在 Obsidian 直接打开 `MEMORY.md` 即可看到/编辑 Agent 记忆（透明度）
- 会话 JSONL 追加写入，频繁对话不卡顿
- LRU 缓存使活跃会话访问为 O(1) 内存命中
- 历史归档按月分文件，Obsidian 全局搜索可用

**风险与缓解：**
- **MEMORY.md 膨胀** → `needsCompression()` 检查 + 自动触发 LLM 压缩；保留结构骨架
- **会话文件被截断/损坏** → 解析时 try/catch 单行；损坏行跳过；元数据行必须存在
- **多设备同步冲突** → 依赖 Vault 同步方案（iCloud/Git）；last-write-wins（用户编辑优先于 Agent 追加）
- **语音文件目录膨胀** → 当前未限制；未来需加清理策略

**架构约束：**
- 长期记忆与会话历史**职责严格分离**：MEMORY.md 跨会话，会话 JSONL 单会话
- 不要在会话 JSONL 中存「全局」数据
- Agent 修改 MEMORY.md 必须走 `save_memory` 工具，不要直接调 `vault.write`
