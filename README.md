<h1 align="center">DeepReader</h1>

<p align="center">
  <strong>奚童</strong> — AI-Powered Deep Reading Companion for Obsidian<br>
  基于《如何阅读一本书》四层认知方法论的智能伴读插件
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-2026.06.13-blue" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/Obsidian-1.0+-purple" alt="obsidian">
  <img src="https://img.shields.io/badge/status-active%20development-orange" alt="status">
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#development">Development</a> ·
  <a href="docs/">Full Docs</a>
</p>

---

DeepReader (奚童) transforms how you read in Obsidian. Instead of passively consuming text, you engage in a structured dialogue with an AI that understands the book, remembers your preferences, and guides you through four levels of reading depth — from quick inspection to cross-book thematic analysis.

It runs **100% locally**: PDF/EPUB indexing, hybrid search, and long-term memory all live in your vault. Your reading data never leaves your machine.

---

## Features

### Four-Layer Cognitive Engine

Based on *How to Read a Book* by Mortimer Adler, the AI automatically routes your question to the appropriate reading depth:

| Depth | Mode | What It Does |
|:-----:|------|-------------|
| 0 | Casual Chat | General conversation, no book context needed |
| 1 | Inspectional Reading | Quick overview using table of contents — "What is this book about?" |
| 2 | Analytical Reading | Deep dive with ReAct tool loop — search, read sections, take notes |
| 3 | Syntopical Reading | Cross-book comparison — "How do these three authors differ on topic X?" |

### Excalidraw Visualization

