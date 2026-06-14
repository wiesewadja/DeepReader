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

## 部署陷阱
- `manifest.json` 的 `id` 字段必须与插件目录名一致（`deepreader-dev/` → id=`deepreader-dev`），否则 Obsidian 静默加载失败
- `community-plugins.json` 只能包含实际存在的插件 ID，空目录会导致加载冲突
- wdio 从 `bin/` 加载插件（不是 test-vault），`bin/manifest.json` 的 id 也要匹配
- 跨 worktree 部署时需同时更新主仓库的 `bin/` 和 `test-vault/.obsidian/plugins/deepreader-dev/`

## Worktree Skill/Agent 同步
- `.claude/` 目录是 symlink → worktree 自动继承，不需要手动更新
- `.mimocode/` 目录不是 symlink → 新增 skill/agent 时必须手动同步到 worktree
- 同步命令: `cp .claude/skills/xxx/SKILL.md .mimocode/skills/xxx/SKILL.md`

## 项目规则
完整规则见 `.project-rules/` 目录
