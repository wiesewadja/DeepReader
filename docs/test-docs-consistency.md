# 测试文档一致性检查清单

## 一、文档更新记录

### 2026-07-08 更新

**更新内容**：
1. 添加多 vault 支持说明
2. 更新环境检查集成说明
3. 添加 `TARGET_VAULT` 环境变量文档
4. 更新测试命令快速参考

**更新的文件**：
- `docs/test-capabilities.md` — 完整测试架构和覆盖统计
- `docs/test-summary.md` — 测试能力梳理总结
- `docs/test-env-setup.md` — 环境配置详细指南
- `docs/test-env-quickstart.md` — 快速参考卡片
- `.project-rules/04-testing.md` — 测试策略文档

## 二、文档与代码一致性检查

### 2.1 测试架构

| 检查项 | 文档 | 代码 | 状态 |
|--------|------|------|------|
| 四层测试架构 | ✅ 已记录 | ✅ 已实现 | ✅ 一致 |
| 单元测试命令 | `npm run test:run` | `vitest run` | ✅ 一致 |
| 冒烟测试命令 | `npm run smoke:core` | `node scripts/smoke/smoke.mjs --level core` | ✅ 一致 |
| 轻量 E2E 命令 | `npm run e2e-light` | `node scripts/e2e-light/run.mjs` | ✅ 一致 |
| WebdriverIO 命令 | `npx wdio run tests/wdio.conf.ts` | `webdriverio` | ✅ 一致 |

### 2.2 环境配置

| 检查项 | 文档 | 代码 | 状态 |
|--------|------|------|------|
| 一键配置命令 | `npm run setup:test-env` | `node scripts/setup-test-env.mjs` | ✅ 一致 |
| 环境检查命令 | `npm run setup:test-env:check` | `node scripts/setup-test-env.mjs --check` | ✅ 一致 |
| 多 vault 支持 | `TARGET_VAULT` 环境变量 | `const TARGET_VAULT = process.env.TARGET_VAULT \|\| 'test-vault'` | ✅ 一致 |
| 环境检查集成 | 冒烟测试和轻量 E2E 自动检查 | `checkEnvironment()` 函数 | ✅ 一致 |

### 2.3 测试工具 API

| 检查项 | 文档 | 代码 | 状态 |
|--------|------|------|------|
| evalObsidian 函数 | ✅ 已记录 | ✅ 已实现 | ✅ 一致 |
| vault 参数 | ✅ 已记录 | ✅ 已实现 | ✅ 一致 |
| DOM 操作 API | ✅ 已记录 | ✅ 已实现 | ✅ 一致 |
| createClient 函数 | ✅ 已记录 | ✅ 已实现 | ✅ 一致 |

### 2.4 测试策略

| 检查项 | 文档 | 代码 | 状态 |
|--------|------|------|------|
| 5 类标准策略 | ✅ 已记录 | N/A | ✅ 一致 |
| 风险评估矩阵 | ✅ 已记录 | N/A | ✅ 一致 |
| 决策树 | ✅ 已记录 | N/A | ✅ 一致 |
| 职责边界矩阵 | ✅ 已记录 | N/A | ✅ 一致 |

## 三、代码与文档同步检查

### 3.1 新增功能

| 功能 | 代码位置 | 文档位置 | 状态 |
|------|----------|----------|------|
| 多 vault 支持 | `scripts/smoke/lib/obsidian-cli.mjs` | `docs/test-capabilities.md` | ✅ 已同步 |
| 环境检查集成 | `scripts/smoke/smoke.mjs` | `docs/test-capabilities.md` | ✅ 已同步 |
| 一键配置脚本 | `scripts/setup-test-env.mjs` | `docs/test-env-setup.md` | ✅ 已同步 |

### 3.2 修改功能

| 功能 | 代码位置 | 文档位置 | 状态 |
|------|----------|----------|------|
| exec 函数 | `scripts/smoke/lib/obsidian-cli.mjs` | `docs/test-capabilities.md` | ✅ 已同步 |
| evalObsidian 函数 | `scripts/smoke/lib/obsidian-cli.mjs` | `docs/test-capabilities.md` | ✅ 已同步 |
| S-LD 测试 | `scripts/smoke/checks/core/s-ld.mjs` | `docs/test-capabilities.md` | ✅ 已同步 |

## 四、环境变量文档

