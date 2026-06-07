# L7 — 验证与输出处理层

> S4 Formatter 的 6 道后处理管线 + Self-Verification + Wiki-Link Hook
>
> 状态机的"质量门"——LLM 输出的内容在交给用户前要过的 6 道关。

---

## 1. 现状

### 1.1 角色定位

L7 是状态机输出的"质量门"：

| 职责 | 说明 |
|------|------|
| **流式残片修复** | 网络中断留下的半个 `[[` 不会被当链接 |
| **幽灵引用检测** | 工具结果不含的 block_id 不被输出 |
| **格式修正** | `<think>` 标签、空 block_id、缺书名前缀 |
| **真实 vault 校验** | `app.vault.adapter.exists` 真查文件 |
| **编造链接兜底** | 白名单外的编造回退为别名文本 |
| **错误提示追加** | `> [!hint]` 注入到输出末尾 |

### 1.2 S4 Formatter 后处理管线（执行顺序严格）

**位置**：`src/agent/graph/nodes/formatter.ts`

| # | 关卡 | 函数 | 职责 |
|---|------|------|------|
| 1 | 流式残片修复 | `validateLinkPairs` | 修复单边 `[[` / `]]`（流截断/LLM 幻觉残留），配对失败的 `[[`→`[`，`]]`→`]` |
| 2 | 幽灵引用检测 | `verifyAndCleanContent` | 提取 wiki links，校验 block_id / file_name 是否在 toolResults 中真实存在；超阈值时触发 LLM 修正重生成 |
| 3 | 格式修正 | `cleanOutput`（= `stripThinkTags` → `fixupEmptyBlockIds` → `fixupWikiLinks`） | 剥 `<think>` 标签 / 删空 `#^` 锚点 / 补缺失的 `书名/` 前缀 |
| 4 | Vault 真实校验 | `validateWikiLinks` | 用 `app.vault.adapter.exists` 真查文件；按 `findClosestFile` / `findClosestBlockId` 自动纠正；confidence>0.5 才改写 |
| 5 | 编造链接兜底 | `stripFabricatedLinks` | 从 inputTexts 收集合法 file_name 白名单，命中白名单外的降级为纯文本 |
| 6 | 错误提示追加 | `appendErrorHints` | 把 `state.nodeErrors` 中可恢复的 node 错误以 `> [!hint]` 块追加到末尾 |

**关键设计**：
- 关 1（validateLinkPairs）必须在关 2 之前（line 380 注释："流式残片必须先修，否则 verifyAndCleanContent 看到的就是坏数据"）
- 关 2 只在 `toolResults.length > 0` 时执行
- 关 4 只在 `vaultApp` 存在时执行
- 关 2、4 失败都静默降级（不阻塞 S4）
- HITL 反馈循环（line 422-447）仅在 `enableHumanReview=true` 时插入，在关 2 之后

### 1.3 关 1：validateLinkPairs（流式残片修复）

**文件**：`src/agent/utils/wiki-link-pair-validator.ts`（T3.1 新建）

**算法**：
- 扫描所有 `[[` 出现位置
- 找到下一个 `]]` 配对
- 找不到配对的 `[[`（行末、文本末尾）→ 替换为 `[`（去除一个 `[`）或整段删除
- 找不到配对的 `]]`（没有前置 `[[`）→ 替换为 `]` 或删除

**测试覆盖**：24 个单测（正常 / 末尾残缺 / 中间残缺 / 多重残缺 / 嵌套 / 单 `]` / `[1]` / 空 / emoji / block_id）

**触发时机**：formatter 节点 line 381，`streamToContent` 返回后立即调用

**已知问题**：
- HITL refine 路径**没有**再跑 linkPair 修复——refine 流出的内容仍可能带单边 `[[`
- 算法对嵌套不友好（外层 `[[` 内层 `[[` 配对会破坏外层）

### 1.4 关 2：verifyAndCleanContent（self-verification）

**文件**：`src/agent/graph/utils/self-verification.ts`

**block_id 提取**（`extractWikiLinks` line 57-107）：
- 正则 1：`/\[\[[^\]]*#\^+([^|\]]+)\|[^\]]*\]\]/g` → 抓带 `^block_id` 的链接
- 正则 2：`/\[\[([^#|]+)\|([^\]]+)\]\]/g` → 抓无 `^block_id` 的链接

