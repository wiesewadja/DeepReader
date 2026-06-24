# DeepReader

Obsidian 插件，奚童，AI 伴读 + PDF/EPUB 索引 + 微信读书同步。

## 命令

### 四层测试架构

| 层级 | 命令 | 适用场景 | 典型时长 |
|------|------|----------|----------|
| L1 单元 | `npm run test:run` | 函数逻辑、组件测试 | ~55s |
| L2 冒烟 | `npm run smoke:core` | 部署后快速验证 | ~10-30s |
| L3 轻量 E2E | `npm run e2e-light` | 流程级验证（默认选择） | ~90s |
| L4 WebdriverIO | `npx wdio run tests/wdio.conf.ts` | 隔离环境/特殊场景 | ~5min |

### 其他命令
- 部署: `npm run deploy` → test-vault
- 跨 worktree 部署: 复制 `bin/main.js` + `bin/styles.css` + `bin/manifest.json` 到目标 vault 的 `plugins/<plugin-dir>/`

### 冒烟测试 vs 轻量 E2E

| 维度 | 冒烟 (L2) | 轻量 E2E (L3) |
|------|-----------|---------------|
| 目的 | 插件是否可用 | 功能是否正确 |
| 验证 | 存在性检查 | 流程级验证 |
| 失败含义 | 插件坏了 | 功能有问题 |

## 架构
- UI: 纯 TypeScript + DOM（无框架）
- AI: LangGraph（四层认知引擎） + FrontendAgent
- 索引: PageIndex（Vector + BM25 混合搜索）
- 阅读: ReadingModeService + PagePaginator（分页+章节导航+位置恢复）
- 记忆: 用户画像 + 长期记忆（MEMORY.md → 渐进理解用户）

## 运行时
- Obsidian 插件，跑在 Electron 渲染进程
- 有 DOM + Obsidian API，无完整 Node.js
- 调试: Obsidian 内 `Cmd+Option+I` → `app.plugins.plugins['deepreader-dev']`
- ⛔ 不是网页，不要用浏览器 MCP / Playwright 调试

### Obsidian CLI 连接
- `obsidian plugin id=deepreader-dev` 报 "Unable to connect to main process" = Obsidian 未运行或 vault 未加载
- 必须用户手动打开 Obsidian 并加载 test-vault 后才能连接
- 部署后需 `npm run deploy` + 用户重新加载插件（或 Obsidian 自动热重载）

## 约束
- 日志用 `utils/logger.ts`
- 数据文件用 `fs`（原子写入），用户内容用 Vault API
- 插件 ID 用 `this.manifest.id`，不硬编码 `'deepreader'`
- Agent 唯入口: `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- 提交前将代码修改方案整理后告知用户审查，用户确认后提交代码
- 每个重要功能都拉取.worktrees/目录下的独立worktree分支，完成后调用测试工程师代理进行测试

### 跨平台兼容约束 (PC & Mobile)
- **禁止顶层静态引入 Node.js 模块**：在 `main.ts` 或被其静态引入的传递闭包（如 `paths.ts`、搜索链等）中，禁止在顶层使用 `import * as fs from 'fs'` 或任何带 `node:` 前缀的静态 import。
- **惰性 require**：需要使用 Node.js 专有 API（如 `fs/promises`、`child_process`）时，桌面端专用代码必须使用 `src/utils/node-fs.ts` 的 `nodeFs()` 惰性加载，或在函数内部动态 `require`/`await import()`。
- **I/O 双轨机制**：文件读写优先使用 Vault API。非 UI CLI 脚本必须支持 `app ? vaultRead(...) : nodeFs().readFile(...)` 双轨兼容。
- **UI 手势与定位兼容**：
  - 移动端禁止注册自定义触摸滑动翻页（防与 Obsidian 原生滑动侧栏冲突），翻页应通过点击 UI 按钮或赋能 `scrollView.scrollLeft`。
  - 选区工具栏在移动端应通过 `selectionchange` 结合 `range.getBoundingClientRect()` 精准定位，不得使用 mouseup 坐标。
  - 尽量使用 `Platform.isMobile` 来处理特定平台样式（如阅读模式下通过 `toggleMobileNavbar` 隐藏底部导航栏，退出时还原）。
- **提交前置卡点**：每次改动后必须运行 `node scripts/smoke/lib/mobile-load-trace.mjs`，确保加载阶段触发的 Node 模块集合为空（加载期零 Node 触达）。

## 部署陷阱
- `manifest.json` 的 `id` 字段必须与插件目录名一致（`deepreader-dev/` → id=`deepreader-dev`），否则 Obsidian 静默加载失败
- `community-plugins.json` 只能包含实际存在的插件 ID，空目录会导致加载冲突
- wdio 从 `bin/` 加载插件（不是 test-vault），`bin/manifest.json` 的 id 也要匹配
- 跨 worktree 部署时需同时更新主仓库的 `bin/` 和 `test-vault/.obsidian/plugins/deepreader-dev/`

## Worktree Skill/Agent 同步

AI 工具配置（`.agents/`、`.claude/`、`.mimocode/`、`.kimi-code/`、`.archon/`）**不纳入 DeepReader 仓库，也不上传 GitHub**。它们现在独立存放在本地仓库 `~/workspace/DeepReader-AI-Configs`，由该仓库单独管理。

DeepReader 主仓库通过 symlink 引用独立仓库：

```
<repo-root>/.agents   -> ~/workspace/DeepReader-AI-Configs/.agents
<repo-root>/.claude   -> ~/workspace/DeepReader-AI-Configs/.claude
<repo-root>/.mimocode -> ~/workspace/DeepReader-AI-Configs/.mimocode
<repo-root>/.kimi-code -> ~/workspace/DeepReader-AI-Configs/.kimi-code
<repo-root>/.archon   -> ~/workspace/DeepReader-AI-Configs/.archon
```

创建 worktree 时会自动通过 symlink 共享 AI 配置：

```bash
# 一键创建 worktree 并自动链接 AI 工具目录
npm run worktree:create <branch-name> [base-ref]