| 环境变量 | 说明 | 默认值 | 文档位置 | 状态 |
|----------|------|--------|----------|------|
| `TARGET_VAULT` | 目标 vault 名称 | `test-vault` | `docs/test-capabilities.md` | ✅ 已记录 |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | 无 | `docs/test-env-setup.md` | ✅ 已记录 |
| `OPENAI_API_KEY` | OpenAI API Key | 无 | `docs/test-env-setup.md` | ✅ 已记录 |
| `OBSIDIAN_CLI` | Obsidian CLI 路径 | `obsidian` | `docs/test-env-setup.md` | ✅ 已记录 |

## 五、测试命令文档

### 5.1 环境配置命令

| 命令 | 说明 | 文档位置 | 状态 |
|------|------|----------|------|
| `npm run setup:test-env` | 一键配置测试环境 | `docs/test-env-quickstart.md` | ✅ 已记录 |
| `npm run setup:test-env:check` | 仅检查环境状态 | `docs/test-env-quickstart.md` | ✅ 已记录 |

### 5.2 单元测试命令

| 命令 | 说明 | 文档位置 | 状态 |
|------|------|----------|------|
| `npm run test:run` | 运行所有单元测试 | `docs/test-capabilities.md` | ✅ 已记录 |
| `npx vitest run tests/unit/agent/` | 运行特定模块 | `docs/test-capabilities.md` | ✅ 已记录 |

### 5.3 冒烟测试命令

| 命令 | 说明 | 文档位置 | 状态 |
|------|------|----------|------|
| `npm run smoke:core` | 核心场景 (11 个) | `docs/test-capabilities.md` | ✅ 已记录 |
| `npm run smoke:full` | 完整场景 (27 个) | `docs/test-capabilities.md` | ✅ 已记录 |
| `node scripts/smoke/smoke.mjs --only S-22,S-23` | 指定场景 | `docs/test-capabilities.md` | ✅ 已记录 |
| `node scripts/smoke/smoke.mjs --no-env-check` | 跳过环境检查 | `.project-rules/04-testing.md` | ✅ 已记录 |

### 5.4 轻量 E2E 命令

| 命令 | 说明 | 文档位置 | 状态 |
|------|------|----------|------|
| `npm run e2e-light` | 运行所有轻量 E2E | `docs/test-capabilities.md` | ✅ 已记录 |
| `node scripts/e2e-light/run.mjs --spec ...` | 运行单个测试 | `docs/test-capabilities.md` | ✅ 已记录 |

### 5.5 WebdriverIO 命令

| 命令 | 说明 | 文档位置 | 状态 |
|------|------|----------|------|
| `npx wdio run tests/wdio.conf.ts` | 运行所有 WebdriverIO 测试 | `docs/test-capabilities.md` | ✅ 已记录 |
| `npx wdio run tests/wdio.conf.ts --spec ...` | 运行单个测试 | `docs/test-capabilities.md` | ✅ 已记录 |

## 六、文档完整性检查

### 6.1 测试架构文档

- [x] 四层测试架构说明
- [x] 测试覆盖统计
- [x] 测试工具 API
- [x] 测试策略
- [x] 环境配置
- [x] 多 vault 支持
- [x] 测试命令快速参考

### 6.2 环境配置文档

- [x] 一键配置命令
- [x] 环境检查集成
- [x] 多 vault 支持
- [x] 手动配置指南
- [x] 常见问题
- [x] 测试命令参考
- [x] 环境变量说明

### 6.3 测试策略文档

- [x] 四层测试架构
- [x] 决策树
- [x] 各层级详细说明
- [x] 职责边界矩阵
- [x] 环境配置
- [x] 重点覆盖

## 七、一致性验证结果

### 7.1 代码与文档一致性

| 检查项 | 状态 |
|--------|------|
| 测试架构 | ✅ 一致 |
| 环境配置 | ✅ 一致 |
| 测试工具 API | ✅ 一致 |
| 测试策略 | ✅ 一致 |
| 多 vault 支持 | ✅ 一致 |

### 7.2 文档完整性

| 文档 | 状态 |
|------|------|
| `docs/test-capabilities.md` | ✅ 完整 |
| `docs/test-summary.md` | ✅ 完整 |
| `docs/test-env-setup.md` | ✅ 完整 |
| `docs/test-env-quickstart.md` | ✅ 完整 |
| `.project-rules/04-testing.md` | ✅ 完整 |

### 7.3 最终结论

**所有测试文档已与代码保持一致**，包括：
- 测试架构描述
- 环境配置说明
- 多 vault 支持
- 测试命令文档
- 测试策略文档

**下一步**：
1. 定期检查文档与代码的一致性
2. 新增功能时同步更新文档
3. 保持文档简洁明了
