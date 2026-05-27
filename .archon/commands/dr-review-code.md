---
description: 对本次所有变更进行五轴代码审查。
argument-hint: ""
---

# 代码审查

## 任务

1. 调用 agent-skills:review 技能（使用 Skill 工具），对本次所有变更进行五轴审查：
   正确性、可读性、架构、安全性、性能。

2. 变更摘要见 $ARTIFACTS_DIR/changes.md。
   只审查新增/修改的代码，不审查未变更的上下文。

3. 项目特定审查要点：
   - 是否正确使用 Obsidian Vault API（而非直接 fs 操作）
   - 是否通过 src/utils/logger.ts 记录日志（而非 console.log）
   - TypeScript 类型是否严格（strictNullChecks）
   - 是否有不必要的复杂度（调用 agent-skills:code-simplify 评估）

4. 输出格式：
   - 按严重程度分级：CRITICAL / HIGH / MEDIUM / LOW
   - 每个问题包含：文件路径、行号、问题描述、建议修复
   - 如果没有问题，输出 "REVIEW_PASSED"
