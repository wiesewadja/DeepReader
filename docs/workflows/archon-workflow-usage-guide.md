# Archon 工作流使用指南

## 一、快速开始

### 1.1 什么是工作流

工作流是一系列 AI 任务的有序执行。你用 YAML 定义"做什么"和"怎么做"，Archon 负责调度执行。

**最小工作流**：

```yaml
name: hello
description: "最简单的例子"
provider: claude

nodes:
  - id: say-hello
    prompt: "说你好"
```

运行：

```bash
archon workflow run hello "Hello World"
```

### 1.2 文件结构

```
.archon/
├── workflows/          # 工作流定义（YAML）
│   └── my-workflow.yaml
├── commands/           # Command 文件（markdown，可复用）
│   └── my-command.md
├── scripts/            # Script 节点的代码文件
│   └── my-script.ts
└── config.yaml         # 项目级配置
```

---

## 二、核心概念

### 2.1 节点类型

每个节点只能选一种（互斥）：

| 类型 | 字段 | 用途 | 有 AI |
|------|------|------|-------|
| `prompt:` | 内联文本 | 简单 AI 任务 | ✅ |
| `command:` | 文件名 | 复杂可复用逻辑 | ✅ |
| `bash:` | shell 脚本 | 确定性操作 | ❌ |
| `script:` | TS/Python | 复杂数据处理 | ❌ |
| `loop:` | 循环配置 | 迭代直到完成 | ✅ |
| `approval:` | 审批配置 | 人工审查门 | ❌ |
| `cancel:` | 取消原因 | 终止工作流 | ❌ |

### 2.2 依赖与并行

```yaml
nodes:
  - id: a              # 无依赖，立即执行
    prompt: "..."

  - id: b              # 依赖 a，等 a 完成后执行
    prompt: "..."
    depends_on: [a]

  - id: c              # 依赖 a，等 a 完成后执行
    prompt: "..."
    depends_on: [a]

  # b 和 c 在同一层，并行执行
```

### 2.3 变量替换

| 变量 | 说明 |
|------|------|
| `$ARGUMENTS` / `$USER_MESSAGE` | 用户输入 |
| `$WORKFLOW_ID` | 运行 ID |
| `$ARTIFACTS_DIR` | 产物目录（已预创建） |
| `$BASE_BRANCH` | 基础分支（git 自动检测） |
| `$DOCS_DIR` | 文档目录（默认 `docs/`） |
| `$CONTEXT` / `$ISSUE_CONTEXT` | GitHub issue/PR 上下文 |
| `$nodeId.output` | 上游节点完整输出 |
| `$nodeId.output.field` | 结构化输出的字段 |
| `$LOOP_USER_INPUT` | 循环节点用户输入 |
| `$REJECTION_REASON` | 审批拒绝原因 |
| `$LOOP_PREV_OUTPUT` | 上次循环迭代输出 |

**转义**：用 `\$` 产生字面量 `$`。

### 2.4 结构化输出

```yaml
- id: classify
  prompt: "分类这个 issue"
  output_format:
    type: object
    properties:
      type: { type: string, enum: ["bug", "feature"] }
      confidence: { type: number }
    required: [type]

# 下游引用
- id: implement
  when: "$classify.output.type == 'bug'"
```

### 2.5 条件执行

```yaml
- id: investigate
  when: "$classify.output.type == 'bug'"

- id: plan
  when: "$classify.output.type != 'bug'"
```

支持 `==`, `!=`, `&&`, `||`, `()` 等表达式。

### 2.6 触发规则

| 规则 | 含义 |
|------|------|
| `all_success`（默认） | 所有上游成功才执行 |
| `one_success` | 任一上游成功就执行 |
| `none_failed_min_one_success` | 没有失败 + 至少一个成功 |
| `all_done` | 所有上游完成（不论成功失败） |

---

## 三、节点类型详解

### 3.1 Command 节点

```yaml
- id: review
  command: code-review-agent    # 加载 .archon/commands/code-review-agent.md
  context: fresh
  model: opus
```

