# DeepReader 测试能力梳理总结

## 一、测试架构

**四层测试架构**，按"能用轻量就别用全量"原则选择：

| 层级 | 工具 | 典型时长 | 使用频率 |
|------|------|----------|----------|
| **L1: 单元测试** | Vitest | ~55s | 高 |
| **L2: 冒烟测试** | evalObsidian | ~10-30s | 高 |
| **L3: 轻量 E2E** | evalObsidian | ~90s | 高 |
| **L4: WebdriverIO** | WebdriverIO | ~5min | 低 |

## 二、测试覆盖统计

### 单元测试 (L1)
- **测试文件**: 182 个
- **测试用例**: 2060 个 (1956 通过, 101 跳过, 3 todo)
- **覆盖模块**: agent (62), pageindex (27), services (11), views (9), weread (14), styles (6), 其他 (53)

### 冒烟测试 (L2)
- **核心场景**: 11 个
- **完整场景**: 27 个

### 轻量 E2E (L3)
- **测试规格**: 30 个
- **覆盖功能**: Agent 对话、搜索/索引、PDF/EPUB、微信读书、阅读模式、语音、安全等

### WebdriverIO (L4)
- **测试规格**: 4 个

## 三、环境配置（已优化）

### 一键配置

```bash
npm run setup:test-env      # 完整配置（自动修复）
npm run setup:test-env:check  # 仅检查
```

### 环境检查已集成到测试脚本

| 测试脚本 | 环境检查 | 跳过选项 |
|----------|----------|----------|
| `npm run smoke:core` | ✅ 自动检查 | `--no-env-check` |
| `npm run smoke:full` | ✅ 自动检查 | `--no-env-check` |
| `npm run e2e-light` | ✅ 自动检查 | 无 |

**运行测试时会自动检查环境**，如果环境不就绪会提示：
- 错误原因
- 修复建议（运行 `npm run setup:test-env`）

### 多 vault 支持

**问题**：当 Obsidian 同时运行多个 vault 时，CLI 会默认连接最近打开的 vault，导致测试无法连接到 test-vault。

**解决方案**：Obsidian CLI 现在会指定 `vault=test-vault` 参数，确保即使有多个实例也能正确连接。

**配置**：通过 `TARGET_VAULT` 环境变量可以指定目标 vault（默认 `test-vault`）。

```bash
# 使用默认 vault
npm run smoke:core

# 指定其他 vault
TARGET_VAULT=my-vault npm run smoke:core
```

### 环境依赖

| 依赖项 | 冒烟测试 | 轻量 E2E |
|--------|----------|----------|
| Obsidian 已运行 | ✅ 必需 | ✅ 必需 |
| 插件已加载 | ✅ 必需 | ✅ 必需 |
| 索引文件完整 | ❌ | ✅ 必需 |
| API Key 已配置 | ❌ | ✅ 必需 |

### 自动修复

| 问题 | 修复方式 |
|------|----------|
| 目录不存在 | `mkdir -p` |
| 插件未启用 | 修改 `community-plugins.json` |
| Obsidian 未运行 | `open -a Obsidian.app` |
| 插件未加载 | 重启插件 |
| 索引文件缺失 | 触发重新索引 |
| API Key 未配置 | 从环境变量读取 |

## 四、测试策略

### 5 类标准策略

| 任务类型 | 策略 | 推荐层级组合 |
|---------|------|------------|
| **新功能** | A | 单元 → 冒烟 → 轻量 E2E → WebdriverIO |
| **Bugfix** | B | 单元 + 冒烟 + 轻量 E2E |
| **重构** | C | 单元 + 冒烟 |
| **性能** | D | 单元（含 bench）+ 轻量 E2E 时序 |
| **集成** | E | 单元 + 标记 requires 的轻量 E2E |

### 风险评估矩阵

| 风险等级 | 触发条件 | 推荐覆盖 |
|---------|---------|---------|
| **极高** | 核心用户流程 | 4 层全跑 |
| **高** | 重构区、Bug 高发区 | 单元（高覆盖）+ 冒烟 + 轻量 E2E |
| **中** | 边缘 UI、配置 | 单元 + 冒烟 |
| **低** | 工具函数、类型 | 单元 |

### 决策树

```
改一行想看效果？
  → 冒烟（smoke:core，~10s）

验证关键用户流程？
  → 轻量 E2E（e2e-light，~90s）

验证函数逻辑？
  → 单元测试（test:run，~55s）

需要多步交互、视觉？
  → WebdriverIO（wdio，~5min）
```

## 五、测试命令快速参考

```bash
# 环境配置
npm run setup:test-env              # 一键配置测试环境
npm run setup:test-env:check        # 仅检查环境状态

# 单元测试
npm run test:run                    # 运行所有单元测试
npx vitest run tests/unit/agent/    # 运行特定模块

# 冒烟测试
npm run smoke:core                  # 核心场景 (11 个)
npm run smoke:full                  # 完整场景 (27 个)

# 轻量 E2E
npm run e2e-light                   # 运行所有轻量 E2E

# WebdriverIO
npx wdio run tests/wdio.conf.ts     # 运行所有 WebdriverIO 测试

# 部署验证
npm run deploy                      # 部署到 test-vault
npm run verify-deploy               # 验证部署
```

## 六、关键约束

### ❌ 禁止事项
- 不用浏览器 MCP / Playwright
- 测试不依赖外部 API
- 不用 `console.log`
- 不硬编码 vault 路径和 PLUGIN_ID

### ✅ 推荐实践
- 每个测试一个概念
- Bugfix 先写复现测试
- 真实断言 > 降级通过
- 测试必须分模块执行

## 七、文档索引

- [测试能力梳理](./test-capabilities.md) — 完整测试架构和覆盖统计
- [测试环境配置](./test-env-setup.md) — 环境配置详细指南
- [快速配置](./test-env-quickstart.md) — 快速参考卡片

## 八、当前状态

### ✅ 已完成
1. **单元测试覆盖全面**: 182 个测试文件，2060 个测试用例
2. **分层清晰**: 四层测试架构职责明确
3. **环境配置自动化**: 一键配置测试环境
4. **多 vault 支持**: 测试可以正确连接到 test-vault，即使有多个实例
5. **策略明确**: 5 类标准策略 + 风险评估矩阵

### 🎯 优化效果

| 维度 | 优化前 | 优化后 |
|------|--------|--------|
| 首次配置时间 | 10-15 分钟（手动） | 1-2 分钟（自动） |
| 日常开发配置 | 2-3 分钟 | 0（自动检查） |
| 环境问题排查 | 需要手动检查 | 自动修复 + 报告 |
| 测试执行 | 需要先确认环境 | 直接运行 |
| 多 vault 场景 | ❌ 连接错误 vault | ✅ 正确连接 test-vault |

## 九、下一步

1. **修复覆盖率报告**: 解决 vitest coverage 配置问题
2. **增加测试用例**: 覆盖更多边缘场景
3. **优化测试性能**: 减少测试执行时间
4. **完善文档**: 补充更多测试示例和最佳实践
