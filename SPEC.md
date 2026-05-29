# SPEC: Agent 问答质量评估体系

> 自动化评估 DeepReader Agent 在「单本书籍问答」场景下的回复质量。
> 黄金测试集 + wdio E2E 执行 + PI Agent 评估（评分 + 根因分析 + 报告生成）。
>
> 评测系统是外围工具，不写入插件代码。

---

## 1. 目标

科学测量 Agent 回复质量，使代码变更前后质量可量化、可对比、可追溯。

**范围**：仅 Agent 问答（chat），不含索引质量、导出质量。

**用户**：开发者（通过 CLI 运行评估、阅读报告）。

---

## 2. 核心流程

```
指定书籍 → wdio E2E 执行（Agent 回答）→ 收集响应+轨迹 → PI Agent 评估（评分+根因+报告）→ 存入历史
```

**架构原则**：
- **E2E 层**：wdio + `executeObsidian` 在真实 Obsidian 中执行 Agent，收集原始响应
- **评估层**：PI Agent CLI，以 `test-vault` 为工作目录，自主读本地数据、调 LangSmith API、出报告
- **两层解耦**：E2E 输出 JSON 文件，PI Agent 读文件评估，互不依赖

---

## 3. 黄金测试集

### 3.1 存储位置

```
test-vault/.eval/
├── datasets/
│   └── 反脆弱/
│       ├── golden.json              # 测试题
│       └── responses/               # 每次运行的原始响应
│           └── 2026-05-29T12-00-00.json
├── history/
│   └── eval-log.jsonl               # 所有评估运行的历史（append-only）
└── reports/
    └── 2026-05-29_反脆弱.md          # 评估报告
```

### 3.2 测试集格式

```jsonc
{
  "bookTitle": "反脆弱：从不确定性中获益",
  "bookId": "1e7fb583",
  "bookPath": "DeepReader/反脆弱",
  "generatedAt": "2026-05-29",
  "questions": [
    {
      "id": "q_01",
      "type": "macro_structure",
      "typeName": "宏观结构题",
      "depth": 1,
      "question": "这本书分成了哪几个核心部分？每个部分讨论什么主题？",
      "goldenHeadings": ["前言", "第一卷 反脆弱性", "第二卷 现代性与对随机性的否定", "第三卷 非预测性的世界观"],
      "mustIncludePoints": [
        "全书围绕'反脆弱性'——从混乱和不确定性中获益的能力",
        "分为三卷递进论述：概念引入 → 现代性批判 → 实践方案"
      ],
      "expectedToolCalls": ["none"],
      "antiHallucination": false
    },
    {
      "id": "q_05",
      "type": "anti_hallucination",
      "typeName": "对抗性陷阱题",
      "depth": 2,
      "question": "作者在这本书中是如何评价埃隆·马斯克的创业哲学的？",
      "goldenHeadings": [],
      "mustIncludePoints": [],
      "expectedToolCalls": ["search_book"],
      "antiHallucination": true,
      "expectedBehavior": "书中未提及马斯克，Agent 应搜索后明确表示找不到相关内容"
    }
  ]
}
```

### 3.3 五大题型

| type | typeName | depth | 测试的 Agent 能力 |
|------|----------|-------|-------------------|
| `macro_structure` | 宏观结构题 | 1 | S1 检视阅读 — 只看目录结构，不深入全文 |
| `precise_concept` | 精准概念题 | 2 | S2 搜索命中 + 定点 read，1-2 次搜索 1-2 次阅读 |
| `cross_chapter` | 跨章节综合题 | 2 | S2 并行搜索或回溯机制，综合多章节回答 |
| `implicit_logic` | 隐式逻辑题 | 2 | S2 从上下文提炼因果关系，非原文直接回答 |
| `anti_hallucination` | 对抗性陷阱题 | 2 | 搜索无结果后拒绝回答，不产生幻觉 |

每本书 15-20 道题，覆盖全部五种题型。

### 3.4 测试集生成

测试集由 PI Agent 生成，不需要额外的 TypeScript 代码。

命令：`npm run eval:generate -- --book "反脆弱"`

