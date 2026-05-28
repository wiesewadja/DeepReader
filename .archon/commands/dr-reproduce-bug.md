# dr-reproduce-bug

复现 bug，分析根因，写失败测试（逻辑 bug）或手动步骤（UI bug）。

## 输入

- `$ARGUMENTS` — 用户描述的 bug
- `$ARTIFACTS_DIR/reproduce.md` — 已有的调查笔记（如果有）

## 上下文读取

1. 读取 `$ARTIFACTS_DIR/reproduce.md`（如果存在）
2. 读取 `SPEC.md`（如果存在）了解项目背景
3. 读取最近的 git log 和 diff，了解最近变更：
   ```
   git log --oneline -10
   git diff HEAD~3..HEAD --name-only
   ```

## 分析过程

### 1. 收集信息

通过代码搜索、Read、Grep 工具：
- 定位报错位置（搜索错误关键字、堆栈）
- 找出涉及的源文件和测试文件
- 确定根因（不是 symptom，是根本原因）

### 2. 判断 bug 类型

| 特征 | 倾向逻辑 bug | 倾向 UI bug |
|------|-------------|-------------|
| 有失败测试 | ✓ | |
| 涉及渲染/样式/布局 | | ✓ |
| 涉及插件 API 调用 | ✓ | |
| 在 Obsidian 渲染进程 | | ✓ |
| 涉及命令行输出格式 | ✓ | |
| 涉及 CSS/主题 | | ✓ |

### 3. 逻辑 bug — 写失败测试

在对应测试文件中编写一个**必然失败**的测试：
- 测试名：`it('should [expected behavior] when [condition]')`
- 断言当前代码**没有**实现的行为
- 运行 `npm run test:run` 确认测试失败（且是因为预期原因失败）

### 4. UI bug — 写手动步骤

在 `$ARTIFACTS_DIR/reproduce.md` 中记录：
```markdown
manual_test_steps: |
  1. [具体操作步骤]
  2. [期望结果 vs 实际结果]
```

尝试 E2E 截图测试（如果可行）：
- 检查是否有现有 E2E 测试框架
- 编写或补充截图测试

## 输出

写入 `$ARTIFACTS_DIR/reproduce.md`：

```markdown
---
bug_type: logic | ui
root_cause: |
  [1-3 句话描述根因]
affected_files:
  - src/xxx.ts
  - tests/xxx.test.ts
test_file: tests/xxx.test.ts      # 仅 logic
manual_test_steps: |              # 仅 ui
  1. ...
e2e_test: |                       # 仅 ui（如果可行）
  [测试代码片段]
e2e_screenshots: []               # 仅 ui
---
```

## 成功标准

- `bug_type` 明确（logic | ui）
- `root_cause` 清晰可执行
- `affected_files` 列出所有涉及文件
- 逻辑 bug：`test_file` 已写，测试运行后失败
- UI bug：`manual_test_steps` 包含可重复的手动验证步骤
