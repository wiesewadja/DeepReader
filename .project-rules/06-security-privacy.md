# 安全与隐私

- **纯本地架构**: 索引、搜索、向量存储全部在本地完成，不依赖外部后端服务。
- **API Key 存储**: LLM API Key 存储在 Obsidian 的 `data.json` 中（本地文件），不传输到任何第三方服务器（除目标 LLM API 端点外）。
- **网络请求**: 仅向用户配置的 LLM API Base URL 发送请求（OpenAI 兼容格式）。
- **敏感文件排除**: `.env` 等敏感文件受工具保护，不会被读取。
- **插件权限**: 需要桌面端（`isDesktopOnly: true`），因为依赖 Node.js 模块（`path`、`fs` 等）进行文件解析。
