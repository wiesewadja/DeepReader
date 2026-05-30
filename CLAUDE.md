# DeepReader

Obsidian 深度阅读插件。AI 伴读 + PDF/EPUB 索引 + 微信读书同步。

## 命令
- 构建: `npm run build` → `bin/`
- 测试: `npm run test:run`（单元）/ `npx wdio run tests/wdio.conf.ts`（E2E）
- 开发: `npm run dev`（watch）
- 部署: `npm run deploy` → test-vault

## 架构
- UI: 纯 TypeScript + DOM（无框架）
- AI: LangGraph（四层） + FrontendAgent
- 索引: PageIndex（Vector + BM25）
- 构建: esbuild（CJS）

## 运行时
- Obsidian 插件，跑在 Electron 渲染进程
- 有 DOM + Obsidian API，无完整 Node.js
- 调试: Obsidian 内 `Cmd+Option+I` → `app.plugins.plugins['deepreader']`
- ⛔ 不是网页，不要用浏览器 MCP / Playwright / CDP 调试

## 约束
- 日志用 `utils/logger.ts`
- 文件路径通过 Vault API，不硬编码
- Agent 唯入口: `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- 不自提交代码，提交前告知用户

## 项目规则
完整规则见 `.project-rules/` 目录
