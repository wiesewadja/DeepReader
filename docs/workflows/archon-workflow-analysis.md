# Archon vs DeepReader 工作流对比分析

## 一、核心差异

| 方面 | Archon（最佳实践） | DeepReader（当前） | 差距 |
|------|-------------------|-------------------|------|
| `output_format` | ✅ 分类节点都用 | ❌ 无 | 无法精确引用上游输出 |
| 条件分支 | ✅ `when:` + `output_format` | ❌ 无 | 无法按类型路由 |
| 并行审查 | ✅ 5 个审查 agent 并行 | ❌ 单个审查 | 审查维度不全 |
| `trigger_rule` | ✅ `one_success` | ⚠️ `all_done`（错误） | 条件分支后 synthesize 会失败 |
| `context: fresh` | ✅ 适当使用 | ⚠️ 部分缺失 | 上下游上下文泄漏 |
| Command 结构 | ✅ 4 Phase + CHECKPOINT | ⚠️ 部分有 | AI 执行不稳定 |

## 二、哪些流程应该变成 Workflow

### 已有工作流（需要优化）

| 工作流 | 当前问题 | 优化方向 |
|--------|---------|---------|
| `deepreader-bugfix` | 无 `output_format`、单维度审查 | 加结构化输出、并行审查 |
| `deepreader-review` | `trigger_rule` 错误、无并行审查 | 修正 trigger_rule、加并行审查 |
| `deepreader-implement` | 无 `output_format` | 加结构化输出 |
| `deepreader-spec` | 已有交互式审批 | 保持现状 |
| `deepreader-ship` | 已有审批门 | 保持现状 |

### 缺失的工作流

| 工作流 | 用途 | 优先级 |
|--------|------|--------|
| `deepreader-test` | 专门的测试工作流（单元+E2E+冒烟） | 高 |
| `deepreader-refactor` | 安全重构（只读分析→计划→实现→验证） | 中 |
| `deepreader-diagnose` | 问题诊断（不修复，只分析） | 中 |

## 三、Workflow 组件写法对比

### 3.1 分类节点（必须有 `output_format`）

**Archon 写法**：
```yaml
- id: classify
  prompt: |
    分析 issue 类型...
    $fetch-issue.output
  model: small
  allowed_tools: []
  output_format:                    # ✅ 结构化输出
    type: object
    properties:
      issue_type:
        type: string
        enum: ["bug", "feature", "enhancement"]
      title:
        type: string
      reasoning:
        type: string
    required: [issue_type, title, reasoning]
```

**DeepReader 当前写法**：
```yaml
- id: classify
  prompt: "分类: $ARGUMENTS"        # ❌ 无 output_format
```

**改进后**：
```yaml
- id: classify
  prompt: "分类: $ARGUMENTS"
  output_format:
    type: object
    properties:
      type: { type: string, enum: ["bug", "feature", "chore"] }
      confidence: { type: number }
    required: [type]
```

### 3.2 条件分支（`when:` + `output_format`）

**Archon 写法**：
```yaml
- id: investigate
  command: archon-investigate-issue
  depends_on: [classify]
  when: "$classify.output.issue_type == 'bug'"    # ✅ 精确字段引用
  context: fresh

- id: plan
  command: archon-create-plan
  depends_on: [classify]
  when: "$classify.output.issue_type != 'bug'"    # ✅ 精确字段引用
  context: fresh
```

**DeepReader 当前写法**：无条件分支

**改进后**：
```yaml
- id: fix-bug
  command: dr-fix-bug
  depends_on: [classify]
  when: "$classify.output.type == 'bug'"
  context: fresh

- id: implement-feature
  command: dr-implement-feature
  depends_on: [classify]
  when: "$classify.output.type == 'feature'"
  context: fresh
```

### 3.3 并行审查（多维度同时审查）

**Archon 写法**：
```yaml
# 5 个审查 agent 并行
- id: code-review
  command: archon-code-review-agent
  depends_on: [classify, sync]
  when: "$classify.output.run_code_review == 'true'"

- id: error-handling
  command: archon-error-handling-agent
  depends_on: [classify, sync]
  when: "$classify.output.run_error_handling == 'true'"

- id: test-coverage
  command: archon-test-coverage-agent
  depends_on: [classify, sync]
  when: "$classify.output.run_test_coverage == 'true'"

# 综合结果
- id: synthesize
  command: archon-synthesize-review
  depends_on: [code-review, error-handling, test-coverage, ...]
  trigger_rule: one_success    # ✅ 任一成功就综合
```

