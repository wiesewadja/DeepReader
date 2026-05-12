# 代码风格与规范

## TypeScript

- **编译目标**: ES6（`tsconfig.json`），esbuild target `es2018`。
- **模块**: ESNext，`isolatedModules: true`。
- **严格检查**: `noImplicitAny`, `strictNullChecks`。
- **类型检查**: 构建时通过 `tsc -noEmit -skipLibCheck` 检查。
- **源码映射**: `inlineSourceMap` + `inlineSources`（开发模式）。

## 注释风格

- 使用中文注释描述业务逻辑和复杂算法。
- JSDoc 用于公共 API 和类型说明。

## UI 组件规范

- 不使用前端框架（React/Vue/Svelte），全部使用原生 DOM API + Obsidian 的 `createEl` 风格。
- 组件通常在 `index.ts` 中导出，主逻辑在同名 `.ts` 文件中。
- 流式消息使用 `isStreaming` 标记，结束时必须调用 `onStreamingEnd()` 完成渲染。

## 日志系统

- 统一使用 `src/utils/logger.ts`。
- 按模块分类：`agentLog`、`toolsLog`、`contextLog`、`uiLog`、`serviceLog`、`apiLog`。
- 通过 `setLogEnabled(true/false)` 控制全局开关，受插件设置 `enableDebugLog` 控制。
- 错误日志（`log.error`）始终输出，不受开关影响。

## 文件路径与 Vault API

- 所有 Vault 文件操作通过 `app.vault.adapter` 或 `app.vault` API 进行。
- PageIndex 需要文件绝对路径；在 Obsidian 中通过 `vault.adapter.getBasePath()` 获取 Vault 根目录后拼接。
- 插件在 Vault 中创建的目录:
  - `DeepReader/` — 导出书籍、封面、调试文件。
  - `DeepReader/skills/` — 内置 Skill 文件。
  - `.pageindex/{bookId}/` — 索引数据（`book-meta.json`、`bm25.json`、`vectors.jsonl` 等）。

## Git 提交规范

```
<type>: <subject>

feat:     新功能
fix:      修复 bug
refactor: 重构（不改变功能）
docs:     文档更新
test:     测试相关
perf:     性能优化
chore:    构建/工具链相关
```

**未经明确指示，不要自行提交代码。**