# 或直接使用脚本
bash scripts/setup-worktree.sh <branch-name> [base-ref]
```

脚本会执行：
1. `git worktree add .worktrees/<branch-name> -b <branch-name> <base-ref>`
2. 自动创建 symlink，指向独立 AI 配置仓库：
   - `.worktrees/<branch-name>/.agents`
   - `.worktrees/<branch-name>/.claude`
   - `.worktrees/<branch-name>/.mimocode`
   - `.worktrees/<branch-name>/.kimi-code`
   - `.worktrees/<branch-name>/.archon`
3. 安装依赖、构建、部署到 test-vault、运行单元测试

如果已有 worktree 需要补建 symlink，可单独运行：

```bash
bash scripts/setup-worktree-symlinks.sh .worktrees/<branch-name>
```

> 若已有 worktree 中存在旧的物理 AI 配置目录（非 symlink），脚本会跳过它们。请手动删除或备份后再运行脚本，以确保所有 worktree 使用统一的独立仓库配置。

### 让 AI 自动创建 worktree

如果你直接对 AI 说"帮我新建一个 worktree 分支"，AI 通常会执行 `git worktree add`。为确保 AI 配置可用，项目提供了三层保障：

1. **Claude Code 自定义命令**（推荐）：
   - 输入 `/create-worktree feat/my-feature main`
   - Claude 会执行 `git worktree add` + 自动 symlink

2. **MimoCode 自定义命令**：
   - 输入 `create-worktree feat/my-feature main`
   - MimoCode 会执行 `git worktree add` + 自动 symlink

3. **Claude Code PostToolUse Hook（兜底）**：
   - 当 Claude 执行任意 `git worktree add ...` 命令后，`.claude/settings.json` 中注册的 `auto_symlink_worktree.py` hook 会自动检测并补建 `.agents`、`.claude`、`.mimocode`、`.kimi-code`、`.archon` 的 symlink。
   - 这样即使 AI 没有使用自定义命令，直接调用 `git worktree add`，AI 配置也会被自动链接。

> ⚠️ `.kimi-code/mcp.json`、`.archon/.env` 等文件含 API key，通过 symlink 共享时请确保工作目录安全。

## 项目规则
完整规则见 `.project-rules/` 目录

## Graphify 知识图谱

本项目已部署 [graphify](https://github.com/safishamsi/graphify)，把代码/文档构建为可查询的知识图谱（`graphify-out/`，本地索引，不入 git）。

### 优先用 graphify 而非 grep

当代码问题出现时，先查 `graphify-out/graph.json`（如果存在）：

```bash
graphify query "<问题>"             # 范围化子图，比 GRAPH_REPORT.md 或 grep 小得多
graphify path "<A>" "<B>"           # 两个节点之间的最短路径
graphify explain "<概念>"           # 概念 + 邻居的纯语言解释
graphify affected "<符号>"          # 反向追溯：谁会被这个符号的改动影响
```

只在以下情况直接读源文件：
- graphify 已定位范围后，需要修改/调试具体行
- graphify 没有覆盖的内容（新建文件、刚改过未重建的代码）

### 更新 graph

代码改动后跑（AST-only，无 API 成本）：

```bash
graphify update .                   # 增量更新代码文件
graphify extract .                  # 完整重建（含 docs/PDFs 的语义抽取，需 LLM key）
```

### 与 codegraph MCP 的关系

| 工具 | 索引内容 | 强项 |
|------|---------|------|
| **codegraph** (`.codegraph/`) | 代码符号关系（callers/callees/impact） | sub-ms 查询，符号级精准 |
| **graphify** (`graphify-out/`) | 知识图谱（语义关联 + 跨文件 surprising connections） | 概念级查询，docs + 代码统一 |

二者互补：codegraph 答"谁调用谁"，graphify 答"概念 A 怎么连到概念 B"。

### 给非 Claude Code 的 agent

通用 skill 在 `.agents/skills/graphify/SKILL.md`（Codex/Aider/OpenCode/Kimi Code 等可直接读取并按其指令运行）。Claude Code 用户的 skill 在 `~/.claude/skills/graphify/SKILL.md`（全局）。

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
