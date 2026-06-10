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
- **测试文件位置**:
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

## 轻量 E2E 测试

基于 `scripts/e2e-light/` 的轻量 E2E 框架，通过 `evalObsidian()` 对运行中的 Obsidian 实例执行 JavaScript，无需启动独立的 Obsidian 实例。

```bash
# 运行所有轻量 E2E 测试
node scripts/e2e-light/run.mjs

# 运行单个测试
node scripts/e2e-light/baseline.mjs
```

- **框架入口**: `scripts/e2e-light/run.mjs`
- **测试文件**: `scripts/e2e-light/specs/*.spec.mjs`
- **底层工具**: `scripts/smoke/lib/obsidian-cli.mjs` 的 `evalObsidian()` 函数
- **适用场景**: 索引质量验证、Agent 对话测试、微信读书集成、阅读模式分页等
- **优势**: 比完整 wdio E2E 快一个数量级，适合开发过程中快速验证

## 冒烟测试

基于轻量 E2E 框架的快速验证套件，确保核心功能未退化。

```bash
# core 11 场景（默认）
node scripts/smoke/smoke.mjs

# core + full 25 场景
node scripts/smoke/smoke.mjs --level full

# 指定场景
node scripts/smoke/smoke.mjs --only S-22,S-23
```

- **入口**: `scripts/smoke/smoke.mjs`
- **场景定义**: `scripts/smoke/scenes/`
- **底层工具**: 复用 `scripts/smoke/lib/obsidian-cli.mjs` 的 `evalObsidian()`
- **适用场景**: 部署后快速验证、CI 看门、问题排查

## 重点覆盖

PageIndex API、Agent Tools、搜索质量。
