# 阅读引用功能优化（从 UI 到奚童回复）

## Context

用户阅读时选中文字 → 触发悬浮工具栏 → 点"引用" → 输入问题 → 发送给奚童 → 奚童回答。**当前整条链路存在 6 处断裂**：

1. **`blockId` 采集不可靠**：`selection-toolbar.ts:findBlockIdInRange()`（私有方法）只靠 DOM `^xxx` 文本匹配；阅读模式下 `^xxx` 已被 Obsidian 渲染器剥离 → 大多数情况拿不到 `blockId`
   - 已有更可靠的 `findBlockIdFromRange()`（`src/utils/block-utils.ts:18`），但 SelectionToolbar 没用
2. **关键数据被丢弃**：`agent-chat-controller.ts:382-387` 把 quotes 拼成 markdown 字符串塞进 user message，**`blockId` / `nodeId` / `sourcePath` 全部丢失**
3. **LLM 收到的是模糊文本**：没有结构化信号让 LLM 知道"这是用户主动引用的章节，block_id 是 X"；LLM 只能用 prompt 提示"用户引用了"猜测
4. **引用卡片可读性差**：`quote-manager.ts:69` 把文本截断到 20 字符（`quote.text.substring(0, 20) + '...'`），用户自己看不清引了什么、来源是哪
5. **回复无视觉锚定**：AI 回复中没有"📌 正在回应你引用的第 N 段"徽标；用户切换对话时不知道"这条回复是为哪段引用生成的"
6. **`ToolContext.quotes` 字段是死代码**：`src/agent/tools/types.ts:26` 定义了但 `search_book` / `read_book_section` 等工具**完全没用**它 → 即使 `nodeId` 传到了后端，搜索时也不会自动偏向引用所在的章节

**目标**：让"引用"成为一条**结构化、可追溯、双向跳转、Agent 真能利用**的上下文。

**附加（用户反馈）**：对话恢复时引用数据的 UI 设计。当前 `SessionMessageLine`（`src/agent/session/types.ts:46`）只存 `role + content + tool_calls` 等 LLM 字段，**没有** `quotes` 或 `citedQuoteIds`。这意味着用户重启 Obsidian 后，引用卡片、AI 回应徽标全部丢失。需要在 PR 1 把这个能力补上。

---

## 实施后数据流（目标态）

```
[阅读模式] SelectionToolbar.onQuote(metadata)
   ├─ 用 findBlockIdFromRange() 准确取 blockId
   ├─ 解析 frontmatter 取 nodeId + section
   └─ 记录 Range 用于回跳
   ↓
[Sidebar] QuoteManager → 渲染可展开卡片
   ├─ 60 字符摘要 + 完整章节路径
   ├─ 🔗 跳转按钮 → 复用 reading-mode-service.jumpToBlockId + 黄色 2s 闪烁动画
   └─ 🗑 移除 / 全部清除按钮
   ↓
[User 发送] sendMessage(text, quotes) — QuoteItem 字段全量透传
   ↓
[Controller] agent-chat-controller.ts
   ├─ ToolContext.quotes = quotes（结构化）
   └─ userMessage 拼接 markdown 引用块（用户可见）
   ↓
[ContextBuilder.buildSystemPrompt] 注入 <user_cited_quotes> 块
   ├─ 每条 quote: text + source + nodeId + blockId + headingPath
   └─ 显式指令："你正在回应用户主动引用的内容，回复中必须出现 [[书名#^X|短别名]] 回链"
   ↓
[Router/Analytical] extractCitedNodeIds 扩展
   ├─ 原: 扫描 [[wiki]] 和 block-quote
   └─ 新增: 合并 context.quotes[].nodeId
   ↓
[search_book / read_book_section] 自动 scope
   └─ quoted nodeId 注入 scope_node_ids（无须 LLM 推理）
   ↓
[回复] AI Message
   ├─ 顶部显示 "📌 回应引用 #1, #2" 徽标（可点击滚动到对应 user quote）
   ├─ 内部 wiki 链接指向 [[书名#^真实blockId|...]]（LLM 被强制生成）
   └─ hover 引用块显示完整原文
```

---

## 涉及的关键文件