流程：
1. 启动 PI Agent CLI，工作目录 `test-vault`
2. 注入系统提示词（评估专家角色）
3. PI Agent 自主完成：
   - 读取 `.obsidian/plugins/deepreader/pageindex/{bookId}/tree.json`（目录结构）
   - 读取 `.obsidian/plugins/deepreader/pageindex/{bookId}/book-meta.json`（元数据）
   - 抽样 `chunks.jsonl` 了解内容密度
   - 生成 15-20 道覆盖五大维度的测试题
4. PI Agent 写入 `.eval/datasets/{bookTitle}/golden.json`
5. 用户审核确认

---

## 4. E2E 评估执行（wdio）

### 4.1 后门 API（Backdoor）

不通过 UI 点触发送消息，而是通过 `executeObsidian` 直接调用插件底层 API。

插件新增 `evalBackdoor` API（仅测试环境可用）：

```typescript
// 在插件 onload 中注册，仅当 window.DEEPREADER_EVAL_MODE 存在时暴露
if ((window as any).DEEPREADER_EVAL_MODE) {
  (this as any).evalBackdoor = {
    /** 触发 Agent 问答，返回完整结构化结果 */
    async triggerAgentQnA(question: string, bookId: string): Promise<EvalQnAResult> {
      // 1. 构造 ToolContext，调用 frontendAgent.runGraphEngine()
      // 2. 等待流式完成（Promise resolve）
      // 3. 收集完整结果：response 文本 + toolCalls + nodesVisited + durationMs
      // 4. 返回结构化 payload
    }
  };
}

interface EvalQnAResult {
  response: string;                    // AI 回复全文
  toolCalls: Array<{                   // 工具调用轨迹
    tool: string;
    args: Record<string, any>;
    resultLength: number;
  }>;
  nodesVisited: string[];              // 图节点路径 ["router", "analytical", "formatter"]
  durationMs: number;                  // 总耗时
  depth: number;                       // 实际路由深度
  error?: string;                      // 如果出错
}
```

### 4.2 执行方式

新增 `tests/e2e/specs/eval-agent.e2e.ts`。

命令：`npm run eval:run -- --book "反脆弱"`

流程：
1. wdio 启动 Obsidian（`test-vault`），注入 `window.DEEPREADER_EVAL_MODE = true`
2. 加载 `.eval/datasets/{bookTitle}/golden.json`
3. 逐题执行：
   - 通过 `executeObsidian` 调用 `plugins.deepreader.evalBackdoor.triggerAgentQnA(question, bookId)`
   - 直接获得结构化结果（response + toolCalls + nodesVisited + durationMs）
   - 无需轮询 DOM、无需等待 UI 渲染
4. 保存原始响应到 `.eval/datasets/{bookTitle}/responses/{timestamp}.json`

**优势**：
- 绕过所有不可靠的 UI 层（DOM 抓取、CSS 选择器、渲染延迟）
- 获取完整的结构化数据，包括路由路径、工具调用详情、精确耗时
- 不受 Obsidian 版本更新导致的 DOM 变化影响
- 执行速度更快（无 UI 等待）

### 4.3 响应数据结构

```jsonc
{
  "runId": "2026-05-29T12-00-00",
  "bookTitle": "反脆弱",
  "bookId": "1e7fb583",
  "timestamp": "2026-05-29T12:00:00Z",
  "gitCommit": "44ca92c7",
  "results": [
    {
      "questionId": "q_01",
      "question": "这本书分成了哪几个核心部分？",
      "type": "macro_structure",
      "depth": 1,
      "aiResponse": "本书分为三卷：第一卷...",
      "toolCalls": [
        { "tool": "search_book", "args": { "keywords": ["反脆弱", "目录"] }, "resultLength": 2456 },
        { "tool": "read_book_section", "args": { "node_ids": ["abc123"] }, "resultLength": 8901 }
      ],
      "traceAnalysis": {
        "nodesVisited": ["router", "inspectional", "formatter"],
        "depth": 1,
        "totalToolCalls": 0,
        "durationMs": 3200
      },
      "error": null
    }
  ]
}
```

