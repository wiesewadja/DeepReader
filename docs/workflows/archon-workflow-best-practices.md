# Archon 工作流最佳实践

## 一、设计原则

### 1. 确定性工作用 bash/script，AI 工作用 prompt/command

```yaml
# ❌ 错误：让 AI 运行测试
- id: test
  prompt: "运行 bun run test 并告诉我是否通过"

# ✅ 正确：直接执行
- id: test
  bash: "bun run test 2>&1"

# AI 只处理需要推理的部分
- id: fix
  prompt: "修复以下测试失败:\n$test.output"
  depends_on: [test]
  trigger_rule: all_done
```

### 2. 结构化输出 + 字段引用

```yaml
# ❌ 错误：when 条件匹配自由文本
- id: classify
  prompt: "这是 bug 还是 feature？"
- id: investigate
  when: "$classify.output == 'bug'"   # AI 可能回复 "This is a bug..."

# ✅ 正确：声明 output_format
- id: classify
  prompt: "分类这个 issue"
  output_format:
    type: object
    properties:
      type: { type: string, enum: ["bug", "feature", "chore"] }
    required: [type]
- id: investigate
  when: "$classify.output.type == 'bug'"  # 精确字段访问
```

### 3. 条件分支后用正确的 trigger_rule

```yaml
# ❌ 错误：all_success 在条件分支后会失败
- id: investigate
  when: "$classify.output.type == 'bug'"
- id: plan
  when: "$classify.output.type == 'feature'"
- id: implement
  depends_on: [investigate, plan]
  # trigger_rule: all_success  ← 一个分支被跳过 = 失败

# ✅ 正确：使用 one_success 或 none_failed_min_one_success
- id: implement
  depends_on: [investigate, plan]
  trigger_rule: none_failed_min_one_success
```

### 4. context: fresh 时必须通过文件传递状态

```yaml
# ❌ 错误：假设 AI 记得上游做了什么
- id: investigate
  command: investigate-issue
- id: implement
  command: implement-fix
  context: fresh
  # AI 完全不知道 investigation 的结果

# ✅ 正确：通过 $ARTIFACTS_DIR 传递
- id: investigate
  command: investigate-issue   # 写入 $ARTIFACTS_DIR/investigation.md
- id: implement
  command: implement-fix       # 读取 $ARTIFACTS_DIR/investigation.md
  context: fresh
```

### 5. 便宜模型做路由，强模型做实现

```yaml
# 分类/路由 → 便宜模型
- id: classify
  model: haiku
  allowed_tools: []
  output_format: { ... }

# 实现/审查 → 强模型
- id: implement
  model: opus
```

---

## 二、实用模式示例

### 模式 1：简单线性流水线

```yaml
name: simple-fix
description: |
  简单修复流程：分析 → 实现 → 验证
  Triggers: "fix", "修复", "改一下"

provider: claude

nodes:
  - id: analyze
    prompt: |
      分析以下问题并制定修复方案：
      $ARGUMENTS
      
      输出到 $ARTIFACTS_DIR/analysis.md
    output_format:
      type: object
      properties:
        root_cause: { type: string }
        files_to_change: { type: array, items: { type: string } }
        approach: { type: string }

  - id: implement
    prompt: |
      根据分析结果修复代码：
      
      ## 根因
      $analyze.output.root_cause
      
      ## 需要修改的文件
      $analyze.output.files_to_change
      
      ## 修复方案
      $analyze.output.approach
    depends_on: [analyze]
    context: fresh

  - id: validate
    bash: bun run type-check && bun run lint && bun run test
    depends_on: [implement]
```

### 模式 2：并行审查 + 综合