**校验**（`checkWikiLinkValid` line 114-165）：
- `blockId` 为空 → 只验 fileName 是否出现在 `search_book` / `read_book_section` / `inspect_toc` / `pre_search` 的 result 中
- 有 blockId → 正则 `\^${blockId}(?=\W|$)` 防子串误匹配（如 `p1` 不应命中 `p10`）
- 工具 result 被截断（`originalResultLength > MAX_TOOL_RESULT_LENGTH=4000`）时返回 `'truncated-invisible'`

**状态码五态**：`valid` / `invalid-block` / `invalid-file` / `truncated-invisible` / `ghost`

**cite 文本拼接与清洗**（`removeGhostLinks` line 208-218）：
- 把 `[[书名/文件#^ghost_block|别名]]` 降级为 `[[书名/文件|别名]]`，不删除链接
- `removeGhostFileLinks` 是空操作（line 224-227 注释"不再删除，直接返回原内容"）—— file 名校验失败时链接保留

**LLM 修正触发**（`verifyAndCleanContent` line 283-297）：
- 阈值 `GHOST_REF_RATIO_THRESHOLD = 0.3`（line 16）
- 当 `(ghostCount + invalidFileRefs) > totalRefs * 0.3` 且提供 `llmClient` → 用"当前内容 + 修正 prompt"调用 LLM 重生成
- 失败静默回退

**返回结构**：
```typescript
interface VerificationResult {
  content: string;
  totalRefs: number;
  ghostRefs: number;
  truncatedRefs: number;
  invalidFileRefs: number;
  llmCorrectionTriggered: boolean;
}
```

### 1.5 关 3：cleanOutput（格式修正）

**链式调用**：

```typescript
function cleanOutput(content: string, pdfName: string, crossBookMode: boolean): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/g, '')           // stripThinkTags
    .replace(/\[\[([^\]]+)#\^\|([^\]]+)\]\]/g, '[[$1|$2]]')  // fixupEmptyBlockIds 1
    .replace(/\[\[([^\]]+)#\^\]\]/g, '[[$1]]')            // fixupEmptyBlockIds 2
    .pipe(content => crossBookMode ? content : fixupWikiLinks(content, pdfName));
}
```

**`stripThinkTags`**：剥 `<think>...</think>`（DeepSeek 等 thinking 模型输出）

**`fixupEmptyBlockIds`**：
- `[[书名/文件#^|别名]]` → `[[书名/文件|别名]]`
- `[[书名/文件#^]]` → `[[书名/文件]]`

**`fixupWikiLinks`**：给"裸文件名"补书名前缀
```typescript
function fixupWikiLinks(content: string, bookName: string): string {
  if (!bookName) return content;
  return content.replace(/\[\[([^/\]]+)\]\]/g, (_match, inner) => {
    return `[[${bookName}/${inner}]]`;
  });
}
```

**crossBookMode 守卫**（T1.3 修复）：`crossBookMode === true` 时**直接 return content**——不强行加书名前缀。

### 1.6 关 4：validateWikiLinks（Vault 真实校验）

**文件**：`src/agent/utils/wiki-link-hook.ts`

**接口**：
```typescript
interface LinkCorrectionContext {
  app: App;
  bookName: string;
  vaultPath: string;
  toolResults: ToolResultEntry[];
  expectedBookName?: string;  // T1.2 新增
}

interface WikiLinkMetrics {
  totalLinks: number;
  validLinks: number;
  deadLinksRemoved: number;
  autoCorrectedLinks: number;
}

interface WikiLinkValidationResult {
  correctedContent: string;
  issues: WikiLinkIssue[];
  correctionsApplied: number;
  metrics: WikiLinkMetrics;
}
```

**Issue 类型**：
- `file_not_found`：目标文件 vault 中不存在
- `block_not_found`：目标 block_id 在文件中不存在
- `malformed_format`：链接格式无法解析
- `missing_caret`：缺 `^` 前缀
- `wrong_book`：跨书误加（`expectedBookName` 不匹配）

