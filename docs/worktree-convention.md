# Worktree 功能分支使用规范

## 目录约定

```
DeepReader/
├── .worktrees/                    # 功能分支 worktree 统一存放位置
│   ├── feat/fts5-book-search/     # 功能分支
│   ├── fix/race-condition/        # 修复分支
│   └── feat/dynamic-maker-skill/
├── src/
└── ...
```

**规则**：
- 所有 worktree 统一存放在 `.worktrees/` 目录
- 按分支类型分子目录：`feat/`、`fix/`、`chore/`
- `.gitignore` 中添加 `.worktrees/`（可选，取决于是否想跟踪）

## Agent 工具目录同步

由于 `.claude/`、`.mimocode/`、`.agents/` 在 `.gitignore` 中，worktree 创建后需要手动链接：

```bash
# 创建 worktree 后运行
./scripts/setup-worktree-symlinks.sh .worktrees/feat/my-feature
```

**符号链接效果**：
```
.worktrees/feat/my-feature/
├── .claude -> /path/to/main/.claude      # 符号链接
├── .mimocode -> /path/to/main/.mimocode  # 符号链接
├── .agents -> /path/to/main/.agents      # 符号链接
├── src/                                   # 独立工作目录
└── package.json
```

**优点**：
- 配置同步：主仓库修改配置，所有 worktree 立即生效
- 节省空间：不重复存储 agent 文件
- 创建快速：符号链接瞬间完成

**注意**：
- 修改会直接影响主仓库的 agent 配置
- 如需独立配置，手动创建目录替代符号链接

## 分支命名规范

| 类型 | 前缀 | 示例 | 用途 |
|------|------|------|------|
| 功能 | `feat/` | `feat/fts5-book-search` | 新功能开发 |
| 修复 | `fix/` | `fix/race-condition-sendmsg` | Bug 修复 |
| 重构 | `refactor/` | `refactor/agent-architecture` | 代码重构 |
| 文档 | `docs/` | `docs/api-reference` | 文档更新 |
| 测试 | `test/` | `test/e2e-agent-flow` | 测试相关 |
| 杂项 | `chore/` | `chore/deps-update` | 依赖更新、CI 配置 |

**命名规则**：
- 小写 + 连字符（kebab-case）
- 简短描述，1-4 个单词
- 可选关联 issue ID：`feat/123-user-auth`

## 创建 Worktree

### 手动创建

```bash
# 创建功能分支
git worktree add .worktrees/feat/my-feature -b feat/my-feature main

# 创建修复分支
git worktree add .worktrees/fix/my-bug -b fix/my-bug main
```

### 通过 AI Agent 创建

Agent 执行任务时自动创建：

```bash
# 自动创建 + 切换 + 开始工作
git worktree add .worktrees/feat/$FEATURE_NAME -b feat/$FEATURE_NAME main
cd .worktrees/feat/$FEATURE_NAME

# 链接 agent 工具目录
./../../scripts/setup-worktree-symlinks.sh .

# 安装依赖
npm install
```

## Worktree 生命周期

```
创建 → 开发 → 测试 → 合并 → 清理
 │       │       │       │       │
 │       │       │       │       └─ git worktree remove
 │       │       │       └─ PR/Merge to main
 │       │       └─ npm test / E2E
 │       └─ 代码编写
 └─ git worktree add
```

### 1. 创建阶段

```bash
# 确保 main 分支最新
git checkout main && git pull

# 创建 worktree
git worktree add .worktrees/feat/my-feature -b feat/my-feature main

# 进入 worktree
cd .worktrees/feat/my-feature

# 链接 agent 工具目录（.claude, .mimocode, .agents）
./../../scripts/setup-worktree-symlinks.sh .

# 安装依赖
npm install
```

### 2. 开发阶段

```bash
# 在 worktree 中正常开发
cd .worktrees/feat/my-feature
npm run dev

# 提交代码
git add .
git commit -m "feat: add new feature"
```

### 3. 测试阶段

```bash
# 单元测试
npm run test:run

# 构建验证
npm run build

# E2E 测试（可选）
npm run test:e2e
```

### 4. 合并阶段

```bash
# 方式 1：直接合并
git checkout main
git merge feat/my-feature

# 方式 2：通过 PR（推荐）
# 推送到远程，创建 PR
git push origin feat/my-feature
# 在 GitHub 创建 PR 并合并
```

### 5. 清理阶段

```bash
# 合并后删除 worktree
git worktree remove .worktrees/feat/my-feature

# 清理分支引用
git branch -d feat/my-feature

# 可选：清理远程分支
git push origin --delete feat/my-feature
```

## Worktree 测试环境

### 插件部署

Worktree 自动部署到独立的插件目录，避免与主仓库冲突：