```yaml
name: multi-review
description: |
  多维度并行审查，综合所有发现
  Triggers: "review", "审查", "检查代码"

provider: claude

nodes:
  - id: security
    prompt: "从安全角度审查 PR: $ARGUMENTS"
    output_format:
      type: object
      properties:
        issues: { type: array, items: { type: string } }
        severity: { type: string, enum: ["low", "medium", "high", "critical"] }

  - id: performance
    prompt: "从性能角度审查 PR: $ARGUMENTS"
    output_format:
      type: object
      properties:
        issues: { type: array, items: { type: string } }
        severity: { type: string, enum: ["low", "medium", "high", "critical"] }

  - id: style
    prompt: "从代码风格角度审查 PR: $ARGUMENTS"
    output_format:
      type: object
      properties:
        issues: { type: array, items: { type: string } }
        severity: { type: string, enum: ["low", "medium", "high", "critical"] }

  - id: synthesize
    prompt: |
      综合以下三个审查结果：
      
      ## 安全审查 ($security.output.severity)
      $security.output.issues
      
      ## 性能审查 ($performance.output.severity)
      $performance.output.issues
      
      ## 风格审查 ($style.output.severity)
      $style.output.issues
      
      按严重程度排序，合并重复项，给出最终报告。
    depends_on: [security, performance, style]
    context: fresh
```

### 模式 3：条件分支（bug vs feature）

```yaml
name: fix-or-feature
description: |
  根据 issue 类型自动选择处理路径
  Triggers: "fix issue", "implement feature", "处理 issue"

provider: claude

nodes:
  - id: classify
    prompt: |
      分析 GitHub issue 并分类：
      $ARGUMENTS
    output_format:
      type: object
      properties:
        type: { type: string, enum: ["bug", "feature"] }
        title: { type: string }

  - id: investigate-bug
    command: investigate-issue
    depends_on: [classify]
    when: "$classify.output.type == 'bug'"
    context: fresh

  - id: plan-feature
    command: create-plan
    depends_on: [classify]
    when: "$classify.output.type == 'feature'"
    context: fresh

  # 桥接：确保下游节点总能找到 artifact
  - id: bridge
    bash: |
      if [ -f "$ARTIFACTS_DIR/plan.md" ] && [ ! -f "$ARTIFACTS_DIR/investigation.md" ]; then
        cp "$ARTIFACTS_DIR/plan.md" "$ARTIFACTS_DIR/investigation.md"
      fi
    depends_on: [investigate-bug, plan-feature]
    trigger_rule: one_success

  - id: implement
    command: implement-fix
    depends_on: [bridge]
    context: fresh
```

### 模式 4：循环迭代（生成 → 测试 → 修复）

```yaml
name: generate-and-test
description: |
  生成代码并迭代直到测试通过
  Triggers: "生成并测试", "写代码跑测试"

provider: claude

nodes:
  - id: generate
    prompt: |
      根据需求生成代码：$ARGUMENTS
      写入对应的源文件。

  - id: fix-loop
    loop:
      prompt: |
        运行测试，如果失败则修复：
        
        上次结果: $LOOP_PREV_OUTPUT
        用户反馈: $LOOP_USER_INPUT
        
        当所有测试通过时，输出 COMPLETE。
      until: "COMPLETE"
      max_iterations: 10
      fresh_context: true
      until_bash: "bun run test"
    depends_on: [generate]
```

### 模式 5：人工审批门

```yaml
name: plan-and-approve
description: |
  制定计划，等待人工审批后再执行
  Triggers: "规划", "制定方案"
  需要 interactive: true（Web UI 审批）

provider: claude
interactive: true

nodes:
  - id: plan
    prompt: |
      制定实现计划：$ARGUMENTS
      
      写入 $ARTIFACTS_DIR/plan.md，包含：
      1. 目标
      2. 技术方案
      3. 风险点
      4. 预计改动文件

  - id: approval
    approval:
      message: "请审查上述计划，确认后继续执行"
      capture_response: true
      on_reject:
        prompt: "根据反馈修改计划: $REJECTION_REASON"
        max_attempts: 3
    depends_on: [plan]

  - id: implement
    prompt: |
      根据已批准的计划执行实现。
      审批备注: $approval.output
    depends_on: [approval]
    context: fresh
```

