---
description: 合并分支到 main 并更新版本号为今天日期。
argument-hint: "分支名"
---

# 合并 + 版本更新

用户请求: $ARGUMENTS

## 任务

1. 确定分支名（同 dr-preview-changes 逻辑）

2. 执行合并：
   - 切换到 main 分支：`git checkout main`
   - 拉取最新：`git pull origin main`（如有远程）
   - 合并特性分支：`git merge <branch> --no-ff -m "merge: 合并 <branch> 到 main"`
   - 如果有冲突，报告冲突并停止，不要自动解决

3. 更新版本号：
   - 获取今天日期：`date +%Y.%m.%d`
   - 更新 package.json 中的 version 字段
   - 执行 `npm run sync-version` 同步到 manifest.json
   - 提交版本更新：`git commit -m "chore: 更新版本号 YYYY.MM.DD"`

4. 输出结果：
   - 合并是否成功
   - 新版本号
   - 如有冲突，列出冲突文件

## 规则
- 不要 push 到远程（用户手动 push）
- 冲突时停止，不自动解决
- 版本号格式：YYYY.MM.DD（如 2026.05.27）
