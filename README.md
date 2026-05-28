# DeepReader

**DeepReader** — 深度 AI 阅读伴侣，为 Obsidian 打造的智能阅读插件。

An AI-powered deep reading companion for Obsidian.

---

## Features

### Local-first Indexing Engine
- **PDF / EPUB Parsing** — 自动提取文档结构、生成目录
- **Hybrid Search** — BM25 关键词 + 语义向量混合检索
- **Obsidian Export** — 索引结果导出为 Markdown 笔记

### AI Reading Agent
- **四层认知引擎** — 基于《如何阅读一本书》方法论：检视阅读 → 分析阅读 → 主题阅读
- **多模型支持** — OpenAI、DeepSeek、Kimi、SiliconFlow、MiniMax、本地模型（Ollama / LM Studio）
- **上下文感知** — 自动关联已索引书籍内容

### Reading Experience
- **阅读模式** — PDF/EPUB 分页阅读 + 交互式导航
- **阅读进度** — 自动追踪阅读位置和统计
- **AI 伴读** — 对话式深度阅读引导

### Optional Integrations
- **微信读书同步** — 标注、笔记、进度同步（需配置 API Key）
- **Z-Library 搜索** — 电子书搜索和下载（默认关闭，启用前需阅读免责声明）

---

## Quick Start

### Installation

**Manual Install**

1. Download latest release from [GitHub Releases](https://github.com/deepreader-team/deepreader/releases)
2. Extract `main.js`, `styles.css`, `manifest.json` to your vault: `.obsidian/plugins/deepreader/`
3. Enable plugin in Obsidian Settings → Community Plugins

**BRAT Install**

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add Beta repository: `deepreader-team/deepreader`

### Configuration

1. Open plugin settings
2. Configure at least one LLM provider (API Key)
3. Start reading!

### Usage

1. Open sidebar (DeepReader icon)
2. Click "Library" to add PDF/EPUB files
3. Wait for indexing to complete
4. Search or chat with your books

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/deepreader-team/deepreader.git
cd deepreader
npm install
npm run dev      # Watch mode
```

### Build & Test

```bash
npm run build      # Production build
npm run test:run   # Run tests
npm run deploy     # Deploy to test vault
```

### Project Structure

```
src/
├── main.ts                    # Plugin entry point
├── agent/                     # AI Agent engine
│   ├── graph/                 # LangGraph state machine
│   ├── pi/                    # PI Agent subprocess
│   ├── tools/                 # Agent tools (search, read, visualize)
│   └── router/                # Intent router
├── pageindex/                 # Indexing engine
│   ├── parsers/               # PDF / EPUB / Markdown parsers
│   ├── exporters/             # Obsidian Markdown export
│   ├── vault/                 # Vector storage
│   └── llm/                   # LLM summarization
├── components/                # UI components
├── views/                     # Obsidian views (sidebar, library)
├── services/                  # Business services (TTS, Excalidraw, etc.)
├── config/                    # Settings & providers
├── weread/                    # WeRead integration (optional)
├── zlibrary/                  # Z-Library integration (optional, disabled by default)
└── utils/                     # Utilities (logger, error handler)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE) — Copyright (c) 2026 DeepReader Team

---

## Disclaimer

- **Z-Library** 模块默认关闭。启用前需阅读并同意法律免责声明。用户需自行承担使用风险。
- **微信读书** 模块通过 Agent Gateway API 工作，用户需自行获取访问权限并确保符合服务条款。