| # | 阶段 | 文件 | 关键改动 |
|---|------|------|----------|
| 1 | 类型强化 | `src/components/chat-input/chat-input.ts` | `QuoteItem` 字段补全，新增 `?` 可选字段注释 |
| 2 | 准确采集 | `src/components/reading-mode/selection-toolbar.ts` | 用 `findBlockIdFromRange` 替换私有 `findBlockIdInRange` |
| 3 | 二级引用 | `src/components/excerpt/selection-menu.ts` | 在 AI 回复中也能取 blockId（从渲染 DOM） |
| 4 | 卡片优化 | `src/views/sidebar/quote-manager.ts` | 不截断 / 加跳转 / 加章节 / 加"全部清除" |
| 5 | 卡片样式 | `src/components/reading-mode/reading-mode.css` 或新建 `quote-card.css` | 卡片新样式 + 黄色闪烁 2s 动画 |
| 6 | 服务暴露 | `src/services/reading-mode-service.ts` | 把 `jumpToBlockId` 公开为 public `jumpToBlock(blockId, filePath?)` |
| 7 | 数据透传 | `src/views/sidebar/agent-chat-controller.ts:382-387` | 保留 markdown 块 + 同时赋值 `context.quotes` |
| 8 | 工具利用 | `src/agent/tools/local/search-text.ts` | 若 `context.quotes[].nodeId` 存在，合并到 `scope_node_ids` |
| 9 | 工具利用 | `src/agent/tools/local/read-section.ts` | 同上：quoted nodeId 优先 |
| 10 | 路由扩展 | `src/agent/graph/utils/chapter-reference-parser.ts` | `extractCitedNodeIds` 新增 `quotedNodeIds` 参数 |
| 11 | 路由调用 | `src/agent/graph/nodes/analytical.ts` + `analytical-pre-search.ts` | 从 `context.quotes` 收集 nodeId 传给 `extractCitedNodeIds` |
| 12 | 系统提示 | `src/agent/graph/prompts/inspectional-prompt.ts` | `<user_cited_quotes>` 块 + 必带回链硬指令 |
| 13 | 系统提示 | `src/agent/graph/prompts/analytical-prompt.ts` | 同样注入 + 必带回链 |
| 14 | 回复徽标 | `src/components/message/message.ts` | AI 消息显示 "📌 回应引用 #N" 徽标 |
| 15 | 关联跳转 | `src/components/message/message.ts` | 点击徽标滚到对应 user quote 卡片 |
| 16 | 工具类型 | `src/agent/tools/types.ts` | `ToolContext.quotes` 加注释"已用于 search/read scope" |
| 17 | 单元测试 | `tests/unit/...` | 新增 3 个测试文件 |
| 18 | E2E | `tests/e2e/specs/citation-flow.e2e.ts` | 新增端到端引用流程测试 |

---

## 实施步骤

### Phase 1: 基础设施（打地基）

**Step 1.0: 对话恢复时引用数据持久化**

涉及：
- `src/agent/session/types.ts:46` `SessionMessageLine` 接口新增 `quotes?: QuoteItem[]`（user 消息）和 `citedQuoteIds?: string[]`（assistant 消息）
- `src/views/sidebar/session-manager.ts` `saveToCache()` 写入时携带这两个字段（来自 `MessageData`）
- `src/views/sidebar/session-manager.ts` `restoreFromSessionStore()` 读取后写入 `msgData`
- `src/components/message/types.ts:55` 同步扩展 `quotes` 字段类型为完整 `QuoteItem[]`，新增 `citedQuoteIds?: string[]`
- **UI 降级策略**：
  - 恢复的引用卡片渲染为**只读、不可移除**的折叠态（区别于"当前活动态"的高亮+可移除）
  - 恢复的 AI 消息渲染 "📌 回应引用" 徽标但点击不跳（因为 DOM 卡片可能不存在）— 改为 hover 显示引用摘要
  - "跳转原文"按钮恢复后**仍可用**：因为 `blockId` 持久化在 JSONL 中，`reading-mode-service.jumpToBlock()` 仍能定位

**Step 1.1: 强化 `QuoteItem` 类型**

文件：`src/components/chat-input/chat-input.ts:35-44`

