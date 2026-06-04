# DeepReader

Obsidian 深度阅读插件。AI 伴读 + PDF/EPUB 索引 + 微信读书同步。

## 命令
- 构建: `npm run build` → `bin/`
- 测试: `npm run test:run`（单元）/ `npx wdio run tests/wdio.conf.ts`（E2E）
- 开发: `npm run dev`（watch）
- 部署: `npm run deploy` → test-vault

## 架构
- UI: 纯 TypeScript + DOM（无框架）
- AI: LangGraph（四层认知引擎） + FrontendAgent
- 索引: PageIndex（Vector + BM25 混合搜索）
- 阅读: ReadingModeService + PagePaginator（分页+章节导航+位置恢复）
- 记忆: 用户画像 + 长期记忆（MEMORY.md → 渐进理解用户）
- 构建: esbuild（CJS）

## 运行时
- Obsidian 插件，跑在 Electron 渲染进程
- 有 DOM + Obsidian API，无完整 Node.js
- 调试: Obsidian 内 `Cmd+Option+I` → `app.plugins.plugins['deepreader']`
- ⛔ 不是网页，不要用浏览器 MCP / Playwright 调试

## 约束
- 日志用 `utils/logger.ts`
- 数据文件用 `fs`（原子写入），用户内容用 Vault API
- 插件 ID 用 `this.manifest.id`，不硬编码 `'deepreader'`
- Agent 唯入口: `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- 不自提交代码，提交前告知用户

## 项目规则
完整规则见 `.project-rules/` 目录
