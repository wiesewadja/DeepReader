# ADR-005: 数据文件用 fs 直接读写而非 Vault API

## 状态
Accepted

## 日期
2026-04（PageIndex 实现）

## 背景

DeepReader 需要读写索引数据（`.pageindex/`）、阅读进度（`last-pages.json`）等文件。Obsidian 提供了 Vault API（`vault.adapter.read/write`），也有 Node.js 的 `fs` 模块可用。

## 决策

数据文件（索引、进度、配置）通过 Node.js `fs` 直接读写，路径由 `getVaultPath()` 获取。用户内容文件（笔记、摘录）通过 Vault API。

## 替代方案

### 全部用 Vault API
- 优点：兼容 Obsidian 移动端、理论上更安全
- 缺点：Vault API 不支持原子写入（tmp+rename）、不支持 `mkdir -p`、大文件性能差
- 放弃原因：`last-page-store.ts` 和 `archive.ts` 需要原子写入防止数据损坏，Vault API 不支持

### 全部用 fs
- 优点：一致性好，性能更好
- 缺点：在 Obsidian 移动端不可用（插件声明 `isDesktopOnly: true`，目前不是问题）
- 放弃原因：用户内容文件（笔记、摘录）应走 Vault API 以获得 Obsidian 的元数据管理

## 后果
- 插件只能运行在桌面端（`isDesktopOnly: true`），不能支持移动端
- 数据文件写入用原子模式（tmp+rename），不怕断电损坏
- 需要维护两套文件操作模式（fs vs Vault API）
