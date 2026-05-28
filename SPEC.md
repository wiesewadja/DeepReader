# deepreader-bugfix — Bug 修复工作流

> 版本：2026.05.28 | 状态：DRAFT

## 目标

设计一个独立的 Archon 工作流 `deepreader-bugfix`，用于快速修复 DeepReader 插件的 bug。任何人可以触发，核心原则是**测试优先 + 分流处理**：

- **可单元测试的 bug**（逻辑、数据、API）：写失败测试 → 自动化修复循环 → 验证通过
- **UI bug**：生成手动测试步骤 + E2E 辅助确认 → 用户在 test-vault 验证

相比完整的 feature 工作流（spec → plan → implement → review），bugfix 工作流省略需求探索和计划阶段，直接进入"复现→修复→验证"循环，缩短从发现问题到修复合并的路径。

## 架构

### 涉及的模块/文件

| 文件 | 类型 | 说明 |
|------|------|------|
| `.archon/workflows/deepreader-bugfix.yaml` | 新增 | 工作流 DAG 定义 |
| `.archon/commands/dr-reproduce-bug.md` | 新增 | Phase 1 命令：分析 bug + 分流 |
| `.archon/commands/dr-fix-bug.md` | 新增 | Phase 2 命令：实现修复（仅逻辑 bug） |
| `.archon/commands/dr-verify-ui-bug.md` | 新增 | Phase 2 命令：UI bug 验证（E2E + 手动） |

不修改任何现有工作流或命令文件。

### 工作流 DAG

```
detect-bug-type → reproduce → [分流]
                                    │
                    ┌───────────────┴───────────────┐
                    ↓                               ↓
              [逻辑 Bug]                      [UI Bug]
              fix-loop → verify → deploy      verify-ui → deploy
                    ↑                               ↑
               (max 10 轮)                    (E2E/手动)
```

### 关键接口设计

工作流输入参数：
```yaml
arguments:
  bug_description:
    description: "Bug 描述：复现步骤、预期行为、实际行为"
    required: true
```

### Bug 类型分流判断

| 类型 | 判断依据 | 修复路径 |
|------|---------|---------|
| **逻辑 Bug** | 可通过单元测试复现，输出可断言 | reproduce → fix-loop → verify → deploy |
| **UI Bug** | 涉及 DOM 渲染、样式、交互、截图差异 | reproduce → verify-ui → deploy |

分流由 `dr-reproduce-bug` 在分析 bug 后自行判断，写入 `$ARTIFACTS_DIR/reproduce.md` 的 `bug_type` 字段。

## 各 Phase 设计

### Phase 1: detect-bug-type（自动）

**节点类型**: bash（内联判断）
**判断逻辑**：
```bash
# 如果 bug 描述中包含以下关键词，倾向于 UI bug
echo "$bug_description" | grep -iE "样式|显示|渲染|颜色|布局|点击|滚动|动画|截图"
```

实际判断由 `dr-reproduce-bug` 命令根据代码分析结果最终决定。

### Phase 2: reproduce（交互式）

**节点类型**: command
**命令**: `dr-reproduce-bug`
**模型**: sonnet
**交互**: true（需要用户审批 bug 类型和复现方案）

行为：
1. 读取 `.project-rules/` 了解项目架构
2. 根据 `bug_description` 定位相关代码文件
3. 分析 bug 根因
4. **判断 bug 类型**：
   - **逻辑 Bug**：编写**失败测试**（Vitest 格式，放在 `src/**/__tests__/` 目录）
   - **UI Bug**：生成**手动测试步骤**文档 + 尝试 E2E 截图测试
5. 输出分析报告，暂停等待用户审批

输出到 `$ARTIFACTS_DIR/reproduce.md`：
```yaml
bug_type: logic | ui  # 必须字段
root_cause: xxx
affected_files: [file1, file2]
test_file: path/to/test.test.ts  # 仅逻辑 bug
manual_test_steps: |              # 仅 UI bug
  1. 打开 Vault
  2. 导航到...
  3. 预期看到...
e2e_test: path/to/e2e.spec.ts  # 如果尝试了 E2E
```

审批：用户确认 bug 类型和复现方案后进入对应修复路径。

### Phase 3a: fix-loop（仅逻辑 Bug，自动循环）

**节点类型**: loop
**命令**: `dr-fix-bug`
**模型**: sonnet
**最大迭代**: 10
**退出条件**: `npm run build && npm run test:run` 全部通过

每次迭代行为：
1. 读取 `$ARTIFACTS_DIR/reproduce.md` 了解 bug 上下文
2. 实现最小修复（只改必要的代码）
3. 运行 `npm run build` 验证编译
4. 运行 `npm run test:run` 验证测试通过
5. 如果通过，退出循环；否则调整修复方案继续

输出到 `$ARTIFACTS_DIR/changes.md`：
- 修改的文件列表
- 每个文件的改动摘要

### Phase 3b: verify-ui（仅 UI Bug）

**节点类型**: command
**命令**: `dr-verify-ui-bug`
**模型**: sonnet
**交互**: true

