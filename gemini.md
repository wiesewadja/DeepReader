# Gemini.md

## Project Positioning
**DeepPDF**: An Obsidian plugin providing intelligent PDF indexing via a FastAPI backend.
- **Frontend**: TypeScript (Obsidian Plugin API)
- **Backend**: Python 3.10+ (FastAPI), using `uv` for package management
- **Communication**: REST API @ `http://localhost:6088`
- **Documentation**: `/docs` endpoint

---

## Commands

### Backend (`/backend`)
- **Start**: `uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio` (Critical: MUST use `asyncio` loop, not `uvloop`)
- **Lint/Format**: `uv run ruff check .` & `uv run black .` (Line length: 100)
- **Test**: `uv run pytest tests/ -v`
- **Type Check**: `uv run mypy src/`

### Frontend (`/frontend`)
- **Dev**: `npm run dev` (Watch mode) -> Reload in Obsidian (Cmd+R)
- **Build**: `npm run build` (Includes type checking)
- **Test**: `npm run test:run` (Vitest)

---

## Architecture & File Mapping

### Backend Structure (`backend/deeppdf-api/src/deeppdf`)
- `api/`: Routes and Pydantic models ONLY. No business logic.
- `services/`: Business logic.
    - `indexer.py`: PDF parsing (CPU-bound -> use `ThreadPoolExecutor`)
    - `querier.py`: Search logic
- `storage/`: ChromaDB and embedding model logic
- **Config**: `config.py` (Env vars). No hardcoded secrets.

### Frontend Structure (`frontend/src`)
- `main.ts`: Entry point
- `api/`: `http-client.ts` (fetch API wrapper)
- `views/`: Obsidian UI components

---

## Key Development Rules

1. **Async Strategy**:
   - I/O-bound: `await asyncio.to_thread(...)`
   - CPU-bound (PDF/Index): `await loop.run_in_executor(...)`
   - **Critical**: `nest_asyncio.apply()` is required for PageIndex sync code compatibility

2. **Ports**: Default 6088. If changed, update both backend CLI and Obsidian plugin settings.

3. **LLM**: DeepSeek/OpenAI usage via `config.py`. Keys in `.env`.

4. **Error Handling**: Strict typing. NO returning raw dicts; use Pydantic schemas.

---

## Common Pitfalls (Do Not Ignore)

- **Startup Error**: `ValueError: Can't patch loop of type uvloop`. **Fix**: Ensure `--loop asyncio` flag is present.

- **Pydantic**: `Extra inputs not permitted`. **Fix**: Check `.env` matches `Settings` class, or set `extra="ignore"`.

- **Obsidian**: If type check fails, ensure `obsidian` typings are present, or use `// @ts-ignore` with justification.
