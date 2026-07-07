# 测试环境快速配置

## 🚀 一键配置

```bash
npm run setup:test-env
```

## 📋 检查环境

```bash
npm run setup:test-env:check
```

## 🧪 运行测试

```bash
# 单元测试（不需要 Obsidian）
npm run test:run

# 冒烟测试（需要 Obsidian 运行）
npm run smoke:core

# 轻量 E2E（需要 Obsidian 运行 + 索引完整）
npm run e2e-light
```

## 🔧 手动配置（如果需要）

### 1. 启动 Obsidian
```bash
open -a "/Applications/Obsidian.app" "/Users/lizhao/workspace/DeepReader/test-vault"
```

### 2. 启用插件
编辑 `test-vault/.obsidian/community-plugins.json`，确保包含 `"deepreader-dev"`

### 3. 配置 API Key
在 Obsidian 设置 → 第三方插件 → DeepReader 中配置 API Key

### 4. 触发索引
在 Obsidian 中打开任意 PDF/EPUB 文件

## ❓ 常见问题

**Q: Obsidian 未连接？**
A: 确保 Obsidian 已启动并加载了 test-vault

**Q: 插件未加载？**
A: 在 Obsidian 设置中禁用并重新启用 DeepReader

**Q: 索引文件缺失？**
A: 在 Obsidian 中打开任意 PDF/EPUB 文件触发索引

**Q: API Key 未配置？**
A: 设置环境变量 `export DEEPSEEK_API_KEY="your-key"`

**Q: 多 vault 场景连接错误？**
A: 使用 `TARGET_VAULT` 环境变量指定正确的 vault

## 📊 环境状态

运行 `npm run setup:test-env:check` 查看当前环境状态：

```
✓ 目录结构完整
✓ 插件已启用
✓ Obsidian 正在运行
✓ Obsidian 连接正常
✓ 插件已加载
✓ 索引文件完整 (4 本书)
✓ API Key 已配置
```

## 🎯 测试层级选择

| 场景 | 命令 | 耗时 |
|------|------|------|
| 改一行代码 | `npm run smoke:core` | ~10s |
| 验证功能流程 | `npm run e2e-light` | ~90s |
| 验证函数逻辑 | `npm run test:run` | ~55s |
| 多步 UI 交互 | `npx wdio run tests/wdio.conf.ts` | ~5min |

## 🔧 多 vault 支持

如果 Obsidian 同时运行多个 vault，可以使用 `TARGET_VAULT` 环境变量指定目标：

```bash
# 使用默认 vault (test-vault)
npm run smoke:core

# 指定其他 vault
TARGET_VAULT=my-vault npm run smoke:core
```

## 📚 相关文档

- [测试环境配置](./test-env-setup.md) — 完整配置指南
- [测试能力梳理](./test-capabilities.md) — 测试架构和覆盖统计
- [测试总结](./test-summary.md) — 快速参考