### 3.2 Prompt 节点

```yaml
- id: classify
  prompt: "分类这个 issue: $ARGUMENTS"
  model: haiku
  allowed_tools: []
  output_format:
    type: object
    properties:
      type: { type: string, enum: ["bug", "feature"] }
```

### 3.3 Bash 节点

```yaml
- id: fetch
  bash: |
    gh issue view $ARGUMENTS --json title,body
  timeout: 15000
  depends_on: [classify]
```

**注意**：`$nodeId.output` 在 bash 中自动 shell 转义（单引号包裹）。

### 3.4 Script 节点（TS/Python）

```yaml
# TypeScript（通过 bun）
- id: transform
  script: |
    const data = JSON.parse(process.argv[2] || '{}');
    console.log(JSON.stringify({ result: data.value * 2 }));
  runtime: bun
  timeout: 30000

# Python（通过 uv）
- id: analyze
  script: |
    import json, sys
    data = json.loads(sys.argv[1] if len(sys.argv) > 1 else '{}')
    print(json.dumps({"score": len(str(data))}))
  runtime: uv
  deps: ["pandas>=2.0"]    # uv 依赖
  timeout: 60000
```

**关键区别**：`$nodeId.output` 在 script 中**不**做 shell 转义，可直接赋值：
```typescript
const data = $nodeId.output;  // ✅ JSON 是合法 JS 表达式
// ❌ String.raw`$nodeId.output`  ← 输出含反引号时会崩溃
```

### 3.5 Loop 节点

```yaml
- id: fix-loop
  loop:
    prompt: |
      运行测试，修复失败：
      上次结果: $LOOP_PREV_OUTPUT
      用户反馈: $LOOP_USER_INPUT
      
      测试通过时输出 COMPLETE。
    until: "COMPLETE"
    max_iterations: 10
    fresh_context: true
    until_bash: "bun run test"    # 可选：每次迭代后运行
    interactive: false            # true = 每次暂停等用户
    gate_message: "继续？"        # interactive=true 时必填
  depends_on: [generate]
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| `until` | AI 输出包含此字符串时停止 |
| `max_iterations` | 最大迭代次数（必填） |
| `fresh_context` | 每次迭代新会话（默认 false） |
| `until_bash` | 每次迭代后运行，exit 0 = 完成 |
| `interactive` | 每次迭代暂停等用户输入 |
| `gate_message` | 暂停时显示的消息 |

### 3.6 Approval 节点

```yaml
- id: review-gate
  approval:
    message: "请审查上述计划"
    capture_response: true      # 用户回复存为 $review-gate.output
    on_reject:                  # 拒绝时的重试
      prompt: "根据反馈修改: $REJECTION_REASON"
      max_attempts: 3           # 1-10
  depends_on: [plan]
```

**注意**：需要在 workflow 级别设置 `interactive: true` 才能在 Web UI 显示。

### 3.7 Cancel 节点

```yaml
- id: abort
  cancel: "Issue 不存在，终止工作流"
  depends_on: [classify]
  when: "$classify.output.exists == 'false'"
```

---

## 四、实战示例

### 4.1 简单修复流程

```yaml
name: simple-fix
description: |
  简单修复：分析 → 实现 → 验证
  Triggers: "fix", "修复"

provider: claude

nodes:
  - id: analyze
    prompt: |
      分析问题并制定方案：
      $ARGUMENTS
      
      输出到 $ARTIFACTS_DIR/analysis.md
    output_format:
      type: object
      properties:
        root_cause: { type: string }
        files: { type: array, items: { type: string } }
        approach: { type: string }

  - id: implement
    prompt: |
      修复代码：
      根因: $analyze.output.root_cause
      文件: $analyze.output.files
      方案: $analyze.output.approach
    depends_on: [analyze]
    context: fresh

  - id: validate
    bash: bun run type-check && bun run lint && bun run test
    depends_on: [implement]
```

### 4.2 并行审查

```yaml
name: review
description: "多维度并行审查"
provider: claude

