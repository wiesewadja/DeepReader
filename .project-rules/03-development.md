# 构建与开发

## 命令

```bash
# 安装依赖
npm install

# 开发模式（esbuild watch，监听文件变化）
npm run dev

# 完整构建（类型检查 tsc -noEmit + CSS 打包 + JS 打包）
npm run build

# 同步版本号（package.json → manifest.json）
npm run sync-version

# 打包 CSS
npm run copy-css

# 部署到测试 Vault（构建后复制到 test-vault/.obsidian/plugins/deepreader/）
npm run deploy
```

## 开发 Workflow

1. `npm run dev` 启动 watch。
2. 在 Obsidian 中打开 `test-vault/`。
3. 修改代码后，在 Obsidian 中按 `Cmd+R` 重载插件。

## 调试

- **开发者工具**: Cmd+Option+I
- **插件实例**: `app.plugins.plugins['deepreader']`
- **测试 Vault**: `test-vault/` 目录
- **日志**: 使用 `utils/logger.ts` 的 `uiLog` / `serviceLog`

### Node.js 兼容

`src/pageindex/node.ts` 是 Electron/Node.js 兼容入口，排除了 Bun 特有的 Vault 索引功能。在 Obsidian 中始终通过 `node.ts` 导入 PageIndex。

### esbuild external

`obsidian`、`electron`、CodeMirror 相关包、`builtin-modules`、`node:*` 模块均标记为 external，不参与打包。

### PDF 解析特殊处理

esbuild banner 中注入代码，设置 `window.PDFJS.disableWorker = true` 并 polyfill `require.ensure`，以兼容 Electron 环境。
