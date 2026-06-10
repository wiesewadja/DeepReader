# Context Manager 上下文管理器

> DeepReader Sidebar 的"已加载文档"状态层——用户通过命令 / mention / wikilink
> 把多份文档拉入对话上下文，ContextManager 维护 **path → content** 映射 + 通知变更。
>
> 配套阅读：[llm-client-and-context.md §ContextBuilder](./llm-client-and-context.md)（系统提示上下文）、
> [wiki-link-system.md](./wiki-link-system.md)（wikilink 触发提及）、
> [features/ai-dialogue.md](../features/ai-dialogue.md)（F-07~F-11 产品视角）。

---

## 目录

1. [设计意图：把"用户已打开的文档"显式化](#why)
2. [LoadedDocument 数据模型](#data-model)
3. [3 种加载方式：current / mention / wikilink](#three-sources)
4. [8 个 API 详解](#api)
5. [change 通知机制](#notify)
6. [与 SidebarView / AgentChatController 集成](#integration)
7. [关键源文件](#files)
8. [已知限制](#limitations-inference)

---

## 设计意图 (why)

DeepReader Agent 默认只看**当前激活的 Markdown 文件**——用户问"这两篇笔记有什么关系"时，AI 看不到第二篇。

**ContextManager 解决**：让用户**显式加载**多份文档到对话上下文，AI 一次性看到所有内容。

**vs ContextBuilder**：

| 维度 | ContextManager | ContextBuilder |
|---|---|---|
| 关注 | **用户主动加载**的文档 | 系统 prompt 4 层（Identity/Memory/Skills） |
## Three Sources
| 触发 | 用户命令（加载 / mention / wikilink） | 每次 LLM 调用自动 |
| 注入位置 | `getCombinedContext()` 拼到 **user message** | `buildSystemPrompt()` 拼到 **system message** |
| 共享 | 同一 Session 内的所有节点 | 全部节点 |

**两者互补**：ContextManager 给 AI **今天的议事**（具体文档），ContextBuilder 给 AI **人设 + 知识**（背景）。

---

## Data Model

**位置**：`src/services/context-manager.ts:12-25`

```typescript
interface LoadedDocument {
  path: string;        // vault 相对路径
  name: string;        // basename（显示名）
  content: string;     // 完整文件内容
  charCount: number;   // content.length
  source: 'current' | 'mention' | 'wikilink';  // 加载方式
  loadedAt: Date;      // 加载时间
}
```

**5 字段** + 1 来源枚举。

### 来源枚举

```typescript
type Source = 'current' | 'mention' | 'wikilink';
```

| 来源 | 触发场景 |
|---|---|
| `current` | Sidebar 打开时自动加载当前激活文件 |
| `mention` | 用户输入 `@` 触发文件建议器选文件 |
| `wikilink` | 聊天回答里的 `[[file]]` 被用户点击 |

**为什么区分**：UI 上**显示不同图标**——`current` 是蓝色（"自动"），`mention` 是绿色（"用户显式"），`wikilink` 是橙色（"AI 推荐"）。

---

## 3 种加载方式 (sources)

### 1. `loadCurrentDocument()` —— 当前激活

**位置**：`context-manager.ts:54-68`

```typescript
async loadCurrentDocument(): Promise<LoadedDocument | null> {
  const activeFile = this.app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice('没有打开的文档');
    return null;
  }
  if (activeFile.extension !== 'md') {
    new Notice('只支持 Markdown 文件');
    return null;
  }
  return await this.loadByPath(activeFile.path, 'current');
}
```

**调用时机**：SidebarView 打开时自动调一次（`sidebar-view.ts:682`）。

**边界**：
- 必须是 `.md` 文件（非 md 弹窗）
- 没有激活文件也弹窗
- 已加载则**直接返回**（不重新读）

### 2. `loadByPath(path, source)` —— 通用路径加载

**位置**：`context-manager.ts:76-114`

**4 步**：
1. **去重检查**：`loadedDocs.has(path)` → 已在就**直接返回**
2. **文件存在检查**：`vault.getAbstractFileByPath(path)` 是 TFile 吗？
3. **读取内容**：`vault.read(file)` 异步读
4. **加入 Map + 通知**：`loadedDocs.set(path, doc)` + `notifyChange()`

### 3. UI 触发器（mention / wikilink）

**位置**：`src/components/file-suggest/file-suggest.ts`（mention）+ `wiki-link-system.md`（wikilink）

**mention 流程**：

```
用户输入 @
  └─→ FileSuggest 显示文件建议器
        └─→ 用户选文件
              └─→ SidebarView 调 contextManager.loadByPath(path, 'mention')
```

**wikilink 流程**：

```
用户点击 chat 里的 [[file]]
  └─→ SidebarView 解析 link
        └─→ contextManager.loadByPath(path, 'wikilink')
```

---

## API

**位置**：`context-manager.ts:54-189`

### 加载（3 个）

| API | 用途 |
|---|---|
| `loadCurrentDocument()` | 加载当前激活 .md 文件 |
| `loadByPath(path, source)` | 通过路径加载（带去重） |
| (隐式) `notifyChange()` | 私有：变更通知 |

### 移除（2 个）

```typescript
removeDocument(path): void;       // 移除单个
clearAll(): void;                  // 清空所有
```

### 查询（4 个）

| API | 返回 |
|---|---|
| `getLoadedDocuments()` | `Map<path, doc>` **副本**（防外部修改） |
| `getLoadedDocumentsArray()` | `LoadedDocument[]`（数组形式） |
| `getTotalCharCount()` | 所有文档字符数总和 |
| `hasDocuments()` | `boolean`（是否非空） |
| `hasDocument(path)` | `boolean`（指定 path 是否已加载） |

### 输出（1 个）

```typescript
getCombinedContext(): string;  // 拼好的 markdown 块
```

**`getCombinedContext()` 输出格式**：

```markdown
---
文档: 第1章笔记
路径: Notes/第1章笔记.md
---
（文件内容）

---
文档: 第2章笔记
路径: Notes/第2章笔记.md
---
（文件内容）
```

**用途**：S2 Analytical 节点拼到 user message 里，让 LLM 一次性看到多份文档。

---

## Notify

**位置**：`context-manager.ts:187-189` + 构造选项 `onContextChange`

```typescript
private notifyChange(): void {
  this.onContextChange?.(this.loadedDocs);
}
```

**触发时机**：`loadByPath` / `removeDocument` / `clearAll` 后立即调。

**回调消费**：

```typescript
// sidebar-view.ts:682
this.contextManager = new ContextManager({
  app: this.app,
  onContextChange: (docs) => {
    // 更新 UI 标签栏（context-tags 组件）
    this.updateContextTags(docs);
    // 同步到 agent-chat-controller 供搜索
    this.chatController.setSearchableDocs(docs);
  },
});
```

**两路消费**：
- **UI 标签栏**（`context-tags` 组件）—— 显示已加载文档列表
- **Agent 搜索**（`chatController.setSearchableDocs`）—— 文档作为 S2 搜索源

---

## Integration

### 调用链

```
SidebarView 打开
  └─→ new ContextManager({ app, onContextChange })
        │
        ├─→ loadCurrentDocument()   ←  自动加载激活文件
        │
        ├─→ onContextChange 回调
        │     ├─→ 更新 context-tags UI
        │     └─→ 同步到 chatController
        │
        └─→ 用户在 chat input 输入 @
              └─→ FileSuggest → 用户选文件
                    └─→ contextManager.loadByPath(path, 'mention')
                          └─→ onContextChange 触发
                                └─→ tags UI 更新

用户提问
  └─→ chatController.chat(query)
        └─→ runGraphEngine
              └─→ S2 Analytical 节点
                    └─→ contextManager.getCombinedContext()
                          └─→ 拼到 user message
                                └─→ LLM 看到多份文档
```

### 注入到 S2 prompt

**位置**：`src/agent/graph/prompts/analytical-prompt.ts`（详见 [prompt-modules.md §Shared Context](./prompt-modules.md)）

```typescript
interface AnalyticalPromptContext {
  // ...其他字段
  markdownFiles?: string[];  // ← ContextManager.getLoadedDocuments() 注入
  // ...
}
```

**关键**：`markdownFiles` 字段就是 ContextManager 的内容。

---

## Files

| 文件 | 职责 |
|---|---|
| `src/services/context-manager.ts` | ContextManager 主类（191 行） |
| `src/views/sidebar/sidebar-view.ts` | SidebarView 实例化 + 绑定 onContextChange |
| `src/views/sidebar/session-manager.ts` | SessionManager 引用 ContextManager |
| `src/views/sidebar/agent-chat-controller.ts` | ChatController 通过 getContextManager 访问 |
| `src/components/context-tags/context-tags.ts` | 已加载文档标签栏 UI |
| `src/components/file-suggest/file-suggest.ts` | `@` 触发文件建议器 |
| `src/components/folder-suggest/folder-suggest.ts` | `/` 触发文件夹建议器 |
| `src/agent/graph/prompts/analytical-prompt.ts` | S2 prompt 注入 markdownFiles |
| `tests/unit/services/context-manager.test.ts` | ContextManager 单测 |

---

## Limitations [INFERENCE]

### 加载机制

- **不支持文件夹加载** —— 只能加载单文件（虽然有 `folder-suggest` 但 **不直接喂 ContextManager**）
- **不支持加载二进制文件** —— 强校验 `.md` 扩展名
- **不实现增量加载** —— 重新加载同一文件**不会刷新**（直接返回缓存的 doc）
- **不监听文件外部修改** —— 用户在 Obsidian 外部改了文件，**ContextManager 不感知**——内容已过时
- **不监听 vault 删除** —— 文件被外部删除后，`getLoadedDocuments()` 仍返回，**但 `getCombinedContext()` 输出失效路径**

### 存储

- **无持久化** —— 重启 Obsidian 后 `loadedDocs` 清零（**当前激活文件需重新 loadCurrentDocument**）
- **无大小限制** —— 用户加载 100 个文件**会塞爆 user message**，超过 LLM 上下文窗口**不预警**
- **无字符预算** —— `getTotalCharCount()` 只算总和，**不限制**也不**截断**
- **Map 内存常驻** —— 不实现 LRU 淘汰

### 输出

- **`getCombinedContext()` 简单拼接** —— 文档之间用 `\n\n` 分隔，**没有结构化标识**（如 `<document index="1">`）
- **不排序** —— Map 插入顺序，**用户不能控制"哪份文档优先"**
- **不截断** —— 超长文档**完整输出**
- **不跳过空文档** —— 空 .md 文件**也输出**（带分隔符）

### 通知

- **onContextChange 单回调** —— 不能添加多个监听者（需要包装一个 EventEmitter）
- **无防抖** —— 连续 load 多次**触发多次**回调（UI 可能闪烁）
- **回调同步执行** —— 如果 onContextChange 里有重操作（如 updateContextTags 重渲整个 UI）**会卡**

### 集成

- **与 S2 prompt 拼接不区分文档重要性** —— `markdownFiles` 数组**无权重**
- **不传给 S1 / S4** —— 只有 S2 Analytical 节点读 `markdownFiles`，**S4 formatter 看不到加载的文档**
- **S-Advisor / S-Visualizer 不读** —— 无书模式下没用
- **不传给 Profile / Search** —— 加载的文档不被 Profile 检索，**不被 searchBookV2 搜**

### 缺失

- **不支持 PDF / EPUB** —— 只能加载 .md
- **不支持二进制** —— 图片 / 附件不行
- **不支持"加载最近 N 篇"** —— 用户必须手动 mention
- **不支持自动加载相关文档** —— LLM 推荐后用户必须手动点

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/services/context-manager.ts` 191 行的架构视角文档。LoadedDocument 数据模型 + 3 加载方式 + 8 API + change 通知 + SidebarView/AgentChatController 集成 + 28 条已知限制 |
