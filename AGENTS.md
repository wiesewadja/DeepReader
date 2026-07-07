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

## 红线（不可违背）
- ⛔ 未经用户明确指示，不自行 `git commit` / `push` / 改远端分支
- ⛔ 业务代码禁止静态 `import` Node 核心模块（fs/path/crypto/os/child_process）或 `adm-zip`，会让插件在移动端加载即崩。统一走 `utils/node-compat.ts` 惰性工厂。
- ⛔ 调试 Obsidian UI 用 obsidian-ui-debug，禁用浏览器 MCP / Playwright
- worktree 合入 `dev` 前 `npm run test:run` 必须过；测试工程师代理只在 dev→main 这层跑，worktree→dev 不跑

## 约束
- 日志用 `utils/logger.ts`
- 数据文件用 `fs`（原子写入），用户内容用 Vault API
- 插件 ID 用 `this.manifest.id`，不硬编码 `'deepreader'`
- Agent 唯入口: `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`

## 开发流程
完整分支模型与质量门（worktree → dev → main 三层）：

@.project-rules/09-branching.md

## 部署陷阱
- `manifest.json` 的 `id` 字段必须与插件目录名一致（`deepreader-dev/` → id=`deepreader-dev`），否则 Obsidian 静默加载失败
- `community-plugins.json` 只能包含实际存在的插件 ID，空目录会导致加载冲突
- wdio 从 `bin/` 加载插件（不是 test-vault），`bin/manifest.json` 的 id 也要匹配
- **所有 worktree 都部署到同一个 `deepreader-dev/`**（覆盖式）。禁止按分支名生成独立插件目录（如 `deepreader-wt-feat-xxx`），那会让 Obsidian 里出现多个同名 DeepReader 无法区分。

@.project-rules/07-deployment.md

## 项目规则
其余完整规则（01–06、08 等未内联的）见 `.project-rules/` 目录，按需读取；07 部署、09 分支模型已在上方对应段 `@` 导入。**接任务前按任务域主动读相关文件**：

| 任务域 | 读 |
|--------|-----|
| 改代码 / 找模块位置 | 02-architecture、05-conventions |
| 碰用户数据 / API Key / 隐私 | 06-security-privacy |
| 移动端相关 / Node 模块 | 08-mobile-compat |
| 写测试 / 选测试层级 | 04-testing |
| 改构建 / 加依赖 / 调试方法 | 03-development |
| 想了解项目全景 / 技术栈 | 01-overview |