```typescript
export interface QuoteItem {
  id: string;
  text: string;
  source?: string;             // 书籍显示名（不含路径）
  sourcePath?: string;         // 完整 Vault 路径（用于跳转）
  blockId?: string;            // ^xxx 去掉 ^ 的形式
  nodeId?: string;             // PageIndex 章节 node_id（4 位数字符串）
  heading?: string;            // 直接所属标题
  headingPath?: string[];      // 完整路径
  page?: number;               // PDF 页码
  messageId?: string;          // 二级引用：来自哪条 AI 回复
  range?: Range;               // DOM Range（仅内存，不序列化）
}
```

**Step 1.2: 透传 `ToolContext.quotes`**

文件：`src/views/sidebar/agent-chat-controller.ts:382-387`

把现有 markdown 拼接**保留**（用户可见），但**同时**确保 `ToolContext.quotes = quotes` 已经设了（line 357 已设，只需补注释）。同时新增结构化 block：

```typescript
if (quotes && quotes.length > 0) {
  const quotesText = quotes.map(q => {
    const location = q.headingPath?.join(' > ') || q.heading || q.source || '引用';
    return `> ${q.text}\n> — ${location}`;
  }).join('\n\n');
  userMessage = `${userMessage}\n\n---\n**用户引用了以下内容，请重点关注并基于引用内容回答：**\n${quotesText}`;

  // 新增：结构化引用上下文（让 LLM 知道 block_id/nodeId）
  const citedContext = quotes.map((q, i) => {
    const parts = [`[${i + 1}] ${q.text}`];
    if (q.headingPath?.length) parts.push(`位置: ${q.headingPath.join(' > ')}`);
    if (q.nodeId) parts.push(`node_id: ${q.nodeId}`);
    if (q.blockId) parts.push(`block_id: ^${q.blockId}`);
    if (q.sourcePath) parts.push(`文件: ${q.sourcePath}`);
    return parts.join(' | ');
  }).join('\n');
  userMessage = `${userMessage}\n\n<user_cited_quotes>\n${citedContext}\n</user_cited_quotes>\n\n⚠️ 你必须基于上述引用内容回答，并在回复中插入 wiki 链接 [[书名#^blockId|短别名]] 回引每条引用。`;
}
```

### Phase 2: 准确采集 blockId

**Step 2.1: 替换 SelectionToolbar 的私有 `findBlockIdInRange`**

文件：`src/components/reading-mode/selection-toolbar.ts:283-323`

- 导入：`import { findBlockIdFromRange } from '../../utils/block-utils.js';`
- 删除私有 `findBlockIdInRange` / `extractBlockIdFromElement`
- 在 `extractQuoteMetadata()` 中调用 `findBlockIdFromRange(this.savedRange, activeFile.path, this.app)`
- 添加 fallback：若拿不到 `blockId`，尝试 `getActiveFile().path` 的 `metadataCache.blocks` 找最近的

**Step 2.2: 二级引用（AI 回复中选区）也能取 blockId**

文件：`src/components/excerpt/selection-menu.ts:128-141`

当前 `handleQuote()` 只填了 `text` + `source`。改造：

```typescript
private handleQuote(): void {
  // 尝试从选中范围的 DOM 中提取 ^blockId（AI 回复中如果 LLM 输出了 [[...#^xxx]]，DOM 里会有 id="^xxx"）
  const blockId = this.extractBlockIdFromSelection();
  const metadata: QuoteMetadata = {
    text: this.options.selectedText,
    source: this.options.sourcePdf,
    messageId: this.options.messageId,  // 保留二级引用的来源消息
    blockId,
  };
  this.options.onQuote(metadata);
  this.hide();
}

private extractBlockIdFromSelection(): string | undefined {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);

  // 在选区祖先链上找 id="^xxx" 的元素（Obsidian 渲染 wiki 链接为 <a id="^xxx">）
  let node: Node | null = range.startContainer;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      // 1. 自身 id
      if (node.id?.startsWith('^')) return node.id.slice(1);
      // 2. 子元素中最近一个 [id^="^"]
      const sub = node.querySelector('[id^="^"]');
      if (sub?.id) return sub.id.slice(1);
    }
    node = node.parentNode;
  }
  return undefined;
}
```

### Phase 3: 引用卡片优化

**Step 3.1: 卡片不截断 / 显示章节 / 跳转**

文件：`src/views/sidebar/quote-manager.ts`

- 删除 `displayText = quote.text.substring(0, 20) + '...'`
- 改为：`const displayText = quote.text.length > 60 ? quote.text.substring(0, 60) + '…' : quote.text;`
- 新增章节行（headingPath 或 source）
- 新增跳转按钮（带图标 `<svg arrow-right>`），点击后调用 `host.jumpToQuote(quote)`（host 注入）
- 新增"全部清除"按钮（≥2 条引用时显示）

**Step 3.2: 卡片新样式 + 黄色 2s 闪烁动画**

文件：新建 `src/components/quote-card.css`（或追加到 `main.css`）

```css
.deeppdf-quote-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  background: var(--background-secondary);
  border-left: 3px solid var(--interactive-accent);
  border-radius: 4px;
  margin: 4px 0;
  cursor: pointer;
  transition: background 0.15s;
}
.deeppdf-quote-card:hover {
  background: var(--background-modifier-hover);
}
.deeppdf-quote-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.4;
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.deeppdf-quote-source {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
.deeppdf-quote-jump-btn,
.deeppdf-quote-remove-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
}
.deeppdf-quote-jump-btn:hover { color: var(--interactive-accent); }
.deeppdf-quote-remove-btn:hover { color: var(--text-error); }

