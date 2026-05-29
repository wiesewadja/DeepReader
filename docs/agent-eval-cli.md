# Agent Eval CLI — 评估系统命令行工具

> 本文档描述评估系统的 CLI 工具设计与实现。

---

## 1. 设计目标

- **统一入口**：所有评估子命令通过单一 CLI 入口 `node scripts/eval/eval-cli.mjs` 驱动
- **自包含**：CLI 本身无外部依赖，使用 Node.js 原生 `parseArgs()`
- **可测可维护**：子命令逻辑分离，prompt 文件纳入版本控制
- **CI 友好**：judge 子命令支持 `--threshold` + exit code，可接入 CI 质量门禁

---

## 2. 命令结构

```
node scripts/eval/eval-cli.mjs <子命令> [选项]
```

| 子命令 | 说明 | 必需参数 |
|--------|------|---------|
| `generate` | PI Agent 生成黄金测试集 | `--book` |
| `run` | wdio E2E 执行 Agent，收集响应 | `--book` |
| `judge` | PI Agent 评分 + 根因分析 + 报告 | `--book` |
| `history` | 查看历史趋势 | 无（可选 `--book`） |
| `diff` | 对比最近两次运行的差异 | `--book` |
| `full` | generate + run + judge 串行 | `--book` |

**全局选项**（所有子命令均可用）：

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--vault <path>` | Vault 路径 | `./test-vault` |
| `--verbose` | 打印详细调试日志 | `false` |

**子命令特有选项**：

| 子命令 | 选项 | 说明 |
|--------|------|------|
| `judge` | `--run <runId>` | 指定运行 ID，不传则自动取最新 |
| `judge` | `--threshold <分数>` | 通过分数线，低于此分返回 exit 1 |
| `history` | `--book <书名>` | 过滤特定书籍，不传则显示全部 |
| `diff` | `--a <runId>` | 第一次运行的 runId，不传则自动取倒数第二 |
| `diff` | `--b <runId>` | 第二次运行的 runId，不传则自动取最新 |
| `diff` | `--format <table\|json>` | 输出格式，默认 table |

---

## 3. 使用示例

```bash
# 生成测试集（单本书）
node scripts/eval/eval-cli.mjs generate --book "反脆弱"

# E2E 执行（收集响应）
node scripts/eval/eval-cli.mjs run --book "反脆弱"

# PI Agent 评估（默认取最新 run）
node scripts/eval/eval-cli.mjs judge --book "反脆弱"

# 评估 + CI 门禁（分数 <7.0 则 exit 1）
node scripts/eval/eval-cli.mjs judge --book "反脆弱" --threshold 7.0

# 评估指定运行
node scripts/eval/eval-cli.mjs judge --book "反脆弱" --run "run-1748500000"

# 查看历史
node scripts/eval/eval-cli.mjs history
node scripts/eval/eval-cli.mjs history --book "反脆弱"

# 对比最近两次运行
node scripts/eval/eval-cli.mjs diff --book "反脆弱"

# 全流程（generate → run → judge）
node scripts/eval/eval-cli.mjs full --book "反脆弱"

# 指定 Vault 路径
node scripts/eval/eval-cli.mjs judge --book "反脆弱" --vault ./my-vault

# 详细日志
node scripts/eval/eval-cli.mjs judge --book "反脆弱" --verbose

# 帮助
node scripts/eval/eval-cli.mjs --help
node scripts/eval/eval-cli.mjs judge --help
```

---

## 4. npm scripts 别名

为方便使用，在 `package.json` 中提供简短别名：

```json
{
  "scripts": {
    "eval": "node scripts/eval/eval-cli.mjs",
    "eval:generate": "node scripts/eval/eval-cli.mjs generate --",
    "eval:run": "node scripts/eval/eval-cli.mjs run --",
    "eval:judge": "node scripts/eval/eval-cli.mjs judge --",
    "eval:history": "node scripts/eval/eval-cli.mjs history",
    "eval:diff": "node scripts/eval/eval-cli.mjs diff --",
    "eval:full": "node scripts/eval/eval-cli.mjs full --"
  }
}
```

使用方式：

```bash
npm run eval -- judge --book "反脆弱" --threshold 7.0
npm run eval:generate -- "反脆弱"
npm run eval:history -- --book "反脆弱"
```

---

## 5. Exit Code 约定

| 场景 | exit code |
|------|-----------|
| 正常完成（分数 ≥ threshold 或未设 threshold） | `0` |
| 分数 < threshold | `1` |
| 子命令执行失败（文件不存在、PI 启动失败、wdio 错误等） | `1` |
| 参数解析错误（缺少必需参数、未知选项） | `2` |
| Vault 路径不存在 | `2` |

---

## 6. 输出规范

### 标准输出

所有子命令输出纯文本报告到 stdout：

- `generate`：结束时输出「生成完毕，共 N 道题，写入 golden.json」
- `run`：实时打印每道题的执行进度
- `judge`：完整 Markdown 报告 + 末尾汇总行
- `history`：终端表格
- `diff`：表格对比两个 run 的各维度得分
- `full`：各阶段进度 + 最终报告路径

### 错误输出

所有错误信息输出到 stderr，包含人类可读的错误描述。不输出原始堆栈（除非 `--verbose`）。

---

## 7. 数据文件位置（相对于 Vault）

```
{VAULT}/.eval/
├── pi-generate-system-prompt.md   ← 源码同步而来
├── pi-judge-system-prompt.md      ← 源码同步而来
├── datasets/
│   └── {书名}/
│       ├── golden.json
│       └── responses/
│           └── {runId}.json
├── history/
│   └── eval-log.jsonl
└── reports/
    └── {date}_{书名}.md