行为：
1. 读取 `$ARTIFACTS_DIR/reproduce.md`
2. **尝试 E2E 截图测试**（如果项目有对应测试能力）：
   - 生成/运行 E2E 测试脚本
   - 对比修复前后的截图差异
3. **部署到 test-vault**：
   - 运行 `npm run deploy`
   - 输出手动验证步骤
4. 等待用户在 Obsidian 中手动验证
5. 用户确认修复后继续；否则反馈问题

### Phase 4: verify（仅逻辑 Bug，自动）

**节点类型**: bash
**命令**: `npm run build && npm run test:run`
**目的**: 最终全量验证，确保修复没有引入回归

### Phase 5: deploy（自动）

**节点类型**: bash
**命令**: `npm run deploy`
**目的**: 部署到 test-vault 供手动验证（UI bug 的手动验证阶段也在此进行）

## API / 集成规范

### 与现有模块的交互

- **测试框架**: 复用现有 Vitest 配置（`vitest.config.ts`），测试文件遵循 `src/**/__tests__/**/*.test.ts` 约定
- **Mock 体系**: 复用 `tests/__mocks__/obsidian.ts` 和 `tests/setup.ts`
- **E2E 测试**: 复用 `obsidian-e2e-tester` skill（如有），支持截图对比
- **构建系统**: 复用 `npm run build` 和 `npm run test:run`
- **部署系统**: 复用 `npm run deploy`（部署到 test-vault）

### 工作流 YAML 结构

```yaml
name: deepreader-bugfix
description: "快速 Bug 修复工作流：测试优先 + 分流处理（逻辑 bug 自动修复，UI bug E2E/手动验证）"
model: sonnet
interactive: true
worktree: false

arguments:
  - name: bug_description
    description: "Bug 描述：复现步骤、预期行为、实际行为"
    required: true

nodes:
  # Phase 1: 分流 + 复现
  - id: reproduce
    command: dr-reproduce-bug
    context: fresh

  - id: approve-reproduce
    approval:
      message: "请确认 bug 类型和复现方案（逻辑 bug 走自动修复，UI bug 走手动/E2E 验证）"
      capture_response: true
    depends_on: [reproduce]

  # Phase 2a: 逻辑 bug 自动修复循环
  - id: fix-loop
    loop:
      prompt: |
        调用 agent-skills:incremental-implementation 技能，实现最小修复。

        上下文：读取 $ARTIFACTS_DIR/reproduce.md
        目标：使 `npm run build && npm run test:run` 通过
        原则：只改必要代码，不重构、不优化相邻代码
      until: COMPLETE
      max_iterations: 10
      until_bash: "npm run build && npm run test:run"
    depends_on: [approve-reproduce]
    when: "$reproduce.output.bug_type == 'logic'"
    trigger_rule: none_failed_min_one_success

  - id: verify
    bash: "npm run build && npm run test:run"
    depends_on: [fix-loop]
    when: "$reproduce.output.bug_type == 'logic'"

  # Phase 2b: UI bug 验证
  - id: verify-ui
    command: dr-verify-ui-bug
    depends_on: [approve-reproduce]
    when: "$reproduce.output.bug_type == 'ui'"

  # Phase 3: 部署
  - id: deploy
    bash: "npm run deploy"
    depends_on: [verify, verify-ui]
```

### 命令文件设计

#### `dr-reproduce-bug.md`

```markdown
---
description: 分析 bug 根因，判断 bug 类型，编写失败测试或生成手动验证步骤
argument-hint: "Bug 描述"
---

# Bug 复现

## 上下文
读取以下文件了解项目：
- `.project-rules/01-overview.md`（技术栈）
- `.project-rules/02-architecture.md`（目录结构）
- `.project-rules/04-testing.md`（测试规范）
- `.project-rules/05-conventions.md`（代码风格）

## 任务

### Step 1: 分析 bug
1. 分析 bug 描述，定位相关代码文件
2. 理解代码逻辑，确定 bug 根因

### Step 2: 判断 bug 类型

根据根因分析结果判断：

| 类型 | 判断标准 | 复现方式 |
|------|---------|---------|
| **逻辑 Bug** | 可通过断言验证，输出可量化 | 编写失败单元测试 |
| **UI Bug** | 涉及渲染/样式/交互/截图 | 生成手动步骤 + 尝试 E2E |

**判断规则**：
- 如果 bug 体现在 DOM 结构、属性值、API 返回值 → 逻辑 Bug
- 如果 bug 体现在视觉效果、布局、动画、截图差异 → UI Bug
- 混合情况按主要表现判断

### Step 3a: 逻辑 Bug 复现
编写一个**预期失败的测试**：
- 放在对应模块的 `__tests__/` 目录
- 文件命名：`bug-{简短描述}.test.ts`
- 测试应精确复现 bug 行为
- 使用项目现有的 mock 体系

### Step 3b: UI Bug 复现
1. 生成**手动测试步骤**文档（详细的触发步骤 + 预期结果）
2. **尝试 E2E 测试**（如果相关模块有测试能力）：
   - 使用 obsidian-e2e-tester skill 生成/运行截图测试
   - 截图保存到 `$ARTIFACTS_DIR/screenshots/`
3. 如果无法 E2E，在文档中注明"需手动验证"

## 输出

将分析结果写入 `$ARTIFACTS_DIR/reproduce.md`：

```yaml
bug_type: logic | ui
root_cause: Bug 根因分析（1-3 句）
affected_files:
  - file1
  - file2