nodes:
  - id: security
    prompt: "安全审查: $ARGUMENTS"
    output_format:
      type: object
      properties:
        issues: { type: array, items: { type: string } }
        severity: { type: string }

  - id: performance
    prompt: "性能审查: $ARGUMENTS"
    output_format:
      type: object
      properties:
        issues: { type: array, items: { type: string } }
        severity: { type: string }

  - id: style
    prompt: "风格审查: $ARGUMENTS"
    output_format:
      type: object
      properties:
        issues: { type: array, items: { type: string } }
        severity: { type: string }

  - id: synthesize
    prompt: |
      综合三个审查结果：
      安全: $security.output.issues
      性能: $performance.output.issues
      风格: $style.output.issues
    depends_on: [security, performance, style]
    context: fresh
```

### 4.3 条件分支（bug vs feature）

```yaml
name: route-by-type
description: "按类型自动选择路径"
provider: claude

nodes:
  - id: classify
    prompt: "分类: $ARGUMENTS"
    output_format:
      type: object
      properties:
        type: { type: string, enum: ["bug", "feature"] }

  - id: fix-bug
    prompt: "修复 bug: $ARGUMENTS"
    depends_on: [classify]
    when: "$classify.output.type == 'bug'"

  - id: implement-feature
    prompt: "实现 feature: $ARGUMENTS"
    depends_on: [classify]
    when: "$classify.output.type == 'feature'"

  - id: done
    prompt: "完成"
    depends_on: [fix-bug, implement-feature]
    trigger_rule: none_failed_min_one_success
```

### 4.4 循环迭代（生成 → 测试 → 修复）

```yaml
name: generate-test-fix
description: "生成代码并迭代直到测试通过"
provider: claude

nodes:
  - id: generate
    prompt: "生成代码: $ARGUMENTS"

  - id: fix-loop
    loop:
      prompt: |
        运行测试，修复失败：
        上次结果: $LOOP_PREV_OUTPUT
        
        测试通过时输出 COMPLETE。
      until: "COMPLETE"
      max_iterations: 10
      fresh_context: true
      until_bash: "bun run test"
    depends_on: [generate]
```

### 4.5 人工审批门

```yaml
name: plan-approve-implement
description: "计划 → 审批 → 实现"
provider: claude
interactive: true

nodes:
  - id: plan
    prompt: |
      制定计划：$ARGUMENTS
      写入 $ARTIFACTS_DIR/plan.md

  - id: approval
    approval:
      message: "请审查计划"
      capture_response: true
      on_reject:
        prompt: "根据反馈修改: $REJECTION_REASON"
        max_attempts: 3
    depends_on: [plan]

  - id: implement
    prompt: |
      执行计划。
      审批备注: $approval.output
    depends_on: [approval]
    context: fresh
```

### 4.6 多 Provider 混合

```yaml
name: cost-optimized
description: "便宜模型分析，贵模型实现"

nodes:
  - id: quick-analyze
    provider: pi
    model: anthropic/claude-haiku-4-5
    prompt: "快速分析: $ARGUMENTS"
    output_format:
      type: object
      properties:
        summary: { type: string }
        complexity: { type: string, enum: ["low", "high"] }

  - id: deep-implement
    provider: claude
    model: opus
    prompt: "实现: $quick-analyze.output.summary"
    when: "$quick-analyze.output.complexity == 'high'"
    depends_on: [quick-analyze]
    context: fresh

  - id: simple-implement
    provider: codex
    model: gpt-5.3-codex
    prompt: "实现: $quick-analyze.output.summary"
    when: "$quick-analyze.output.complexity == 'low'"
    depends_on: [quick-analyze]
    context: fresh
```

### 4.7 Agent 子代理（Claude 独有）

```yaml
name: multi-agent-analysis
description: "使用子代理并行分析"
provider: claude

nodes:
  - id: analyze
    prompt: |
      使用子代理分析代码库的不同方面。
      通过 Task 工具调用对应的子代理。
    agents:
      security-scanner:
        description: "扫描安全漏洞"
        prompt: "执行 OWASP top-10 风格检查"
        model: haiku
        tools: [Read, Grep, Glob]
        maxTurns: 5
      test-coverage:
        description: "检查测试覆盖率"
        prompt: "识别没有测试覆盖的代码路径"
        model: haiku
        tools: [Read, Grep, Glob]
        maxTurns: 5
