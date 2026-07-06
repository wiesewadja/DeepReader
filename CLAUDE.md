# DeepReader

Obsidian 插件，奚童，AI 伴读 + PDF/EPUB 索引 + 微信读书同步。

## 命令
- 单元测试: `npm run test:run`
- E2E (wdio): `npx wdio run tests/wdio.conf.ts`（独立 Obsidian 实例，从 `bin/` 加载）
- 冒烟测试: `node scripts/smoke/smoke.mjs`（core 11 场景）/ `node scripts/smoke/smoke.mjs --level full`（core+full 25 场景）/ `--only S-22,S-23` 指定场景
- 轻量 E2E: `scripts/smoke/lib/obsidian-cli.mjs` 的 `evalObsidian()`（对运行中的 Obsidian 执行 JS，冒烟测试底层也用它，但还可用于部署验证、问题排查等）
- 部署: `npm run deploy` → test-vault 的 `deepreader-dev/`（所有 worktree 都覆盖到同一个目录，**禁止**用分支名生成独立插件目录）

## 架构
- UI: 纯 TypeScript + DOM（无框架）
- AI: LangGraph（四层认知引擎） + FrontendAgent
- 索引: PageIndex（Vector + BM25 混合搜索）
- 阅读: ReadingModeService + PagePaginator（分页+章节导航+位置恢复）
- 记忆: 用户画像 + 长期记忆（MEMORY.md → 渐进理解用户）

## 运行时
- Obsidian 插件，跑在 Electron 渲染进程
- 有 DOM + Obsidian API，无完整 Node.js
- ⛔ 不是网页，不要用浏览器 MCP / Playwright 调试，使用 obsidian-ui-debug 调试

## 约束
- 日志用 `utils/logger.ts`
- 数据文件用 `fs`（原子写入），用户内容用 Vault API
- 插件 ID 用 `this.manifest.id`，不硬编码 `'deepreader'`
- Agent 唯入口: `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- 提交前将代码修改方案整理后告知用户审查，用户确认后提交代码
- 每个重要功能都拉取.worktrees/目录下的独立worktree分支，完成后调用测试工程师代理进行测试
- 移动端兼容：禁止业务代码静态 `import` Node 核心模块（fs/path/crypto/os/child_process）或 `adm-zip`，会让插件在移动端加载即崩。统一走 `utils/node-compat.ts` 惰性工厂。详见 `.project-rules/08-mobile-compat.md`

## 部署陷阱
- `manifest.json` 的 `id` 字段必须与插件目录名一致（`deepreader-dev/` → id=`deepreader-dev`），否则 Obsidian 静默加载失败
- `community-plugins.json` 只能包含实际存在的插件 ID，空目录会导致加载冲突
- wdio 从 `bin/` 加载插件（不是 test-vault），`bin/manifest.json` 的 id 也要匹配
- **所有 worktree 都部署到同一个 `deepreader-dev/`**（覆盖式）。禁止按分支名生成独立插件目录（如 `deepreader-wt-feat-xxx`），那会让 Obsidian 里出现多个同名 DeepReader 无法区分。详见 `.project-rules/07-deployment.md`

## 项目规则
完整规则见 `.project-rules/` 目录