Ask "draw a mind map" and get an interactive Excalidraw diagram embedded in your note — mind maps, flowcharts, concept maps, knowledge graphs. 11 trigger keywords, all three reading depths. Requires the [Excalidraw plugin](https://github.com/zsviczian/obsidian-excalidraw-plugin).

### Local-First Indexing

- **PDF / EPUB / Markdown** parsing with automatic structure extraction
- **Hybrid Search** — BM25 keyword + semantic vector retrieval, no cloud dependency
- **Obsidian Export** — indexed results as Markdown notes in your vault

### Proactive Reading Guidance

You highlight, turn pages, read chapters — the AI notices. When enough "thinking traces" accumulate, it proactively asks a Socratic question to push you from passive reading to active thinking.

### Memory System

User profile + long-term memory that grows over conversations. A month in, the AI knows your interests, reading patterns, and values — and weaves that into every response.

### Reading Mode

Paginated PDF/EPUB reading with chapter navigation, position persistence (picks up where you left off), and inline AI chat alongside the text.

### Integrations (Optional)

| Integration | What It Does | Default |
|------------|--------------|:-------:|
| WeRead (微信读书) | Sync highlights, notes, and reading progress | Off |
| Z-Library | Search and download ebooks | Off |

### Supported LLM Providers

OpenAI, DeepSeek, Kimi (Moonshot), SiliconFlow, MiniMax, Ollama, LM Studio — any OpenAI-compatible endpoint.

---

## Quick Start

### Installation

**Manual Install**

1. Download the latest release from [GitHub Releases](https://github.com/wiesewadja/DeepReader/releases)
2. Extract `main.js`, `styles.css`, `manifest.json` into your vault:
   ```
   .obsidian/plugins/deepreader/
   ```
3. Enable the plugin in Obsidian: Settings > Community Plugins

**BRAT Install**

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Add Beta repository: `wiesewadja/DeepReader`
3. Follow BRAT prompts to enable

### Configuration

1. Open DeepReader settings in Obsidian
2. Configure at least one LLM provider (API Key + endpoint)
3. (Optional) Enable WeRead / Z-Library integrations

### Usage

1. Open the sidebar (DeepReader ribbon icon)
2. Click **Library** to add PDF/EPUB files
3. Wait for indexing to complete
4. Chat with your books, search across your library, or start reading in paginated mode

---

## Architecture

```
src/
├── main.ts                       # Plugin entry point
├── agent/                        # AI Agent — LangGraph cognitive engine
│   ├── graph/
│   │   ├── nodes/                #   8 state nodes
│   │   │                         #   Router → Inspectional → PreSearch → Analytical
│   │   │                         #   → Syntopical → Visualizer → Advisor → Formatter
│   │   ├── subgraphs/            #   PlanExecute ReAct loop
│   │   ├── prompts/              #   Per-node system prompts
│   │   ├── utils/                #   diagram-helper, safe-node, engine-helpers
│   │   └── edges.ts              #   Depth + intent routing
│   ├── tools/                    #   14 LangChain tools
│   │                             #   search_book, read_section, write_note,
│   │                             #   excalidraw, memory, profile, weread, etc.
│   ├── tracing/                  #   LangSmith observability
│   ├── router/                   #   Intent classifier (depth=0/1/2/3)
│   ├── context/                  #   System prompt builder (profile + memory)
│   ├── memory/                   #   Long-term memory store
│   └── session/                  #   Conversation persistence (JSONL)
├── pageindex/                    # Local-first indexing engine
│   ├── parsers/                  #   PDF / EPUB / Markdown parsers
│   ├── exporters/                #   Obsidian Markdown export
│   ├── vault/                    #   Vector + BM25 hybrid search
│   └── llm/                      #   LLM summarization
├── components/                   # Pure TypeScript + DOM UI
│   ├── reading-mode/             #   Paginated reading view
│   ├── chat/                     #   Agent conversation UI
│   ├── top-nav/                  #   Topbar with expression system
│   └── library/                  #   Book management UI
├── views/                        # Obsidian views (sidebar, library)
├── services/                     # Business services (TTS, ASR, reading-mode, proactive)
├── config/                       # Settings & multi-provider configuration
├── weread/                       # WeRead integration (optional)
├── zlibrary/                     # Z-Library integration (optional, off by default)
└── utils/                        # Logger, error handler, atomic write
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Plugin | TypeScript, Obsidian API |
| AI Agent | LangGraph (state machine), LangChain (tools), Zod (schemas) |
| Indexing | BM25 + vector hybrid search, pdf-lib, node-html-markdown |
| Testing | Vitest (unit), WebdriverIO (E2E), custom smoke/CLI harness |
| Build | esbuild, TypeScript strict mode |

---

## Development

### Prerequisites

- Node.js 18+
- npm
- Obsidian (for testing)

### Setup

```bash
git clone https://github.com/wiesewadja/DeepReader.git
cd DeepReader
npm install
npm run dev        # Watch mode — rebuilds on change
```

### Build & Test

```bash
npm run build      # Production build (esbuild minified)
npm run test:run   # Unit tests (Vitest)
npm run deploy     # Deploy to test-vault
npm run smoke      # Smoke tests (11 core scenarios)
```

### Project Scripts

| Command | Description |
|---------|------------|
| `npm run dev` | Watch mode with esbuild |
| `npm run build` | Production build (sync version, typecheck, esbuild minify) |
| `npm run test:run` | Run unit tests |
| `npm run lint` | ESLint check |
| `npm run deploy` | Deploy to test-vault with config injection |
| `npm run smoke` | Smoke tests (core 11 scenarios) |
| `npm run smoke:full` | Full smoke tests (25 scenarios) |

---

## Documentation

Full documentation lives in [`docs/`](docs/):

| Directory | Contents |
|-----------|---------|
| `docs/architecture/` | System architecture, agent state machine (L0-L8), UI architecture |
| `docs/features/` | Feature specs (F-01 through F-36) with acceptance criteria |
| `docs/decisions/` | Architecture Decision Records (ADR-001 through ADR-009) |
| `docs/test-strategies/` | Per-feature test strategies |
| `docs/integrations/` | WeRead, Z-Library, TTS/ASR, proactive engine |
| `docs/CHANGELOG.md` | Version history |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE) — Copyright (c) 2026 DeepReader Team

---

## Disclaimer

- **Z-Library** integration is disabled by default. Before enabling it, you must read and accept the legal disclaimer. You are solely responsible for ensuring your use complies with applicable laws.
- **WeRead (微信读书)** integration works through an Agent Gateway API. Users must obtain their own access credentials and ensure compliance with WeRead's terms of service.