**算法**：
1. 解析每个 `[[...]]` 链接
2. `detectLinkIssues(parsed, expectedBookName)` 收集问题
3. 对每个问题尝试纠正：
   - `findClosestFile` 模糊匹配目录
   - `findClosestBlockId` 找最近的 block_id
4. confidence > 0.5 才改写
5. 记录 metrics

**批量优化**（T1.1）：每本书的目录 `list()` 调用一次（缓存），后续 `findClosestFile` 复用。

**跨书守卫**（T1.2）：`expectedBookName` 不匹配时标 `'wrong_book'`，优先在 `expectedBookName` 目录下找。

**已知问题**：
- 置信度 0.5 是改写的硬阈值（line 381）
- `findClosestFileInCachedList` 的相似度阈值 0.4（line 204）
- `findClosestBlockId` 没有显式阈值但会找"数字最近"的 block_id，可能误判（如 `p10` 误匹配到 `p1` 因 `Math.abs(10-1)=9` 比 `p100` 的 `Math.abs(100-1)=99` 小）

### 1.7 关 5：stripFabricatedLinks（白名单兜底）

**文件**：`src/agent/graph/utils/self-verification.ts`（同 self-verification）

**白名单收集**（`inputTextsForValidation`）：
- `effectiveAR`（清洗后 analysisResult）
- `structuralAnalysis`
- `coveredScope`（含 `file_name: "..."`）
- `tocSummary`（提取 `'title'(nodeId)` 形式）

**降级策略**：
- **Calibre 兼容**：`[[xxx#calibre-pb-123|alias]]` → `[[xxx|alias]]`（Calibre 的 pagebreak 不是合法 Obsidian block ID）
- **白名单外**（file_name 不在 inputTexts 中）→ 回退为别名文本（保留自然语言可读性）
- **block_id 不存在** → 降级为标题链接（`[[书名/文件|别名]]` 不带 `^`）

**已知问题**：
- `valid` 宽松匹配（`stripNum` 去编号前缀 + `endsWith` 双向）容易误判——如"A"和"B-A"会互相命中
- 工具 result 字符串匹配可能误判 fileName 出现在注释/元数据中的情况

### 1.8 关 6：appendErrorHints（错误提示追加）

把 `state.nodeErrors` 中可恢复的节点错误以 `> [!hint]` 块追加到 `formattedOutput` 末尾：

```
> [!hint] ⚠️ 结构分析暂时不可用，已使用全书范围搜索。
```

**关键不变量**：仅在 normal 路径生效（`!proactiveTrigger && depth !== CASUAL`）。

### 1.9 完整流程时序

```
formatterNode(state, config):
  ┌─ streamToContent(state, config, llmCfg, callbacks)  // 1. LLM 流式
  │     → formattedOutput (流式累积)
  │
  ├─ 2. validateLinkPairs(formattedOutput)               // 关 1: 残片修复
  │     → formattedOutput (修复后)
  │
  ├─ 3. verifyAndCleanContent(formattedOutput, toolResults)  // 关 2: 幽灵检测
  │     → formattedOutput (清洗后)
  │     → 可能触发 LLM 修正重生成
  │
  ├─ 4. (HITL?) interrupt() → 用户审查 → refine (再跑 1 次)
  │
  ├─ 5. cleanOutput(formattedOutput, effectivePdfName, crossBookMode)  // 关 3: 格式修正
  │     → formattedOutput (格式修后)
  │
  ├─ 6. validateWikiLinks(formattedOutput, ctx)            // 关 4: Vault 校验
  │     → formattedOutput (纠正后)
  │
  ├─ 7. stripFabricatedLinks(formattedOutput, inputTexts, vaultBlockIds)  // 关 5: 兜底
  │     → formattedOutput (兜底后)
  │
  └─ 8. appendErrorHints(formattedOutput, nodeErrors)      // 关 6: 错误提示
        → formattedOutput (最终)

  → state.formattedOutput = formattedOutput
```

---

## 2. 已知问题

### 2.1 关 1 在 HITL refine 路径缺失

**现象**：`runPlanExecute` 的 HITL refine 流程在 `verifyAndCleanContent` 之后插入，但没有重跑 `validateLinkPairs`。

