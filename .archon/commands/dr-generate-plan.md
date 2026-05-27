---
description: 从已审批的 SPEC.md 生成 tasks/plan.md 任务拆分。
argument-hint: "用户的审批反馈（可选修改意见）"
---

# 生成 tasks/plan.md

用户反馈: $ARGUMENTS

## 任务

1. 调用 agent-skills:plan 技能，读取 SPEC.md 生成 tasks/plan.md

2. Plan 格式要求（参考项目现有 tasks/plan.md 风格）：

```markdown
# [特性名称] — 实现计划

## Phase 1: [阶段名称]
### T1.1 [任务标题]
- **文件**: `src/path/to/file.ts`
- **内容**: 具体做什么
- **验收标准**:
  - [ ] 验收条件 1
  - [ ] 验收条件 2

### T1.2 [任务标题]
...

## Phase 2: [阶段名称]
...

## 依赖关系
T1.1 → T1.2 → T2.1 ...
```

3. 任务拆分原则：
   - 按 Phase 分组，每个 Phase 是一个可独立验证的垂直切片
   - 典型分阶段：数据层 → 核心逻辑 → UI → 集成
   - 每个任务足够小，单次实现+测试可验证
   - 明确标注任务间依赖

4. 将 plan 写入 `tasks/plan.md`

5. 输出 plan 全文供审批

## 规则
- Plan 用中文撰写
- 每个任务必须包含文件列表和验收标准
- 如果用户反馈中有修改意见，先更新 SPEC.md 再生成 plan
- 参考 .project-rules/ 下的架构和开发规范