/* 黄色闪烁动画（2s） */
@keyframes deeppdf-quote-flash {
  0%, 100% { background-color: var(--background-secondary); }
  10%, 30% { background-color: rgba(255, 235, 59, 0.6); }
}
.deeppdf-quote-card.deeppdf-quote-flash {
  animation: deeppdf-quote-flash 2s ease-out;
}
```

**Step 3.3: 跳转服务 + 黄色闪烁阅读区**

文件：`src/services/reading-mode-service.ts`

- 把 `jumpToBlockId` 改名为 public `jumpToBlock(blockId: string)` 并加 `flashHighlight(targetEl)` 方法：
  ```typescript
  public jumpToBlock(blockId: string): void {
    const scrollView = document.querySelector('.deeppdf-reading-mode .markdown-preview-view') as HTMLElement;
    const target = scrollView?.querySelector(`[id="${blockId}"]`) as HTMLElement;
    if (!target) return;
    this.scrollToElementInColumn(target, scrollView);
    target.classList.add('deeppdf-reading-block-flash');
    setTimeout(() => target.classList.remove('deeppdf-reading-block-flash'), 2000);
  }
  ```
- CSS（在 `reading-mode.css`）：
  ```css
  @keyframes deeppdf-block-flash {
    0%, 100% { background-color: transparent; }
    10%, 30% { background-color: rgba(255, 235, 59, 0.5); }
  }
  .deeppdf-reading-block-flash {
    animation: deeppdf-block-flash 2s ease-out;
    border-radius: 3px;
  }
  ```

**Step 3.4: Sidebar 注入 jumpToQuote 回调**

文件：`src/views/sidebar/sidebar-view.ts:175` 附近

`QuoteManager` 的 `host` 接口新增方法 `jumpToQuote(quote: QuoteItem): void`，sidebar-view 实现它：找到 `this.readingModeService.jumpToBlock(quote.blockId)`。

### Phase 4: Agent 感知

**Step 4.1: extractCitedNodeIds 扩展**

文件：`src/agent/graph/utils/chapter-reference-parser.ts:65`

```typescript
export function extractCitedNodeIds(
  messages: string | string[],
  quotedNodeIds?: string[]  // 新增：从 ToolContext.quotes[].nodeId 传入
): string[] {
  const textCited = extractFromText(messages);  // 内部提取
  const collected = new Set<string>([...textCited, ...(quotedNodeIds || [])]);
  return Array.from(collected);
}
```

**Step 4.2: 路由节点调用扩展**

文件：`src/agent/graph/nodes/analytical-pre-search.ts:152` + `analytical.ts:60`

```typescript
// 收集 ToolContext.quotes 里的 nodeId
const quotedNodeIds = (context.quotes || [])
  .map(q => q.nodeId)
  .filter((id): id is string => !!id);