```

**agents 字段说明**：

| 字段 | 必填 | 说明 |
|------|------|------|
| `description` | 是 | Claude 决定委派时显示 |
| `prompt` | 是 | 子代理的系统提示 |
| `model` | 否 | 模型覆盖 |
| `tools` | 否 | 工具白名单 |
| `disallowedTools` | 否 | 工具黑名单 |
| `skills` | 否 | 注入的 skill |
| `maxTurns` | 否 | 最大对话轮次 |

**命名规则**：小写 kebab-case（如 `security-scanner`）。

---

## 五、Command 文件编写

### 5.1 文件位置与优先级

```
<repoRoot>/.archon/commands/     # 1. 项目级（最高优先）
├── my-command.md
├── archon-assist.md             #    覆盖内置默认
└── triage/                      #    支持 1 级子文件夹
    └── review.md                #    解析为 'review'

~/.archon/commands/              # 2. 全局级（用户级，跨项目共享）
├── review-checklist.md
└── pr-style-guide.md

<bundled defaults>                # 3. 内置默认（随 Archon 发布）
```

**解析规则**：
- 文件名（不含 `.md`）就是 command 名称
- 同名文件：项目级 > 全局级 > 内置
- 子文件夹支持 1 级（`triage/review.md` → `review`）

### 5.2 完整模板

```markdown
---
description: 简短描述（显示在 /workflow list 中）
argument-hint: <issue-number> 或 (no arguments)
---

# 命令标题

**Input**: $ARGUMENTS
**Workflow ID**: $WORKFLOW_ID

---

## Your Mission

一句话说明这个命令要做什么。

---

## Phase 1: LOAD - 加载上下文

### 1.1 读取上游 artifact

```bash
cat $ARTIFACTS_DIR/investigation.md
```

### 1.2 提取关键信息

从 artifact 中提取：
- 问题根因
- 需要修改的文件
- 实现方案

**PHASE_1_CHECKPOINT:**
- [ ] 上下文已加载
- [ ] 关键信息已提取

---

## Phase 2: EXECUTE - 执行任务

### 2.1 检查代码现状

```bash
cat src/example.ts
```

### 2.2 实现修改

根据方案修改代码...

---

## Phase 3: VALIDATE - 验证

```bash
bun run type-check
bun run test
```

**PHASE_3_CHECKPOINT:**
- [ ] 类型检查通过
- [ ] 测试通过

---

## Phase 4: OUTPUT - 产出结果

写入 `$ARTIFACTS_DIR/implementation.md`:

```markdown
# 实现报告

## 修改的文件
- src/example.ts: 修复了 xxx 问题

## 验证结果
- 类型检查: ✅
- 测试: ✅ 12 个通过
```

---

## Success Criteria

- **CODE_MODIFIED**: 代码已修改
- **TESTS_PASS**: 测试通过
- **ARTIFACT_WRITTEN**: 产物已写入
```

### 5.3 产物约定

| 文件名 | 用途 |
|--------|------|
| `$ARTIFACTS_DIR/plan.md` | 实现计划 |
| `$ARTIFACTS_DIR/investigation.md` | Bug 调查结果 |
| `$ARTIFACTS_DIR/implementation.md` | 实现总结 |
| `$ARTIFACTS_DIR/validation.md` | 测试/lint 结果 |
| `$ARTIFACTS_DIR/pr-body.md` | PR 描述内容 |
| `$ARTIFACTS_DIR/.pr-number` | PR 编号（元数据） |
| `$ARTIFACTS_DIR/.pr-url` | PR URL（元数据） |
| `$ARTIFACTS_DIR/review/` | 审查报告子目录 |

### 5.4 在工作流中引用

```yaml
nodes:
  - id: review
    command: my-command       # 加载 .archon/commands/my-command.md
    depends_on: [implement]