test_file: path/to/test.test.ts  # 仅逻辑 bug
manual_test_steps: |              # 仅 UI bug
  1. 打开 Vault
  2. 导航到...
  3. 预期看到...
e2e_test: path/to/e2e.spec.ts  # 如果尝试了 E2E
e2e_screenshots:               # E2E 截图路径
  before: $ARTIFACTS_DIR/screenshots/before.png
  after: $ARTIFACTS_DIR/screenshots/after.png
```

## 规则
- 不要修复 bug，只生成复现方案
- 测试代码风格遵循 .project-rules/05-conventions.md
- 如果无法确定根因，列出可能的怀疑点，由用户判断走哪个路径
```

#### `dr-fix-bug.md`

```markdown
---
description: 实现最小 bug 修复（仅逻辑 bug）
argument-hint: ""
---

# Bug 修复

## 上下文
- 读取 `$ARTIFACTS_DIR/reproduce.md` 了解 bug 分析结果（确保 bug_type == logic）
- 读取 `.project-rules/05-conventions.md` 了解代码风格

## 任务

1. 读取 reproduce.md 中的受影响文件
2. 实现最小修复：
   - 只修改必要的代码
   - 不重构、不优化相邻代码
   - 不添加超出修复范围的功能
3. 运行验证：
   - `npm run build`
   - `npm run test:run`
4. 如果失败，调整修复方案

## 输出

将改动摘要追加到 `$ARTIFACTS_DIR/changes.md`：
- 修改了哪些文件
- 每个文件的改动说明（1 句）

## 规则
- 遵循 CLAUDE.md 的"Surgical Changes"原则
- 不提交 git commit
- 不修改不相关的代码
- 只处理 bug_type == logic 的 bug
```

#### `dr-verify-ui-bug.md`

```markdown
---
description: UI bug 验证（E2E 截图 + 手动验证步骤）
argument-hint: ""
---

# UI Bug 验证

## 上下文
- 读取 `$ARTIFACTS_DIR/reproduce.md` 了解 bug 分析结果（确保 bug_type == ui）
- 读取 `$ARTIFACTS_DIR/screenshots/` 目录（如果存在）

## 任务

### Step 1: 尝试 E2E 截图测试
如果 reproduce.md 中有 `e2e_test` 字段：
1. 运行 E2E 测试脚本
2. 对比修复前后的截图
3. 输出对比结果到 `$ARTIFACTS_DIR/verify-result.md`

如果无法运行 E2E，跳过此步骤。

### Step 2: 部署到 test-vault
1. 运行 `npm run deploy`
2. 输出手动验证步骤（从 reproduce.md 的 manual_test_steps）

### Step 3: 等待用户确认
输出以下内容等待用户确认：
```
请在 Obsidian test-vault 中验证：

手动验证步骤：
$manual_test_steps

- 如果修复正确：在 test-vault 中确认行为符合预期
- 如果修复不正确：描述具体问题，重新触发 bugfix

确认后我将完成工作流。
```

## 输出

- 如果 E2E 截图对比可用：输出对比结果
- 如果 E2E 不可用：强调手动验证步骤
- 等待用户 explicit 确认

## 规则
- 不做自动断言（UI 修复需要人眼判断）
- 如果用户提供截图对比反馈，记录到 `$ARTIFACTS_DIR/verify-result.md`
```

## 成功标准

- [ ] 工作流文件 `.archon/workflows/deepreader-bugfix.yaml` 可被 `archon run deepreader-bugfix` 触发
- [ ] `reproduce` 阶段能正确判断 bug 类型（logic vs ui）
- [ ] 逻辑 bug 生成失败测试，UI bug 生成手动验证步骤
- [ ] `fix-loop` 阶段在 `npm run build && npm run test:run` 通过后自动退出
- [ ] UI bug 提供 E2E 截图对比（如测试能力存在）或完整手动步骤
- [ ] 修复只涉及必要的代码变更（可通过 git diff 验证改动范围）
- [ ] 全流程从触发到部署不超过 15 分钟（简单 bug）
- [ ] 不修改任何现有工作流或命令文件

## 不做（Out of Scope）

- **不做** code review 阶段——bug 修复强调速度，review 留给用户自行决定
- **不做** 自动合并/版本更新——合并和发版由 `deepreader-ship` 工作流负责
- **不做** worktree 隔离——bug 修复通常改动小，直接在主分支工作
- **不做** 自动 git commit——遵循项目规则，代码修改需用户审查后提交
- **不做** 复杂 bug 的多轮交互——如果 reproduce 阶段无法定位根因，建议用户转用 feature 工作流
