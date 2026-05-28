# 安全与隐私

- **纯本地架构**: 索引、搜索、向量存储全部在本地完成，不依赖外部后端服务。
- **API Key 存储**: LLM API Key 存储在 Obsidian 的 `data.json` 中（本地文件），不传输到任何第三方服务器（除目标 LLM API 端点外）。
- **网络请求**: 仅向用户配置的 LLM API Base URL 发送请求（OpenAI 兼容格式）。
- **敏感文件排除**: `.env` 等敏感文件受工具保护，不会被读取。
- **插件权限**: 需要桌面端（`isDesktopOnly: true`），因为依赖 Node.js 模块（`path`、`fs` 等）进行文件解析。

## Z-Library 法律声明

Z-Library 功能**默认关闭**，采用双开关保护机制：

1. **编译时开关** (`ZLIBRARY_ENABLED`): 代码默认编译进插件
2. **运行时开关** (`enableZlibrary`): 用户默认无法使用，必须手动启用

用户启用 Z-Library 功能前必须阅读并同意法律警告（`src/zlibrary/DISCLAIMER.ts`）。由于 Z-Library 在某些地区存在法律争议，用户需自行承担使用风险。

## 第三方服务

以下服务通过用户配置的 API Key 访问，用户需自行了解各服务的使用条款：

| 服务 | 用途 | 数据流向 |
|------|------|----------|
| MinerU | PDF 解析 | 文件上传至 MinerU 服务器 |
| 智谱 GLM-OCR | 图像文字识别 | 图片上传至智谱服务器 |
| OpenAI/DeepSeek 等 | LLM 对话 | 对话内容发送至 LLM 服务商 |
| Z-Library | 电子书搜索下载 | 搜索请求发送至 Z-Library |
