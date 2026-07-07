# 分支模型

DeepReader 采用 **worktree → dev → main** 三层模型。

```
worktree 分支 (feat/*, fix/*, refactor/*, perf/*, docs/*, test/*, chore/*)
        │  merge commit（保留轨迹），合完删分支
        ▼
       dev  ← 日常集成的暂存区，允许脏，历史完整（推 origin 作备份）
        │  squash 合并 + 完整质量门
        ▼
      main  ← 受保护的发布快照，历史干净
```

## 三个分支的职责

| 分支 | 职责 | 历史特征 | 谁能改 |
|------|------|----------|--------|
| `main` | 发布快照，每个 commit = 一个可独立发布/回滚的功能集 | 干净、语义化 | 仅来自 dev 的 squash；hotfix 例外 |
| `dev` | 日常集成主线，汇集所有 worktree 成果 | 完整保留 merge commit 与集成轨迹 | 来自 worktree 的 merge；来自 main 的 hotfix 回流 |
| worktree 分支 | 单个功能/重构的开发沙箱 | 自由，合入 dev 后删除 | 开发期随意 |

## worktree 分支命名

对齐 Conventional Commits 的 type（与 `05-conventions.md` 的提交 type 同构），后跟简短 kebab-case 描述：

- ✅ `refactor/reading-mode-chapter`、`feat/tts-reading-aloud`、`fix/mobile-admzip-crash`、`perf/search-hotpath`、`docs/branching`
- ❌ `feature/`（→ `feat/`）、`impl/`（→ `feat/` 或 `refactor/`）、`integ/`（dev 常驻后不再需要集成分支）、裸名（如 `fuzzy-otter`）
- scope 放进 commit message，**不**放进分支名（避免括号在 shell/工具中转义）

## 合并方式

### worktree → dev（轻量集成）

1. worktree 内开发完成、自测 OK
2. 跑 `npm run test:run`（单测）**必须通过**——防止带编译错误/红单测污染 dev
3. checkout dev，`git merge` 合入，**保留 merge commit**
4. merge commit message 沿用 `merge: 合入 <功能描述>` 格式
5. **合完立即删 worktree 分支与 `.worktrees/` 目录**（原始 commit 通过 merge commit 仍可在 dev 历史中追溯）
6. 此层**不调**测试工程师代理、**不做**深度 review（worktree 开发期已和 AI 来回改过）

### dev → main（发布，按功能集）

触发条件：**一个完整功能集在 dev 上集成完毕、稳定**（如 reading-mode 重构 I1~I4 全部合入且无回归）。

1. 从 dev 做一次干净 `npm run deploy` 验收（在 dev 分支上执行，manifest.version 自动注入 `<baseVersion>-dev.<HHMM>`，见 `07-deployment.md`），肉眼确认集成态 OK
2. 调测试工程师代理跑冒烟/E2E（功能集相关场景，必要时 full）
3. 用户做最终代码审查
4. `git checkout main && git merge --squash dev`，commit message 用 Conventional Commits，**body 列出本功能集包含的 worktree 分支**，便于从干净 main 历史回溯到 dev 上的细粒度集成：
   ```
   refactor(reading-mode): 重构分页与章节导航为深模块

   包含 worktree 分支：
   - refactor/reading-mode-pagination (I4)
   - refactor/reading-mode-pagememory (I1)
   - refactor/reading-mode-chat (I3)
   - refactor/reading-mode-chapter (I2)
   ```
5. 功能集边界以"可独立发布、可独立回滚"为准——太大的拆成多个功能集分次 squash

### hotfix（main 紧急修复）

1. 从 main 拉 `fix/<bug>` worktree
2. 修完跑 `npm run test:run` + 针对性冒烟（`--only` 相关场景）
3. `git merge` 合回 main（**不 squash**，单个 commit 直接进）
4. main 合回 dev（`git checkout dev && git merge main`），让 dev 也拿到修复——回流按需触发（hotfix 发生时才回流）
   - 例外：若 dev 上攒了大量未发布内容导致 main→dev 冲突过大，改用 cherry-pick

## 部署绑定

部署是**开发期验证手段**，不是生产发布。manifest.version 的 `<feature>` 段由 `scripts/deploy.js` 按当前 git 分支名自动推导（见 `07-deployment.md`）：

| 场景 | 部署源 | 自动注入的 version |
|------|--------|--------------------|
| worktree 开发期验证 | 当前 worktree 代码 | `<baseVersion>-<feature>.<HHMM>`（feature = 去前缀的分支名） |
| dev→main 发布前验收 | dev 分支 | `<baseVersion>-dev.<HHMM>` |
| main | **不单独部署** | — |

main 是快照，内容 = dev squash 进来的、已验证过的。要看 main 长什么样，checkout main 到临时 worktree 再 deploy，不污染主工作区。

## 质量门速查

| 动作 | worktree→dev | dev→main | hotfix→main |
|------|--------------|----------|-------------|
| 单测 `npm run test:run` | ✅ 必须 | ✅ | ✅ |
| 测试工程师代理（冒烟/E2E） | ❌ | ✅ | ⚠️ 针对性冒烟 |
| 用户代码审查 | ❌（worktree 期已做） | ✅ 必须 | ✅ |
| 手动 deploy 肉眼验收 | 自愿 | ✅ 必须 | 自愿 |

## 建立 dev 分支（首次）

若 `dev` 尚不存在，从 `main` 创建并推 origin：

```bash
git checkout -b dev main
git push -u origin dev
```

建立后，worktree 分支按上方「worktree → dev」流程合入；功能集稳定后按「dev → main」squash 发布。dev 常驻，不再随功能集删除。
