# 测试策略

## 单元测试 / 集成测试（Vitest）

```bash
# 监听模式
npm run test

# 单次运行
npm run test:run

# UI 界面
npm run test:ui
```

- **配置**: `vitest.config.ts`
- **环境**: `jsdom`，`globals: true`
- **Setup**: `tests/setup.ts` — 在 `HTMLElement.prototype` 上挂载 Obsidian 的 DOM 扩展方法（`addClass`、`createEl`、`empty` 等）。
- **Mock**: `tests/__mocks__/obsidian.ts` 提供 `TFile`、`TFolder`、`App`、`Notice` 等 Mock。
- **路径别名**: `@` → `./src`，`@tests` → `./tests`，`obsidian` → `./tests/__mocks__/obsidian.ts`
- **排除项**: `tests/components/message.test.ts`、`tests/views/sidebar-view.test.ts`、`src/api/__tests__/server-manager.test.ts`（引用了已移除组件或需要重构）。

**测试文件位置**:
- `src/**/__tests__/**/*.test.ts` — 与源码同目录的测试（Agent、PageIndex、Config、Components）。
- `tests/components/*.test.ts` — 组件测试。
- `tests/views/*.test.ts` — 视图测试。

## E2E 测试（WebdriverIO）

```bash
npx wdio run tests/wdio.conf.ts
```

- **配置**: `tests/wdio.conf.ts`
- **测试文件**: `tests/e2e/specs/**/*.e2e.ts`
- **Obsidian 选项**: 使用 `./test-vault` 作为 Vault，`./bin` 作为插件目录。
- **超时**: 10 分钟（LLM 摘要多章节耗时较长）。
- **缓存目录**: `.obsidian-cache/`（安装器、Obsidian 应用、版本信息）。

## 重点覆盖

PageIndex API、Agent Tools、搜索质量。