```

---

## 8. 子命令行为约定

### generate

1. 读取 Vault catalog.json，找到 bookId
2. 检查 `datasets/{书名}/golden.json` 是否已存在，若存在则报错（不覆盖）
3. spawn PI Agent，写入 prompt 路径 + 书籍参数
4. PI Agent 写入 `golden.json`
5. 验证 golden.json 格式正确（questions 数组非空）
6. 输出摘要表格（每题 id / type / difficulty）

### run

1. 读取 `datasets/{书名}/golden.json`
2. 检查 bookId 对应的索引数据是否存在
3. 生成 `runId = run-{timestamp}`
4. spawn wdio，执行 `tests/specs/eval-agent.e2e.ts`
5. 环境变量传入 `EVAL_BOOK` + `EVAL_RUN_ID`
6. wdio 完成后，验证 `responses/{runId}.json` 生成
7. 输出「完成，共 N 道题，耗时 M 分钟」

### judge

1. 定位 `responses/{runId}.json`（自动或指定）
2. 检查 `pi-judge-system-prompt.md` 是否存在
3. spawn PI Agent，注入 prompt 路径 + runId + bookTitle
4. PI Agent 读 golden.json + responses + LangSmith trace，写报告 + 追加历史
5. 读取历史摘要，输出汇总行
6. 若传了 `--threshold`，对比分数并设置 exit code

### history

1. 读取 `eval-log.jsonl`
2. 按时间倒序过滤（可选按书名）
3. 输出终端表格：时间 / 书籍 / commit / recall / faithfulness / 总分 / 判定

### diff

1. 自动定位最近两次运行的 runId（或用 `--a` `--b` 指定）
2. 读取两次的 responses + 对应历史记录
3. 逐题对比：recall / faithfulness / formatting / efficiency / latency
4. 输出 diff 表格，高亮变化超过 ±0.5 的维度

### full

1. 依次执行 generate → run → judge
2. 任一阶段 exit code ≠ 0，立即终止并 exit
3. judge 完成后输出报告路径

---

## 9. 错误处理约定

| 错误类型 | 处理方式 | 消息示例 |
|---------|---------|---------|
| 缺少 `--book` | exit 2 | `缺少必需参数：--book` |
| golden.json 已存在 | exit 1 | `golden.json 已存在，请先删除或使用 --force 覆盖` |
| responses 目录不存在 | exit 1 | `responses 目录不存在，请先运行 eval run` |
| PI Agent 超时 | exit 1 | `PI Agent 执行超时（5分钟）` |
| wdio 执行失败 | exit 1 | `wdio 执行失败，退出码 N` |
| Vault 路径无效 | exit 2 | `Vault 路径不存在：./my-vault` |

---

## 10. 依赖关系

```
eval-cli.mjs
├── eval-subcommands/
│   ├── generate.mjs    (spawn PI Agent)
│   ├── run.mjs        (spawn wdio)
│   ├── judge.mjs      (spawn PI Agent)
│   ├── history.mjs    (纯读文件)
│   ├── diff.mjs       (纯读文件)
│   └── full.mjs       (调度其他子命令)
├── eval-prompts/
│   ├── pi-generate-system-prompt.md
│   └── pi-judge-system-prompt.md
└── eval-utils.mjs     (共享：readCatalog, newRunId, writeJSON, findLatestRun 等)
```

**eval-cli.mjs 本身只做**：参数解析、子命令分发。不包含任何具体业务逻辑。

---

## 11. 部署时 prompt 同步

prompt 文件在源码 `scripts/eval/eval-prompts/`，部署时同步到 vault：

```bash
npm run eval:sync-prompts
```

```json
{
  "scripts": {
    "eval:sync-prompts": "rsync -av scripts/eval/eval-prompts/ test-vault/.eval/"
  }
}
```

也可以集成到 `deploy` script 中自动触发。

---

## 12. 验收标准

- [ ] `node scripts/eval/eval-cli.mjs --help` 输出所有子命令列表
- [ ] 每个子命令 `--help` 输出独立帮助
- [ ] `eval full --book "反脆弱"` 串行执行 generate → run → judge，任意失败则 exit 1
- [ ] `eval judge --book "反脆弱" --threshold 8.0` 分数 <8.0 返回 exit 1
- [ ] `eval diff --book "反脆弱"` 自动取最近两次运行对比
- [ ] prompt 文件在 `scripts/eval/eval-prompts/`，不在 vault 源码目录之外
- [ ] `eval run` 生成的 `runId` 唯一，不覆盖历史响应文件