**后果**：refine 出来的内容可能带单边 `[[` 残片。

**修复**：在 refine 之后、`verifyAndCleanContent` 之前补一次 `validateLinkPairs`。

### 2.2 关 2 的 LLM 修正只跑一次不递归

**现象**：`verifyAndCleanContent` 触发 LLM 修正后，新生成的内容**不会**再走一次 verify。

**后果**：修正后的内容可能再次引入幽灵引用。

**修复**：在修正后递归调一次 verify（限制最大深度 2-3 层防爆栈）。

### 2.3 关 3 在 crossBookMode 时 fixupEmptyBlockIds 仍执行

**现象**：`cleanOutput` 的第三个参数 `crossBookMode` 只控制 `fixupWikiLinks`，但 `fixupEmptyBlockIds` 在 `crossBookMode=true` 时仍执行。

**后果**：跨书链接里的 `[[书A/章节#^|别名]]` 会被改成 `[[书A/章节|别名]]`，**可能误删合法锚**。

**修复**：`fixupEmptyBlockIds` 也接受 `crossBookMode` 参数。

### 2.4 关 4 的 findClosestBlockId 数字匹配误判

**现象**：`findClosestBlockId` 会找"数字最近"的 block_id。

**例子**：`p10` 可能误匹配到 `p1`（`Math.abs(10-1)=9` < `Math.abs(10-100)=90`）。

**修复**：用 string similarity（levenshtein / Dice 系数）替代数字距离。

### 2.5 关 5 的白名单匹配过于宽松

**现象**：`stripNum` 去编号前缀 + `endsWith` 双向匹配。

**例子**：
- 文件"A" + 文件"B-A"
- "A" 包含在 "B-A" 里（endsWith 双向）
- 互相命中，白名单失效

**修复**：
- 严格 equals 比对
- 或用 normalized name（去后缀、去空格）+ 完整 equals

### 2.6 关 6 的 appendErrorHints 不覆盖所有 mode

**现象**：仅在 `!proactiveTrigger && depth !== CASUAL` 追加 hint。

**后果**：
- proactive 模式触发时 S2 失败，用户看不到降级提示
- casual 模式（同等于 chat 闲聊）失败时也看不到

**修复**：在所有 mode 追加，但区分语气（如 casual 用更柔和的措辞）。

### 2.7 关 4 的"vault 移动端路径"未测

**现象**：`getVaultPath` 桌面端 vs 移动端分支，移动端为空会走 `app` 分支。

**风险**：移动端 vault 校验行为可能未在所有路径回归。

### 2.8 关 5 的 file_name 校验"非 vault"回退到 toolResult 字符串匹配

**现象**：`checkWikiLinkValid` 用正则直接在 `entry.result` 文本里搜 fileName（不依赖 vault.exists）。

**后果**：toolResult 中含 "麦肯锡方法" 字样的链接才会被判 valid——可能误判 fileName 出现在注释/元数据中的情况。

**修复**：优先 vault.exists，回退到正则；正则要用 word boundary。

### 2.9 关 2 的 LLM 修正 prompt 没文档化

**现象**：`verifyAndCleanContent` 调 LLM 时的 prompt 是 inline 字符串（在 self-verification.ts 里），没在 `prompts/` 目录。

**修复**：提取到 `src/agent/graph/prompts/verify-correction-prompt.ts`。

### 2.10 L7 整体无单测覆盖管线

**现象**：每道关都有自己的单测（`validateLinkPairs` 24 个、`verifyAndCleanContent` 推测有），但**6 道关串联的集成测试**只在 `formatter-integration.test.ts`（来自 T3.2）。

**风险**：管线顺序变更（如有人调整关 1 关 2 顺序）会破坏不变量。

**修复**：加 1-2 个 E2E 集成测试，固化顺序。

---

## 3. 优化探讨

### 3.1 关 1 在 HITL refine 路径补跑

```typescript
if (enableHumanReview) {
  // ... interrupt() ...
  formattedOutput = streamToContent(refinedMessages, ...);
  formattedOutput = validateLinkPairs(formattedOutput).content;  // ← 新增
  formattedOutput = verifyAndCleanContent(formattedOutput, toolResults).content;
}
```

