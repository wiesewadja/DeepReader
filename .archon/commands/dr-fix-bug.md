# dr-fix-bug

逻辑 bug 修复循环中的单次迭代。只改必要代码，不重构、不优化相邻代码。

## 输入

- `$ARGUMENTS` — 无（通过 artifact 传递）
- `$ARTIFACTS_DIR/reproduce.md` — 必须读取，包含根因和受影文件

## 上下文读取

**必须先读取以下文件**（`fresh_context: true`，无记忆）：

1. `$ARTIFACTS_DIR/reproduce.md` — 根因、受影响文件、测试文件路径
2. `tests/xxx.test.ts`（从 reproduce.md 的 test_file 字段）— 失败测试内容
3. `src/xxx.ts`（从 reproduce.md 的 affected_files）— 需修复的源代码

## 修复步骤

### 1. 分析

- 理解失败测试的预期行为
- 理解源代码当前行为
- 确定两者差距

### 2. 实现最小修复

- 只改能让测试通过所必需的代码
- 不改函数签名、不删无关代码、不加无关功能
- 遵循项目代码风格

### 3. 验证

```bash
npm run build && npm run test:run
```

- **通过** → 修复成功，循环结束
- **失败** → 继续下一次迭代

## 原则

- 每次迭代独立，`fresh_context: true` 保证无状态
- 超过 10 次迭代未修复 → 循环退出，等待人工介入
- 不在循环内做代码重构或性能优化