**DeepReader 当前写法**：
```yaml
- id: review
  command: dr-review-code      # ❌ 单维度审查
  depends_on: [gather-changes]

- id: synthesize
  depends_on: [review]
  trigger_rule: all_done       # ❌ 错误的 trigger_rule
```

**改进后**：
```yaml
- id: security-review
  command: dr-security-review
  depends_on: [gather-changes]
  context: fresh

- id: performance-review
  command: dr-performance-review
  depends_on: [gather-changes]
  context: fresh

- id: style-review
  command: dr-style-review
  depends_on: [gather-changes]
  context: fresh

- id: synthesize
  prompt: "综合三个审查结果..."
  depends_on: [security-review, performance-review, style-review]
  trigger_rule: one_success    # ✅ 任一成功就综合
  context: fresh
```

### 3.4 条件分支后的合并

**Archon 写法**：
```yaml
- id: investigate
  when: "$classify.output.issue_type == 'bug'"
- id: plan
  when: "$classify.output.issue_type != 'bug'"

- id: implement
  depends_on: [investigate, plan]
  trigger_rule: none_failed_min_one_success    # ✅ 一个分支跳过不影响
```

**DeepReader 当前写法**：无条件分支

### 3.5 `context: fresh` 的正确使用

**Archon 写法**：
```yaml
# 需要隔离上下文时用 fresh
- id: implement
  command: archon-fix-issue
  depends_on: [bridge-artifacts]
  context: fresh    # ✅ 不携带上游对话历史

# 不需要隔离时省略（默认 shared）
- id: next-step
  prompt: "下一步..."
  depends_on: [implement]
  # 省略 context，使用 shared
```

**DeepReader 当前写法**：部分节点缺失 `context: fresh`

## 四、Command 文件写法对比

### 4.1 Frontmatter

**Archon 写法**：
```markdown
---
description: 五轴代码审查
argument-hint: <issue-number>
---
```

**DeepReader 当前写法**：部分有，部分缺失

### 4.2 CHECKPOINT

**Archon 写法**：
```markdown
## Phase 1: LOAD
...

**PHASE_1_CHECKPOINT:**
- [ ] 上下文已加载
- [ ] 关键信息已提取

## Phase 2: EXECUTE
...
```

**DeepReader 当前写法**：部分有，部分缺失

### 4.3 产物写入

**Archon 写法**：
```markdown
## Phase 3: OUTPUT

写入 `$ARTIFACTS_DIR/output.md`:

\```markdown
# 输出报告
...
\```
```

**DeepReader 当前写法**：部分有，部分缺失

## 五、推荐的 DeepReader 工作流改进计划

### 第一步：给现有工作流加 `output_format`

```yaml
# deepreader-bugfix.yaml
- id: classify
  prompt: "分类 bug 类型..."
  output_format:
    type: object
    properties:
      bug_type: { type: string, enum: ["logic", "ui"] }
      root_cause: { type: string }
    required: [bug_type, root_cause]
```

### 第二步：加条件分支

```yaml
- id: fix-logic
  command: dr-fix-logic-bug
  when: "$classify.output.bug_type == 'logic'"
  depends_on: [classify]

- id: fix-ui
  command: dr-fix-ui-bug
  when: "$classify.output.bug_type == 'ui'"
  depends_on: [classify]
```

### 第三步：加并行审查

```yaml
- id: security-review
  command: dr-security-review
  depends_on: [gather-changes]

- id: performance-review
  command: dr-performance-review
  depends_on: [gather-changes]

- id: synthesize
  prompt: "综合审查结果..."
  depends_on: [security-review, performance-review]
  trigger_rule: one_success
```

### 第四步：修正 `trigger_rule`

```yaml
# 之前（错误）
- id: synthesize
  depends_on: [review, check-bundle, typecheck, unit-tests]
  trigger_rule: all_done

# 之后（正确）
- id: synthesize
  depends_on: [review, check-bundle, typecheck, unit-tests]
  trigger_rule: none_failed_min_one_success
```

## 六、总结

| 改进项 | 优先级 | 影响 |
|--------|--------|------|
| 加 `output_format` | 高 | 下游可精确引用 |
| 加条件分支 | 高 | 按类型自动路由 |
| 加并行审查 | 中 | 审查更全面 |
| 修正 `trigger_rule` | 高 | 避免条件分支后失败 |
| 补充 CHECKPOINT | 中 | AI 执行更稳定 |
| 补充 frontmatter | 低 | 更好的可发现性 |
