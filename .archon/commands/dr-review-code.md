---
description: 对本次所有变更进行五轴代码审查 + DeepReader 项目特定规则检查。
argument-hint: ""
---

# 代码审查

## 任务

1. 调用 `agent-skills:review` 技能（使用 Skill 工具），对本次所有变更进行五轴审查：
   - **正确性**: 逻辑是否正确？边界情况是否处理？测试是否充分？
   - **可读性**: 命名是否清晰？逻辑是否直观？组织是否合理？
   - **架构**: 是否遵循项目模式？边界是否清晰？抽象层级是否合适？
   - **安全性**: 输入是否验证？密钥是否安全？有无注入风险？
   - **性能**: 有无 N+1 查询？有无无界操作？是否有不必要计算？

2. 变更摘要见 `$ARTIFACTS_DIR/changes.md`。
   只审查新增/修改的代码，不审查未变更的上下文。

3. DeepReader 项目特定审查要点：
   - 是否正确使用 Obsidian Vault API（而非直接 fs 操作）
   - 是否通过 `src/utils/logger.ts` 记录日志（而非 console.log）
   - TypeScript 类型是否严格（strictNullChecks）
   - Agent 入口是否仅通过 `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
   - 是否有不必要的复杂度（调用 `agent-skills:code-simplify` 评估）
   - 测试脚本中是否有 `pass/fail` 等辅助函数重复（应提取到共享模块）
   - `.env` 中是否有明文密钥被意外提交

4. 输出格式：
   - 按严重程度分级：**CRITICAL** / **HIGH** / **MEDIUM** / **LOW**
   - 每个问题包含：`文件路径:行号`、问题描述、建议修复
   - 如果没有问题，输出 "REVIEW_PASSED"
   - 将结果写入 `$ARTIFACTS_DIR/review-output.md`
