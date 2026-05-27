---
description: 预览分支上的全部变更，生成合并摘要。
argument-hint: "分支名（如 feat/my-feature）"
---

# 预览变更

用户请求: $ARGUMENTS

## 任务

1. 确定要合并的分支：
   - 如果 $ARGUMENTS 包含分支名，使用该分支
   - 否则检测当前 worktree 关联的分支

2. 生成变更预览：
   - 列出 `git diff main...<branch>` 的文件级变更摘要
   - 对每个文件，简要说明改了什么（一行）
   - 统计：新增/修改/删除文件数，总变更行数

3. 读取 $ARTIFACTS_DIR/changes.md（如果存在），获取详细的变更记录

4. 输出格式：
```
## 变更预览

**分支**: feat/xxx → main
**统计**: +N 文件 / -M 文件 / 总 K 行

### 文件变更
- `src/foo.ts` — 新增 XXX 功能
- `src/bar.ts` — 修改 YYY 逻辑

### 详细变更
[从 changes.md 摘取关键变更]
```
