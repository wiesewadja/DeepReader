# 更新日志

所有重要的版本更新都会记录在此文件中。

## 格式规范

```
## [版本号] - YYYY-MM-DD

### 新增
### 优化
### 修复
### 安全
```

---

## [2026.05.27] - 2026-05-27

### 新增
- PI Agent RPC 协议升级，支持流式输出
- PI Agent 自动重试机制
- PI Agent Extension UI 支持
- PI Agent 统计功能
- PI Agent steer 指令支持
- 新增 bugfix 工作流（测试优先 + 分流处理）
- 高级设置 Tab 调整布局，PI Agent 置顶

### 修复
- PI CLI 检测兼容 Obsidian Electron 渲染进程
- 设置页合并问题修复

---

## [2026.05.20] - 2026-05-20

### 新增
- 支持配置 PI CLI 自定义路径
- 支持配置 MinerU/OCR 自定义 API 端点

### 优化
- Z-Library 双重开关设计（编译时 + 运行时）
- Z-Library 法律免责声明弹窗
- PI Agent 跨平台路径检测（支持 Linux/Windows）

---

## 早期版本

更早的版本记录请查看 Git 提交历史：
```bash
git log --oneline
```

---

## 发布说明

### 安装方式

1. **手动安装**
   - 从 GitHub Releases 下载最新版本
   - 解压到 `.obsidian/plugins/deepreader/`

2. **BRAT 插件安装**
   - 安装 BRAT 插件
   - 添加 Beta 测试仓库

### 升级注意

- 升级前建议备份 Vault
- 重大版本升级后可能需要重新索引文档
- API Key 配置不受影响

---

*本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/) 语义化版本规范。*