const citedFromMessages = extractCitedNodeIds(userMsg, quotedNodeIds);
```

**Step 4.3: System Prompt 注入（与 Step 1.2 重复则合并）**

文件：`src/agent/graph/prompts/inspectional-prompt.ts:88` 附近

在 `<user_cited_chapters>` 之后新增：

```typescript
const userCitedQuotesBlock = citedQuotes && citedQuotes.length > 0
  ? `\n<user_cited_quotes>
用户在消息中显式引用了以下内容（这是用户的强信号，权重高于 LLM 推断）：

${citedQuotes.map((q, i) => `[${i + 1}] ${q.text}
位置: ${q.headingPath?.join(' > ') || q.heading || '未知'}
node_id: ${q.nodeId || '?'}
block_id: ${q.blockId ? '^' + q.blockId : '?'}
来源文件: ${q.sourcePath || q.source || '?'}`).join('\n\n')}

⚠️ 硬性要求：
1. 这些引用的章节必须出现在 scopeNodeIds 中
2. 回答中必须出现对应 wiki 链接：[[书名#^blockId|2-6 字短别名]]
3. 链接必须嵌入句中作主语/宾语/修饰语，不要堆砌在句末
</user_cited_quotes>`
  : '';
```

`buildInspectionalSystemPrompt` 增加 `citedQuotes?: QuoteItem[]` 参数；调用方从 `context.quotes` 透传。

**Step 4.4: 工具利用 quoted nodeId**

文件：`src/agent/tools/local/search-text.ts:200`

```typescript
const quotedNodeIds = (context.quotes || [])
  .map(q => q.nodeId).filter(Boolean);
const userScopeNodeIds = args.scope_node_ids as string[] | undefined;
const mergedScope = userScopeNodeIds
  ? Array.from(new Set([...userScopeNodeIds, ...quotedNodeIds]))
  : (quotedNodeIds.length > 0 ? quotedNodeIds : undefined);
