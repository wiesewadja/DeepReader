# dr-verify-ui-bug

UI bug 验证阶段：E2E 截图对比 + 手动验证步骤。

## 输入

- `$ARTIFACTS_DIR/reproduce.md` — UI bug 信息和 manual_test_steps

## 上下文读取

1. `$ARTIFACTS_DIR/reproduce.md` — 读取 bug_type、root_cause、affected_files、manual_test_steps
2. 项目中的 E2E 测试目录结构（`e2e/` 或 `tests-e2e/`）
3. `package.json` 中的 E2E 测试命令

## 验证步骤

### 1. 尝试 E2E 截图测试

如果项目有 E2E 测试框架：
- 在 `e2e/` 或 `tests-e2e/` 中编写/补充截图测试
- 对比修复前后的截图差异
- 记录截图路径到 `$ARTIFACTS_DIR/reproduce.md`

如果无可用 E2E 框架：
- 在 reproduce.md 中注明 `e2e_test: "N/A — 需手动验证"`
- 继续执行手动验证步骤

### 2. 生成手动验证文档

确保 `$ARTIFACTS_DIR/reproduce.md` 包含完整的 `manual_test_steps`。

格式要求：
- 每个步骤用序号列出
- 包含**具体操作**和**期望结果**
- 可在 test-vault 中直接执行

### 3. 用户手动验证

输出以下内容给用户：

```
## UI Bug 手动验证

### Bug 信息
- 根因：$root_cause
- 受影响文件：$affected_files

### 验证步骤
$manual_test_steps

### E2E 截图（如有）
$e2e_screenshots

请在 test-vault 中执行上述步骤，确认 bug 已修复。
```

### 4. 部署

验证通过后（或用户确认后）：

```bash
npm run deploy
```

## 成功标准

- `manual_test_steps` 完整、可执行
- E2E 截图测试通过（如果有）
- 用户确认 bug 已修复
- `npm run deploy` 成功