### 模式 6：多 Provider 混合

```yaml
name: cost-optimized
description: |
  用便宜模型做分析，贵模型做实现
  Triggers: "优化成本", "混合 provider"

nodes:
  - id: quick-analyze
    provider: pi
    model: anthropic/claude-haiku-4-5
    prompt: "快速分析需求: $ARGUMENTS"
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

### 模式 7：Agent 复用（多工作流共享 command）

```yaml
# 工作流 A：修复 issue
name: fix-issue
nodes:
  - id: review
    command: code-review-agent    # 复用审查能力
  - id: implement
    command: implement-fix        # 复用实现能力

# 工作流 B：实现 feature
name: implement-feature
nodes:
  - id: review
    command: code-review-agent    # 同一个审查 command
  - id: implement
    command: implement-plan       # 不同的实现 command
```

---

## 三、Command 文件最佳实践

### 模板结构

```markdown
---
description: 简短描述（用于 /workflow list 显示）
argument-hint: <参数提示>
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
cat $ARTIFACTS_DIR/上游产物.md
```

### 1.2 提取关键信息

从 artifact 中提取：
- 信息 A
- 信息 B

**PHASE_1_CHECKPOINT:**
- [ ] 上下文已加载
- [ ] 关键信息已提取

---

## Phase 2: EXECUTE - 执行任务

### 2.1 步骤 1

```bash
具体命令
```

### 2.2 步骤 2

AI 执行的逻辑...

---

## Phase 3: OUTPUT - 产出结果

写入 `$ARTIFACTS_DIR/output.md`:

```markdown
# 输出报告
...
```

---

## Success Criteria

- **ARTIFACT_WRITTEN**: 产物已写入
- **VALIDATION_PASSED**: 验证通过
```

### 关键原则

1. **明确说明从哪里读取 artifact** — `context: fresh` 节点没有上游记忆
2. **用 checkpoint 标记阶段** — 方便调试和日志分析
3. **定义明确的成功标准** — AI 知道什么算完成
4. **写入结构化 artifact** — 下游节点可以精确引用

---

## 四、调试技巧

### 1. 验证工作流

```bash
archon validate workflows my-workflow
```

### 2. 检查运行日志

```bash
# 查看最近运行
archon workflow runs

# 查看详细日志
cat ~/.archon/workspaces/<owner>/<repo>/logs/<run-id>.jsonl | jq .

# 查看产物
ls ~/.archon/workspaces/<owner>/<repo>/artifacts/runs/<run-id>/
```

### 3. 从小处开始

```yaml
# 先用简单输入测试
archon workflow run my-workflow --branch test/sanity "hello"
```

### 4. 检查节点输出

```bash
# 查看特定节点的输出
cat ~/.archon/workspaces/<owner>/<repo>/artifacts/runs/<run-id>/<node-id>.md
```

---

## 五、常见错误

| 错误 | 原因 | 修复 |
|------|------|------|
| `when:` 条件不生效 | 没有 `output_format` | 添加 `output_format` 声明 schema |
| 条件分支后节点失败 | `trigger_rule: all_success` | 改为 `one_success` 或 `none_failed_min_one_success` |
| `context: fresh` 节点无上下文 | 假设 AI 记得上游 | 通过 `$ARTIFACTS_DIR` 传递状态 |
| Approval 节点在 Web UI 不显示 | 缺少 `interactive: true` | 在 workflow 级别添加 `interactive: true` |
| Loop 节点设置 `retry` | 不支持 | 删除 `retry`，在 loop prompt 中处理重试 |
| `allowed_tools: []` 导致 MCP 不可用 | MCP 工具也被禁用 | Archon 自动添加 MCP 通配符，无需手动处理 |