```

同样修改 `read-section.ts`。

### Phase 5: 回复可视化

**Step 5.1: AI 消息显示"📌 回应引用 #N"徽标**

文件：`src/components/message/message.ts:222-228` (AIMessage render)

- 在气泡顶部（action 按钮上方）加一行：
  ```html
  <div class="deeppdf-ai-cites">
    📌 正在回应你引用的：<span class="cite-tag">第 1 段</span><span class="cite-tag">第 3 段</span>
  </div>
  ```
- 渲染逻辑：`this.data.citedQuoteIds`（来自 controller 注入）→ 找出对应 user message 的 quotes，渲染徽标

**Step 5.2: 徽标点击跳到对应 user quote 卡片**

```typescript
const tag = this.el?.querySelector(`.cite-tag[data-quote-id="${quoteId}"]`);
tag?.addEventListener('click', () => {
  const card = document.querySelector(`.deeppdf-quote-card[data-quote-id="${quoteId}"]`);
  card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card?.classList.add('deeppdf-quote-flash');
  setTimeout(() => card?.classList.remove('deeppdf-quote-flash'), 2000);
});
```

**Step 5.3: Controller 关联 user quote ↔ AI message**

文件：`src/views/sidebar/agent-chat-controller.ts:225-280`

在 `addMessage(userMessageData)` 之前，把 `userQuoteIds` 字段加进 aiMessageData（标记该条 AI 是为哪些 user quote 生成的）。完成后 `addMessage(aiMessageData)` 时带上 `citedQuoteIds: quotes?.map(q => q.id)`。

### Phase 6: 测试

**Step 6.1: 单元测试**

- `tests/unit/components/quote-manager.test.ts` — 卡片渲染、跳转回调、全部清除
- `tests/unit/agent/graph/chapter-reference-parser.test.ts` — 扩展 `extractCitedNodeIds` 接收 `quotedNodeIds`
- `tests/unit/agent/tools/local/search-text.test.ts` — quoted nodeId 自动注入 scope

**Step 6.2: E2E 测试**

`tests/e2e/specs/citation-flow.e2e.ts`：

1. 打开 `DeepReader/某书/某章.md`
2. 选中段落
3. 验证 3 按钮工具栏出现
4. 点引用
5. 验证输入区上方出现引用卡片（文本完整 ≥60 字）
6. 输入"这段在论证什么？"
7. 点发送
8. 等待 AI 回复完成
9. 验证 AI 回复包含 `[[书名#^xxx|...]]` 链接
10. 验证 AI 消息顶部有"📌 回应引用"徽标
11. 点击引用卡片跳转按钮
12. 验证阅读区滚到对应位置 + 黄色闪烁 2s

---

## 验证清单

- [x] 单元：`npm run test:run` 全绿（**1042 passed**，含新增 4 个测试文件）
- [x] 类型：`npx tsc --noEmit --skipLibCheck` 零错误
- [x] 构建：`npm run build` 成功（main.js 5.8MB, styles.css 212KB）
- [x] PR 1 review 缺陷修复：C1/C2/C3 + I1/I2/I3/I4/I5 + S1/S2 全部修复
- [x] 兼容性：旧对话缓存（不含 `citedQuoteIds`）—— `quotes-roundtrip.test.ts` 验证
- [ ] E2E：完整引用流程跑通（需要真实 Obsidian 环境）
- [ ] 跨书场景：在 A 书引用 → 切到 B 书 → AI 仍能基于 A 书引用回答

---

## PR 1 Review 修复记录

| 编号 | 严重度 | 问题 | 修复 |
|------|--------|------|------|
| C1 | Critical | `restoreQuotes()` 定义了但 0 个 caller | `SessionManagerHost.quoteManager` getter + `restoreFromSessionStore()` 末尾调用 |
| C2 | Critical | `range` 死字段（YAGNI + JSON.stringify 风险） | 从 QuoteItem/QuoteMetadata/selection-toolbar 全删 |
| C3 | Critical | `console.warn` 漏网 | → `log.warn` |
| C4 | Critical | `JSON.stringify` 潜在崩溃 | 随 C2 自动修复（无 Range 字段） |
| I1 | Important | `<user_cited_quotes>` 没说清 wiki 书名 | 加 `书名(wiki用): ${currentPdfName}` 字段 + prompt 提示照抄 |
| I2 | Important | regenerate 不保留 `citedQuoteIds` | `updateMessage` 显式传 `existingMsg?.citedQuoteIds` |
| I3 | Important | SVG 三处重复 | 提取到 `utils/icons.ts`（quote/excerpt/highlight/expand/collapse/restored/removeHighlight/arrowRight） |
| I4 | Important | `frontmatter.page` 死代码 | 删除 |
| I5 | Important | 徽标显示 `📎 abc123` | `MessageData.citedQuotePreviews` 字段，徽标显示「引用预览…」 |
| S1 | Suggestion | `data-full-text` 死属性 | 删除 |
| S2 | Suggestion | 缺 JSON round-trip 测试 | 新增 `tests/unit/agent/session/quotes-roundtrip.test.ts`（5 tests） |

---

## 风险与限制

1. **`blockId` 仍可能取不到**：如果原始 markdown 文件没有 `^xxx` 标记（用户在 Obsidian 中从未手动标注过），则 `findBlockIdFromRange` 返回 null → 跳转和 wiki 回链都会失败。**降级策略**：仅显示"无 blockId 引用"标签，回链允许 LLM 用 [[书名#章节名]] 形式
2. **LLM 强制回链可能啰嗦**：硬指令"必须出现 wiki 链接"会让短回答变长。可加一个 `user_cited_quotes` 块开关（设置项），用户可关闭
3. **跨书引用的 `sourcePath` 可能不在当前索引中**：跳转时会打开未索引的 md 文件 → 体验差。降级为显示文件路径而不跳转
4. **`extractCitedNodeIds` 误报**：扫描 `> — 24` 模式可能把段落里的"——24 小时"误识别为章节引用。**已存在风险**，本计划不修复

---

## 实施顺序（建议 3 个 PR）

### PR 1：基础设施（无破坏性）
- Step 1.1 类型强化
- Step 2.1 准确 blockId 采集（替换内部实现）
- Step 3.3 服务公开 jumpToBlock + flash
- Step 6.1 单元测试
- **不破坏任何现有行为**，仅让 blockId 更准

### PR 2：UI 优化
- Step 3.1 卡片重写
- Step 3.2 卡片 CSS
- Step 3.4 Sidebar 注入
- Step 5.1-5.3 回复徽标
- **UI 层独立可上**

### PR 3：Agent 深度集成
- Step 1.2 user message 结构化块
- Step 2.2 二级引用
- Step 4.1-4.4 路由 + 工具 + System Prompt
- Step 6.2 E2E
- **最关键也是最容易回退的 PR**，建议详细 review