```bash
# 在 worktree 中运行
npm run deploy

# 自动检测 worktree，部署到：
# test-vault/.obsidian/plugins/deepreader-wt-{branch-name}/
# 例如：deepreader-wt-feat-my-feature
```

**部署规则**：
| 环境 | 插件目录 | 用途 |
|------|----------|------|
| 主仓库 dev | `deepreader-dev` | 日常开发测试 |
| 主仓库 daily | `deepreader` | 正式使用 |
| Worktree | `deepreader-wt-{branch}` | 独立功能测试 |

### 测试流程

```bash
# 1. 在 worktree 中部署
cd .worktrees/feat/my-feature
npm run deploy

# 2. 在 Obsidian 中启用对应插件
# Settings → Community plugins → 启用 deepreader-wt-feat-my-feature

# 3. 运行测试
npm run test:run        # 单元测试
npm run build           # 构建验证

# 4. 测试完成后清理插件（可选）
# 手动删除 test-vault/.obsidian/plugins/deepreader-wt-*/
```

### 并行测试

多个 worktree 可同时测试，互不干扰：

```
test-vault/.obsidian/plugins/
├── deepreader/          # daily 版本
├── deepreader-dev/      # 主仓库开发版
├── deepreader-wt-feat-a/  # worktree A
└── deepreader-wt-feat-b/  # worktree B
```

## AI Agent 并行任务

### 场景：多个 Agent 同时开发不同功能

```
主仓库 (main)
    │
    ├── Agent A → .worktrees/feat/feature-a
    ├── Agent B → .worktrees/fix/bug-b
    └── Agent C → .worktrees/feat/feature-c
```

### Agent 工作流程

```bash
# Agent 启动时
1. 创建专属 worktree
2. 安装依赖
3. 执行任务
4. 提交代码
5. 完成后通知主仓库

# 主仓库定期
1. 检查各 worktree 状态
2. 合并已完成的工作
3. 清理已合并的 worktree
```

### 隔离保证

- 每个 Agent 有独立的工作目录
- 文件修改互不影响
- 依赖安装独立
- Git 历史独立，合并时统一

## CI/CD 集成

### 自动测试

```yaml
# .github/workflows/test-worktree.yml
on:
  push:
    branches:
      - 'feat/**'
      - 'fix/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm ci
      - run: npm run test:run
      - run: npm run build
```

### 部署隔离

每个 worktree 可以独立部署到测试环境：

```bash
# 在 worktree 中部署
cd .worktrees/feat/my-feature
npm run deploy:test
```

## 清理策略

### 自动清理

```bash
# 查找已合并的 worktree
git worktree list --porcelain | grep -A 2 "worktree .worktrees" | grep "branch refs/heads/" | awk '{print $2}' | while read branch; do
  if ! git rev-parse --verify "$branch" >/dev/null 2>&1; then
    echo "Branch $branch is deleted, cleaning worktree..."
  fi
done
```

### 手动清理

```bash
# 列出所有 worktree
git worktree list

# 删除指定 worktree
git worktree remove .worktrees/feat/old-feature

# 强制删除（有未提交修改时）
git worktree remove --force .worktrees/feat/old-feature

# 清理失效的 worktree 引用
git worktree prune
```

### 定期维护

建议每周执行：

```bash
# 1. 清理已合并的分支
git worktree prune

# 2. 列出仍在使用的 worktree
git worktree list

# 3. 手动删除不再需要的 worktree
```

## 常见问题

### Q: worktree 和普通分支有什么区别？

A: worktree 允许同一个仓库同时 checkout 多个分支，每个分支在独立的目录中。普通分支需要切换（checkout），同一时间只能在一个分支上工作。

### Q: 如何查看所有 worktree 的状态？

```bash
git worktree list
```

### Q: worktree 中的修改会影响主仓库吗？

A: 不会。每个 worktree 有独立的工作目录，修改只影响当前 worktree。只有显式合并（merge）才会将修改带入主分支。

### Q: 如何在 worktree 之间同步代码？

```bash
# 从 main 拉取最新代码
cd .worktrees/feat/my-feature
git fetch origin
git rebase origin/main
```

### Q: 遇到 worktree 冲突怎么办？

```bash
# 如果两个 worktree 修改了同一个文件，合并时会冲突
# 解决冲突后继续合并
git merge --abort  # 或 git rebase --abort
# 手动解决冲突后重新合并
```

## 快速参考

| 操作 | 命令 |
|------|------|
| 创建 worktree | `git worktree add .worktrees/feat/xxx -b feat/xxx main` |
| 列出 worktree | `git worktree list` |
| 删除 worktree | `git worktree remove .worktrees/feat/xxx` |
| 清理失效引用 | `git worktree prune` |
| 进入 worktree | `cd .worktrees/feat/xxx` |
| 在 worktree 中提交 | `git add . && git commit -m "..."` |
| 合并到 main | `git checkout main && git merge feat/xxx` |