---

## 5. PI Agent 评估

### 5.1 架构

评估引擎使用 PI Agent CLI，以 `test-vault` 为工作目录。PI Agent 拥有完整的工具链（文件读取、Web API 调用），可以自主完成评分、根因分析和报告生成。

**不需要任何 TypeScript 评估代码** — PI Agent 直接读文件、调 API、写报告。

### 5.2 执行

命令：`npm run eval:judge -- --book "反脆弱" --run "2026-05-29T12-00-00"`

或自动执行：`npm run eval` 等价于 `eval:run` + `eval:judge` 串行组合。

底层实现：
```bash
pi agent spawn \
  --cwd test-vault \
  --system-prompt @.eval/pi-judge-system-prompt.md \
  --prompt "评估书籍《反脆弱》的 Agent 回复质量。测试集：.eval/datasets/反脆弱/golden.json，响应：.eval/datasets/反脆弱/responses/2026-05-29T12-00-00.json。按照系统提示词中的评估标准逐题评分、根因分析、生成报告，写入 .eval/reports/ 和 .eval/history/。"
```

### 5.3 PI Agent 系统提示词

存储在 `test-vault/.eval/pi-judge-system-prompt.md`：

```markdown
<role>
你是 DeepReader Agent 评估引擎。你的工作目录是 Obsidian vault 的 test-vault 目录。
你可以读取本地文件、调用 Web API、写入文件。

你的任务：对比 Agent 的实际回复与黄金测试集的标准答案，逐题评分并进行根因分析。
</role>

<data_guide>
工作目录下所有数据的路径、格式和内容说明：

### 评估数据（.eval/）

| 路径 | 格式 | 内容 |
|------|------|------|
| `.eval/datasets/{书名}/golden.json` | JSON | 测试题集。含 bookTitle、bookId、bookPath、questions 数组。每题含 id、type、typeName、depth、question、goldenHeadings（期望命中的章节标题）、mustIncludePoints（必须覆盖的要点）、expectedToolCalls、antiHallucination |
| `.eval/datasets/{书名}/responses/{runId}.json` | JSON | 一次 E2E 运行的所有响应。含 runId、bookTitle、bookId、gitCommit、results 数组。每条含 questionId、question、type、depth、aiResponse（Agent 回复全文）、toolCalls（工具调用轨迹：tool名、args、resultLength）、traceAnalysis（nodesVisited、totalToolCalls、durationMs） |
| `.eval/history/eval-log.jsonl` | JSONL | 历史评估摘要（append-only）。每行含 runId、bookTitle、gitCommit、timestamp、summary（各维度均分+加权总分）、verdict、questionCount、rootCauseSummary |
| `.eval/reports/{date}_{书名}.md` | Markdown | 完整评估报告 |

### 书籍索引数据（.obsidian/plugins/deepreader/pageindex/{bookId}/）

bookId 在 golden.json 的 bookId 字段，如 "1e7fb583"。

| 路径 | 格式 | 大小 | 内容 |
|------|------|------|------|
| `tree.json` | JSON | ~900KB | 书籍目录树。根节点递归结构，每个节点含 id（如"0001"）、title（章节标题）、level（层级）、children（子节点数组）。这是 Agent S1 检视阅读的数据源 |
| `book-meta.json` | JSON | ~800B | 书籍元数据：title、author、fileType、totalPages、totalTokens 等 |
| `chunks.jsonl` | JSONL | 26KB~972KB | 文本分块，每行一个 JSON。每条含 chunkId（如"0001_summary"或"0001_0"）、nodeId（对应 tree.json 的节点）、blockIds（该 chunk 包含的 ^block_id 列表）、text（分块文本内容）、type（"summary"或"content"）。这是 BM25 + 向量检索的基础数据 |
| `vectors.jsonl` | JSONL | ~5MB | 向量嵌入，每行含 chunkId + embedding（1024维浮点数组） |
| `bm25.json` | JSON | ~13MB | BM25 搜索索引（二进制序列化），不可直接读。但可通过 chunks.jsonl 的 nodeId 统计每章节的分块数量来判断覆盖度 |
| `catalog.json` | JSON | ~1KB | 所有书籍的 bookId → exportName 映射表 |

### 书籍 Markdown 原文（DeepReader/{书名}/）

每本书导出的 Markdown 文件目录，一个章节一个 .md 文件。

| 特征 | 说明 |
|------|------|
| 文件名 | 章节标题，如 "第一章 达摩克利斯之剑.md" |
| 内容 | 完整章节文本，含 Markdown 标题层级、段落、列表 |
| block_id | 段落末尾标注 `^blockId`（如 `^abc123`），是 Agent 精准引用的锚点。格式：`段落文字 ^blockId` |
| 用途 | 验证 Agent 回复中的 `[[文件名#^block_id\|别名]]` 引用是否真实存在 |

### 外部 API

| API | 用途 | 鉴权 |
|-----|------|------|
| `GET https://api.smith.langchain.com/api/v1/runs?session_id={threadId}&start_time={iso}` | LangSmith Trace。返回 runs 数组，每个 run 含 run_type（chain/llm/tool）、name（节点名如 router/inspectional/analytical/formatter）、inputs/outputs、child_runs。threadId 格式 `thread-{bookId}` | Header `x-api-key: $LANGSMITH_API_KEY` |
</data_guide>

<evaluation_criteria>
对每道题，从 0 到 10 分为以下维度打分：

1. 核心要点召回 (recall)：是否覆盖了 mustIncludePoints？
   - 对抗性陷阱题：正确拒绝回答得 10 分，产生幻觉得 0 分。

2. 幻觉与忠实度 (faithfulness)：是否有脑补成分？
   - 是否仅基于书中内容？
   - wiki 链接引用是否真实存在？请读取对应 markdown 文件验证。
   - 对抗性陷阱题是否诚实表示"书中未提及"？

3. 排版与引用规范 (formatting)：
   - 是否使用 [[文件名#^block_id|别名]] 格式？
   - 是否避免生硬脚注？

4. 动作效率 (efficiency)：
   - depth=1：不应调用 search_book/read_book_section
   - depth=2：理想 1-2 次 search + 1-2 次 read
   - 重复无效搜索扣分

5. 响应时间 (latency)：
   - depth=0 闲聊：期望 < 5 秒
   - depth=1 检视阅读：期望 < 15 秒
   - depth=2 分析阅读：期望 < 60 秒
   - 超过期望时间 2 倍扣 3 分，超过 3 倍扣 5 分
   - 参考字段：responses JSON 中 traceAnalysis.durationMs
</evaluation_criteria>

<root_cause_analysis>
当任一维度低于 7 分时，必须定位根因。你需要：

1. **读取 LangSmith Trace**：
   调用 LangSmith API，找到该题对应的 run（按时间戳 + bookId 过滤），
   分析节点路径（Router→S1→S2→S4）、工具调用详情、每步 input/output。

2. **读取本地索引数据**：
   - pageindex/{bookId}/tree.json — 检查章节结构是否完整
   - pageindex/{bookId}/chunks.jsonl — 检查分块覆盖
   - golden.json 中的 goldenHeadings — 检查这些章节在 tree.json 中是否存在
   - 对应的 markdown 文件 — 验证 ^block_id 是否存在

3. **定位根因标签**：
   - ROUTING_ERROR: 路由到错误的深度级别
   - SCOPE_MISALIGN: S1 选择的 scope 与 goldenHeadings 不匹配
   - SEARCH_KEYWORD_POOR: 搜索关键词选择不当
   - BACKTRACK_MISSING: 应该回溯但没有触发
   - REPETITIVE_SEARCH: 重复无效搜索
   - INDEX_INCOMPLETE: 本地索引数据不完整
   - CHUNK_COVERAGE_GAP: 分块覆盖不足
   - BLOCK_ID_MISSING: 缺少 block_id 标注
   - FORMATTER_ISSUE: Formatter 处理不当
   - HALLUCINATION_UNCHECKED: 幻觉未被拦截

4. **给出改进建议**：针对根因给出具体的代码或数据层面的改进方向。
</root_cause_analysis>

<scoring>
权重：recall 30% + faithfulness 25% + formatting 10% + efficiency 15% + latency 20%
通过标准：加权分 >= 7.0 且 faithfulness >= 8.0 且对抗性陷阱题全部通过
</scoring>

<output>
1. 将完整报告写入 .eval/reports/{date}_{bookTitle}.md（Markdown 格式）
2. 将历史摘要追加到 .eval/history/eval-log.jsonl（JSON 格式，append-only）

报告格式：
# Agent 评估报告：{bookTitle}

运行时间 / Git Commit / PI Agent 版本

## 汇总
（各维度平均分 + 加权总分 + 通过/失败）

## 根因分析摘要
（主要根因 + 改进方向表格）

## 逐题详情
（每题：问题、得分、评语、根因（如有）、建议（如有））
</output>
```

### 5.4 PI Agent 数据访问

所有数据路径、格式、字段说明已在系统提示词的 `<data_guide>` 中定义。PI Agent 按需读取，无需额外配置。

---

## 6. 报告输出

### 6.1 单次报告

由 PI Agent 写入 `.eval/reports/{date}_{bookTitle}.md`：

```markdown
# Agent 评估报告：反脆弱

运行时间：2026-05-29 12:00:00
Git Commit：44ca92c7

## 汇总

| 维度 | 平均分 |
|------|--------|
| 召回 | 8.2 |
| 忠实度 | 9.1 |
| 排版 | 6.5 |
| 效率 | 7.8 |
| 响应时间 | 8.5 |
| **加权总分** | **8.2** |

结果：**PASS**

## 根因分析摘要

| 问题数 | 主要根因 | 改进方向 |
|--------|----------|----------|
| 3 道低分 | SEARCH_KEYWORD_POOR (2), CHUNK_COVERAGE_GAP (1) | S2 增加同义词扩展；检查第 3 章分块覆盖 |

## 逐题详情

### q_01 宏观结构题 (depth=1) — 9.2分
**问题**：这本书分成了哪几个核心部分？
**得分**：recall=10 | faithfulness=9 | formatting=8 | efficiency=10
**评语**：覆盖了三卷结构，未触发不必要的搜索。

### q_03 跨章节综合题 (depth=2) — 5.8分
**问题**：书中第一卷提出的'杠铃策略'，在第三卷的实践中是如何应用的？
**得分**：recall=4 | faithfulness=8 | formatting=7 | efficiency=5
**评语**：遗漏了"投资组合"的应用场景。
**根因**：SEARCH_KEYWORD_POOR — Agent 用"杠铃策略 投资"搜索，
但 tree.json 中该段落标题为"杠铃式职业规划"，关键词不匹配。
LangSmith trace: run_id=abc, tool_call_2: search_book(keywords=['杠铃策略 投资']) returned 0 results。
**建议**：在 S2 search_book 中增加同义词扩展，或让 S1 scope 包含更多相关节点。
```

### 6.2 历史趋势

命令：`npm run eval:history -- --book "反脆弱"`

从 `eval-log.jsonl` 读取，输出终端表格：

```
日期         Commit    召回   忠实   排版   效率   总分   结果
2026-05-20  abc1234   7.5    8.0    6.0    7.2    7.2   PASS
2026-05-25  def5678   8.0    9.0    6.5    7.5    7.8   PASS
2026-05-29  44ca92c   8.2    9.1    6.5    7.8    8.1   PASS  ▲+0.3
```

### 6.3 历史记录格式

追加到 `.eval/history/eval-log.jsonl`（append-only）：

```jsonc
{
  "runId": "2026-05-29T12-00-00",
  "bookTitle": "反脆弱",
  "gitCommit": "44ca92c7",
  "timestamp": "2026-05-29T12:05:00Z",
  "summary": { "recall": 8.2, "faithfulness": 9.1, "formatting": 6.5, "efficiency": 7.8, "latency": 8.5, "weightedScore": 8.2 },
  "verdict": "PASS",
  "questionCount": 15,
  "passedCount": 14,
  "failedQuestions": [],
  "rootCauseSummary": {
    "topIssues": ["SEARCH_KEYWORD_POOR", "CHUNK_COVERAGE_GAP"],
    "details": "3 道低分题均因搜索关键词与索引分块不匹配导致召回不足"
  }
}
```

---

## 7. CLI 命令

| 命令 | 说明 |
|------|------|
| `npm run eval -- --book "反脆弱"` | 完整评估（E2E 执行 → PI Agent 评估） |
| `npm run eval:generate -- --book "反脆弱"` | PI Agent 生成测试集 |
| `npm run eval:run -- --book "反脆弱"` | 仅 wdio E2E 执行，收集响应 |
| `npm run eval:judge -- --book "反脆弱" --run <runId>` | 仅 PI Agent 评估（评分+根因+报告） |
| `npm run eval:history -- --book "反脆弱"` | 查看历史趋势 |

---

## 8. 项目结构（新增/变更）

```
tests/
└── e2e/specs/
    └── eval-agent.e2e.ts              # wdio E2E：执行 Agent + 收集响应

test-vault/.eval/
├── pi-judge-system-prompt.md          # PI Agent 评估系统提示词
├── datasets/{bookTitle}/
│   ├── golden.json                    # 测试题
│   └── responses/{runId}.json         # 原始响应
├── history/
│   └── eval-log.jsonl                 # 历史记录
└── reports/
    └── {date}_{bookTitle}.md          # 评估报告

scripts/
└── eval-runner.sh                     # 编排脚本：wdio → PI Agent CLI
```

**没有 TypeScript 评估代码** — PI Agent 承担所有评估逻辑。

---

## 9. 依赖

| 依赖 | 用途 | 状态 |
|------|------|------|
| `wdio-obsidian-service` | E2E 执行 Agent 对话 | 已安装 |
| PI Agent CLI | 评估引擎（评分+根因+报告） | 需已安装 |
| LangSmith REST API | Trace 数据获取 | 已在使用 |

---

## 10. 边界

### 始终做到
- 测试集覆盖全部五大题型
- 每道题必须可追溯到书籍具体章节（goldenHeadings）
- 对抗性陷阱题必须通过（faithfulness 硬性要求）
- 低分题必须有根因分析（引用 LangSmith trace + 本地数据）
- 历史记录 append-only，不可篡改
- 评估结果与 git commit 绑定

### 先问再做
- 修改 PI Agent 系统提示词的评分维度或权重
- 新增题型维度
- 修改通过标准阈值

### 绝不做
- 不评估索引质量（TOC/摘要/L2 向量化），本 SPEC 仅覆盖 Agent 问答
- 不集成到 CI/CD
- 不修改 Agent 回复逻辑来"适配"评估
- 不在 Obsidian 插件 UI 中嵌入评估功能
- 不编写 TypeScript 评估代码（PI Agent 承担所有评估逻辑）

---

## 11. 验收标准

- [ ] `npm run eval:generate -- --book "反脆弱"` 调用 PI Agent 基于书籍索引生成测试集
- [ ] `npm run eval:run -- --book "反脆弱"` 在 wdio E2E 中通过后门 API 逐题触发 Agent 并收集结构化响应
- [ ] 插件在 `DEEPREADER_EVAL_MODE` 下暴露 `evalBackdoor.triggerAgentQnA()` 后门 API
- [ ] `npm run eval:judge` 启动 PI Agent 评估，PI Agent 自主读取数据、调 LangSmith、评分、写报告
- [ ] `npm run eval` 一条命令完成全流程（E2E → PI Agent 评估 → 报告）
- [ ] `npm run eval:history` 展示历史趋势对比
- [ ] 测试集覆盖五大题型（宏观结构/精准概念/跨章节/隐式逻辑/对抗性）
- [ ] 对抗性陷阱题验证 Agent 的幻觉拒绝能力
- [ ] 低分题有根因分析（引用 LangSmith trace + 本地索引数据）
- [ ] 评分结果持久化到 JSONL，与 git commit 绑定
