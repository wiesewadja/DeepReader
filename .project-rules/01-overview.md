# 项目概述

**DeepReader**: 奚童，Obsidian 深度阅读插件，实现 PDF/EPUB 智能索引、语义搜索和 AI 辅助阅读。

- **定位**: 纯前端 Obsidian Plugin，无需后端服务器，所有索引和搜索在本地完成。
- **语言环境**: 项目注释、文档、UI 文案以中文为主，代码标识符使用英文。

## 核心能力

- 解析 PDF/EPUB，生成结构化 Markdown 笔记并导出到 Obsidian Vault。
- 本地混合搜索（BM25 + 向量语义搜索）。
- 内置 AI Agent（FrontendAgent），基于 LangGraph 实现四层认知状态机（检视阅读 / 分析阅读 / 主题阅读），支持与书籍内容的智能问答。
- **微信读书同步**：绑定微信读书账号，同步书籍标注、笔记、评论和阅读进度，支持与本地 PDF/EPUB 书籍关联。
- **Z-Library 搜索下载**：通过 Z-Library 搜索并下载电子书（默认关闭，用户需手动启用并同意法律声明）。

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 语言 | TypeScript 5.x | 目标 ES6，模块 ESNext，启用 `strictNullChecks` |
| 运行时 | Electron (Obsidian) | 桌面端 only，`isDesktopOnly: true` |
| 构建 | esbuild 0.19 | 打包 `src/main.ts` → `bin/main.js` (CJS, es2018) |
| 样式 | 原生 CSS | 源文件在 `src/styles/`，通过自定义脚本打包为 `bin/styles.css` |
| Agent 框架 | LangGraph + LangChain | `@langchain/core`、`@langchain/langgraph`、`@langchain/openai` |
| LLM 接入 | OpenAI 兼容 API | 支持 DeepSeek、Kimi、智谱、SiliconFlow、OpenAI 等 |
| 测试 (单元) | Vitest 1.x | `jsdom` 环境，单线程线程池 |
| 测试 (E2E) | WebdriverIO 9.x + `wdio-obsidian-service` | 在真实 Obsidian 实例中测试，超时 10 分钟 |
| 其他依赖 | `pdf-parse`、`turndown`、`xml2js`、`adm-zip`、`uuid`、`zod` | 文档解析与工具库 |
