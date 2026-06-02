---
description: 对本次所有变更进行五轴代码审查 + DeepReader 项目特定规则检查。遵循 deepreader-review skill 的审查流程。
argument-hint: ""
---

# 代码审查

## 任务

遵循 `deepreader-review` skill 的五维度审查流程：

1. 读取 `deepreader-review` skill 文件（`.claude/skills/deepreader-review/SKILL.md`）了解完整的审查维度和标准
2. 读取 `$ARTIFACTS_DIR/changes.md` 获取变更摘要和 diff
3. 只审查新增/修改的代码，不审查未变更的上下文
4. 对每个变更文件逐一检查五个维度：
   - **正确性**: 逻辑是否正确？边界情况是否处理？测试是否充分？
   - **可读性**: 命名是否清晰？逻辑是否直观？组织是否合理？
   - **架构**: 是否遵循项目模式？边界是否清晰？抽象层级是否合适？
   - **安全性**: 输入是否验证？密钥是否安全？有无注入风险？
   - **性能**: 有无 N+1 查询？有无无界操作？是否有不必要计算？

## DeepReader 项目特定检查

- 是否正确使用 Obsidian Vault API（而非直接 fs 操作）
- 是否通过 `src/utils/logger.ts` 记录日志（而非 console.log）
- TypeScript 类型是否严格（strictNullChecks）
- Agent 入口是否仅通过 `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- 是否有不必要的代码复杂度（能简化的逻辑）
- 测试脚本中是否有 `pass/fail` 等辅助函数重复（应提取到共享模块）
- `.env` 中是否有明文密钥被意外提交

## 输出格式

按严重程度分级：
- **CRITICAL**: 必须修复才能合并（数据丢失、安全漏洞、功能完全失效）
- **HIGH**: 强烈建议修复（明显 bug、重要缺失、架构违规）
- **MEDIUM**: 改进建议（可读性、一致性、测试覆盖）
- **LOW**: 可选优化（命名、注释、风格）

每个问题包含：`文件路径:行号`、问题描述、建议修复。

如果没有问题，输出 "REVIEW_PASSED"。

将结果写入 `$ARTIFACTS_DIR/review-output.md`。