```

---

## 六、Skill 指定

### 6.1 什么是 Skill

Skill 是注入到 AI 上下文的领域知识文件（`.claude/skills/*/SKILL.md`）。它让 AI 知道如何使用特定工具或遵循特定模式。

### 6.2 在工作流中指定 Skill

```yaml
- id: generate-remotion
  prompt: "创建 Remotion 动画: $ARGUMENTS"
  skills:
    - remotion-best-practices    # 注入 remotion skill 的知识
  allowed_tools: [Read, Write, Edit, Glob]
```

**效果**：
- Skill 内容注入到 AI 上下文
- `Skill` 工具自动添加到 allowed_tools
- AI 获得预加载 skill 的系统提示

### 6.3 Skill 来源

```
.claude/skills/              # 项目级
├── remotion-best-practices/
│   └── SKILL.md
└── my-custom-skill/
    └── SKILL.md

~/.claude/skills/            # 全局级（用户级）
├── agent-browser/
│   └── SKILL.md
└── playwright-cli/
    └── SKILL.md
```

### 6.4 安装 Skill

```bash
# 从 skills.sh 市场安装
npx skills add remotion-dev/skills

# 手动创建
mkdir -p .claude/skills/my-skill
# 编写 .claude/skills/my-skill/SKILL.md
```

### 6.5 Skill + MCP 组合

```yaml
# Skill 提供知识，MCP 提供能力
- id: github-triage
  prompt: "分诊 GitHub issues"
  skills:
    - github-triage-guide       # 知识：如何分诊
  mcp: .archon/mcp/github.json  # 能力：GitHub API
  allowed_tools: []              # MCP 工具自动添加
```

---

## 七、高级功能（Hooks / MCP / 工具限制）

### 7.1 Hooks（Claude 独有）

拦截工具调用，添加审批/拒绝/上下文注入：

```yaml
- id: safe-implement
  prompt: "实现功能"
  hooks:
    PreToolUse:
      - matcher: "Write|Edit"          # 匹配 Write 和 Edit 工具
        response:
          hookSpecificOutput:
            hookEventName: PreToolUse
            permissionDecision: ask     # 每次写入前询问用户
            permissionDecisionReason: "请确认写入操作"
    PostToolUse:
      - matcher: "Read"
        response:
          systemMessage: "你刚读了一个文件。专注于分析，不要修改任何内容。"
```

**常见模式**：

```yaml
# 只读分析节点：拒绝所有写操作
hooks:
  PreToolUse:
    - matcher: "Write|Edit|Bash"
      response:
        hookSpecificOutput:
          hookEventName: PreToolUse
          permissionDecision: deny
          permissionDecisionReason: "只读分析节点"

# 紧急停止：禁止 shell 访问
hooks:
  PreToolUse:
    - matcher: "Bash"
      response:
        continue: false
        stopReason: "不允许 shell 访问"
```

### 7.2 MCP 服务器（Claude 独有）

外部工具服务器配置：

```yaml
# JSON 配置文件
# .archon/mcp/github.json
{
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
}
```

```yaml
# 在节点中引用
- id: github-ops
  prompt: "操作 GitHub"
  mcp: .archon/mcp/github.json
  allowed_tools: []              # MCP 工具自动添加
```

**支持类型**：`stdio`、`sse`、`http`

**环境变量扩展**：`$VAR_NAME` 在执行时从 `process.env` 展开

### 7.3 工具限制

```yaml
# 只允许特定工具
- id: analyze
  prompt: "分析代码"
  allowed_tools: [Read, Grep, Glob]

# 禁止特定工具
- id: review
  prompt: "审查代码"
  denied_tools: [Write, Edit, Bash]

# 只用 MCP 工具
- id: notify
  prompt: "发送通知"
  mcp: .archon/mcp/ntfy.json
  allowed_tools: []
```

### 7.4 重试配置

```yaml
- id: deploy
  bash: "deploy.sh"
  retry:
    max_attempts: 3              # 1-5 次
    delay_ms: 5000               # 初始延迟，每次翻倍
    on_error: all                # 'transient'=仅暂时错误，'all'=所有错误
```

**错误分类**：
- `FATAL`: 认证失败、权限不足 → 永不重试
- `TRANSIENT`: 超时、限流、网络错误 → 默认重试
- `UNKNOWN`: 其他错误 → 仅 `on_error: all` 时重试

### 7.5 空闲超时

```yaml
- id: long-running
  command: full-analysis
  idle_timeout: 600000           # 10 分钟无输出则中止
```

---

## 八、Provider 配置与高级选项

### 8.1 Provider 配置

```bash
# 方式 1: 环境变量
export ANTHROPIC_API_KEY=sk-ant-xxx
export OPENAI_API_KEY=sk-xxx

# 方式 2: .env 文件
echo 'ANTHROPIC_API_KEY=sk-ant-xxx' >> .env

# 方式 3: Web UI（需开启 Web Auth + TOKEN_ENCRYPTION_KEY）
# Settings → AI Provider Keys
```

### 8.2 工作流级配置

```yaml
name: my-workflow
provider: claude              # 默认 provider
model: medium                 # 默认模型
interactive: true             # 需要审批门时必须设 true

worktree:
  enabled: true               # 强制 worktree 隔离
  # enabled: false            # 强制 live checkout（只读工作流）
  # omitted                  # 按调用方默认

persist_sessions: false       # 跨运行会话持久化
mutates_checkout: false       # 允许并发运行
tags: [fix, github]
requires: [github]            # 需要用户连接 GitHub
```

### 8.3 节点级覆盖

```yaml
nodes:
  - id: classify
    provider: pi              # 覆盖默认 provider
    model: anthropic/claude-haiku-4-5
    prompt: "..."

  - id: implement
    provider: claude
    model: opus
    prompt: "..."
```

### 8.4 Claude SDK 高级选项

```yaml
nodes:
  - id: deep-analysis
    prompt: "深度分析"
    effort: high              # low / medium / high / max
    thinking: adaptive        # adaptive / enabled / disabled
    # thinking: { type: 'enabled', budgetTokens: 8000 }
    fallbackModel: claude-haiku-4-5-20251001
    betas: ['context-1m-2025-08-07']   # 1M 上下文
    maxBudgetUsd: 0.50        # 成本上限
    systemPrompt: "你是一个安全专家..."  # 系统提示覆盖
    sandbox:
      enabled: true
      network:
        allowedDomains: ['api.github.com']
      filesystem:
        denyWrite: ['/etc', '/usr']
```

### 8.5 Codex 特定选项

```yaml
# workflow 级别
modelReasoningEffort: medium   # minimal / low / medium / high / xhigh
webSearchMode: live             # disabled / cached / live
additionalDirectories:
  - /path/to/other/repo

# 节点级别
- id: codex-node
  provider: codex
  model: gpt-5.3-codex
  prompt: "..."
```

### 8.6 Provider 能力对比

| 特性 | Claude | Codex | Pi |
|------|--------|-------|-----|
| `command`/`prompt`/`loop` | ✅ | ✅ | ✅ |
| `bash`/`script` | ✅ | ✅ | ✅ |
| `output_format` | 强制 | 强制 | 尽力 |
| `allowed_tools`/`denied_tools` | ✅ | ❌ | ❌ |
| `hooks` | ✅ | ❌ | ❌ |
| `mcp`（per-node） | ✅ | 全局 | ❌ |
| `skills`（per-node） | ✅ | 全局 | ❌ |
| `agents`（子代理） | ✅ | ❌ | ❌ |
| `effort`/`thinking` | ✅ | 用 `modelReasoningEffort` | ✅ |
| `maxBudgetUsd` | ✅ | ❌ | ❌ |
| `sandbox` | ✅ | ❌ | ❌ |
| 模型命名 | `haiku`/`sonnet`/`opus` | Codex 模型 ID | `<vendor>/<model>` |

---

## 九、参数速查表

### 9.1 参数 × 节点类型矩阵

| 参数 | command | prompt | bash | script | loop | approval | cancel |
|------|:-------:|:------:|:----:|:------:|:----:|:--------:|:------:|
| `id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `depends_on` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `when` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `trigger_rule` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `model`/`provider` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `context` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `output_format` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `allowed_tools`/`denied_tools` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `hooks` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `mcp` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `skills` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `agents` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `retry` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| `effort`/`thinking`/`sandbox` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `timeout` | — | — | ✅ | ✅ | — | — | — |
| `idle_timeout` | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |

**❌ = 静默忽略**（loader 发出警告但不报错）

### 9.2 按意图选参数

| 我想... | 用这个 |
|---------|--------|
| 控制单节点成本 | `model: haiku`, `maxBudgetUsd: 0.50`, `effort: low` |
| 纯推理（不用工具） | `allowed_tools: []` |
| 只读分析 | `denied_tools: [Write, Edit, Bash]` |
| 基于上游输出路由 | 上游 `output_format` + 下游 `when:` |
| 条件分支后合并 | `trigger_rule: none_failed_min_one_success` |
| 并行执行两个分支 | 两个节点无共享 `depends_on` |
| 迭代直到测试通过 | `loop: {until_bash: "bun run test", max_iterations: N}` |
| 迭代中无记忆泄漏 | `loop: {fresh_context: true}` + 状态写 `$ARTIFACTS_DIR` |
| 迭代中等用户反馈 | `loop: {interactive: true, gate_message: "..."}` + workflow `interactive: true` |
| 单次人工审批 | `approval:` 节点 + `on_reject` |
| 上游输出不对就终止 | `cancel:` 节点 + `when:` |
| 每次文件编辑后强制验证 | `hooks.PostToolUse` + `matcher: "Write\|Edit"` |
| 给节点注入领域知识 | `skills: [skill-name]` |
| 给节点外部工具 | `mcp: .archon/mcp/server.json` |
| 重试不稳定 API | `retry: {max_attempts: 3, delay_ms: 2000}` |
| 节点内运行 Python | `script:` + `runtime: uv` + `deps: [...]` |
| 节点内运行 TypeScript | `script:` + `runtime: bun` |
| 混合 provider | workflow 级 `provider: claude`，节点级 `provider: codex` |
| 节点用不同模型 | 节点级 `model:` 覆盖 |
| 强制 worktree 隔离 | workflow 级 `worktree: {enabled: true}` |
| 只读工作流 | workflow 级 `worktree: {enabled: false}` |

---

## 十、静默忽略（不会报错但不生效）

以下情况**不会报错**，但功能不生效：

| 情况 | 后果 |
|------|------|
| `model`/`provider` 在 loop 节点 | 忽略（loop 是控制器） |
| `hooks`/`mcp`/`skills` 在 bash/script/loop 节点 | 忽略 |
| `context: fresh` 在 loop 节点 | 忽略（用 `loop.fresh_context: true`） |
| `output_format` 在 bash/script 节点 | 接受但不生效 |
| 未知 `$nodeId.output` 引用 | 空字符串 + 警告 |
| 无效 `when:` 表达式 | 节点静默跳过 |
| `allowed_tools`/`denied_tools` 在 Codex 节点 | 忽略 |
| `retry` 在 loop 节点 | **硬错误**（唯一会报错的情况） |
| `interactive: true` 在节点但 workflow 无 `interactive: true` | Web UI 不显示审批门 |

---

## 十一、环境变量注入

### 11.1 项目级环境变量

在 `.archon/config.yaml` 中配置：

```yaml
env:
  DATABASE_URL: "postgresql://..."
  API_KEY: "xxx"
```

或通过 Web UI：Settings → Projects → Env Vars

### 11.2 注入范围

环境变量会注入到以下节点的子进程环境：
- `bash:` 节点
- `script:` 节点（`runtime: bun` 或 `runtime: uv`）
- AI provider 的会话环境

### 11.3 MCP 中的环境变量

MCP 配置中的 `$VAR_NAME` 在执行时展开：

```json
{
  "github": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": { "GITHUB_TOKEN": "$GITHUB_TOKEN" }
  }
}
```

---

## 十二、交互式工作流

### 12.1 什么是交互式工作流

交互式工作流在执行过程中暂停，等待用户输入。需要在 workflow 级别设置 `interactive: true`。

**典型场景**：
- `approval:` 节点等待用户审批
- `loop:` 节点的 `interactive: true` 模式

### 12.2 运行交互式工作流

```bash
# 运行
archon workflow run my-interactive-workflow "参数"

# 查看状态（paused = 等待用户输入）
archon workflow status

# 批准并提供反馈
archon workflow approve <run-id> "你的反馈"

# 拒绝
archon workflow reject <run-id> "拒绝原因"
```

### 12.3 Web UI 中的交互

Web UI 自动处理交互：
1. 工作流暂停时，审批消息显示在聊天中
2. 用户点击批准/拒绝按钮
3. 工作流继续执行

---

## 十三、故障排查

### 13.1 常见错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `No base branch could be resolved` | 未设置基础分支 | 设置 `worktree.baseBranch: main` 或 `--from main` |
| `Claude Code not found` | 未安装 Claude CLI | `curl -fsSL https://claude.ai/install.sh \| bash` |
| `when:` 条件不生效 | 缺少 `output_format` | 添加 `output_format` 声明 schema |
| 条件分支后节点失败 | `trigger_rule: all_success` | 改为 `one_success` 或 `none_failed_min_one_success` |
| `context: fresh` 无上下文 | 假设 AI 有记忆 | 通过 `$ARTIFACTS_DIR` 传递状态 |
| Approval 不显示 | 缺少 `interactive: true` | 在 workflow 级别添加 |
| Loop 节点报错 | 设置了 `retry` | 删除 `retry` |
| 成本过高 | 所有节点用大模型 | 分类用 `model: haiku`，实现用 `model: opus` |
| MCP 工具不可用 | `allowed_tools: []` 禁用了所有工具 | Archon 自动添加 MCP 通配符，通常不需要处理 |

### 13.2 日志位置

```bash
# JSONL 执行日志
~/.archon/workspaces/<owner>/<repo>/logs/<run-id>.jsonl

# 产物目录
~/.archon/workspaces/<owner>/<repo>/artifacts/runs/<run-id>/
```

### 13.3 查看日志

```bash
# 格式化查看
cat ~/.archon/workspaces/<owner>/<repo>/logs/<run-id>.jsonl | jq .

# 只看错误
cat ~/.archon/workspaces/<owner>/<repo>/logs/<run-id>.jsonl | \
  jq 'select(.type == "node_error" or .type == "workflow_error")'

# 查看最后一条 AI 消息
jq 'select(.type == "assistant") | .content' <log-file> | tail -1

# 只看节点状态变化
cat ~/.archon/workspaces/<owner>/<repo>/logs/<run-id>.jsonl | \
  jq 'select(.type | startswith("node_")) | {ts, type, step, content}'
```

---

## 十四、运行与调试

### 14.1 运行命令

```bash
# 基本运行
archon workflow run <name> "参数"

# 指定分支（推荐，隔离环境）
archon workflow run <name> --branch feat/my-feature "参数"

# 后台运行
archon workflow run <name> --branch feat/my-feature "参数" --detach
```

### 14.2 查看状态

```bash
# 活跃运行
archon workflow status

# 最近运行
archon workflow runs

# 单个运行详情
archon workflow get <run-id>
```

### 14.3 验证工作流

```bash
archon validate workflows my-workflow
```

### 14.4 从小处开始

```bash
# 先用简单输入测试
archon workflow run my-workflow --branch test/sanity "hello"
```

### 14.5 恢复失败运行

```bash
archon workflow resume <run-id>
```

### 14.6 取消运行

```bash
archon workflow abandon <run-id>
```

### 14.7 Web UI 监控

```bash
bun run dev   # 访问 http://localhost:5173
```

提供：运行列表、DAG 可视化、实时 SSE 推送、日志和产物查看。