### 3.2 关 2 的递归修正

```typescript
async function verifyAndCleanContentWithRetry(content, toolResults, llmClient, depth = 0) {
  const result = await verifyAndCleanContent(content, toolResults, llmClient);
  if (result.llmCorrectionTriggered && depth < 2) {
    return verifyAndCleanContentWithRetry(result.content, toolResults, llmClient, depth + 1);
  }
  return result;
}
```

**风险**：深度太深会浪费 token；建议 limit=2。

### 3.3 关 4 相似度匹配改进

`findClosestBlockId`：
- 当前：`Math.abs(parseInt(a) - parseInt(b))` 找最近的数字
- 建议：用 normalized Levenshtein 距离（适用于字母数字混合 ID）

### 3.4 关 5 白名单严格化

```typescript
// 当前
const isValid = stripNum(a).endsWith(stripNum(b)) || stripNum(b).endsWith(stripNum(a));

// 建议
const isValid = stripNum(a) === stripNum(b) || stripNum(a).includes(`/${stripNum(b)}`);
```

**收益**：避免 "A" 误匹配 "B-A"。

### 3.5 关 6 错误提示的"分级"显示

```typescript
const hints = state.nodeErrors
  ? Object.entries(state.nodeErrors)
      .filter(([_, err]) => typeof err === 'object' && err.recoverable)
      .map(([name, err]) => `> [!hint] ${NODE_ERROR_HINTS[name]}`)
  : [];

if (hints.length > 0) {
  content += '\n\n' + hints.join('\n');
}
```

不依赖 mode，统一追加。

### 3.6 L7 整体的"管线抽象"

**当前问题**：6 道关直接写在 `formatter.ts` 主体里，混着 prompt 拼装。

**建议**：
- 抽 `WikiLinkPostProcessor` 类
- 6 道关作为 `Processor[]` 数组
- 顺序可配置（用于 A/B 测试）

```typescript
class WikiLinkPostProcessor {
  private stages: Processor[];
  
  async run(formattedOutput: string, ctx: FormatterContext): Promise<string> {
    let current = formattedOutput;
    for (const stage of this.stages) {
      current = await stage(current, ctx);
    }
    return current;
  }
}
```

**收益**：
- 单元测试可独立写
- 顺序变更是 1 行改动
- 可复用到 S2 Analytical 输出

### 3.7 L7 前置到 S2/S3 节点输出

**问题**：wiki-link 校验在 S4 末尾才做。

**方案**：在 S2 / S3 节点输出 `analysisResult` 时**先跑 wiki-link 校验**（关 1-5），再写 state。S4 只做"美化"。

**收益**：
- S2 看到的是已校验的文本
- prompt 设计可以假设"我的输出是干净的"
- 减少 S4 的 token 消耗（不需要重复校验）

**风险**：跨节点 schema 耦合。

### 3.8 关 5 的 Calibre 降级应该可配置

**当前**：写死把 `calibre-pb-` 降级。

**建议**：把降级规则配置化（如 `calibre-pb-*` / `epubcfi(/6/...)` 等多种格式）。

---

## 4. 关键文件路径

| 文件 | 角色 |
|------|------|
| `src/agent/graph/nodes/formatter.ts` | S4 Formatter 主体（包含 6 道关） |
| `src/agent/utils/wiki-link-pair-validator.ts` | 关 1（流式残片） |
| `src/agent/graph/utils/self-verification.ts` | 关 2（幽灵检测） + 关 5（白名单） |
| `src/agent/utils/wiki-link-hook.ts` | 关 4（Vault 校验） |
| `src/agent/graph/prompts/formatter-prompt.ts` | S4 system prompt |
| `src/agent/graph/prompts/proactive-formatter-prompt.ts` | proactive/socratic mode prompt |

## 5. 关联文档

- L4 节点层 — S4 Formatter 节点
- L8 基础设施层 — ToolContext 来源
- ADR-003 LangGraph 状态机 — 状态机架构选型
- `tasks/wiki-link-refactor-todo.md` — T0-T4 的 14 个任务完成记录
- `docs/test-strategies/wiki-link-refactor.md` — 5 阶段 × 4 层覆盖矩阵
