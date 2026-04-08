# AGENTS.md - DeepReader 开发指南

本文档为 AI 代理（如 Claude、Cursor、Copilot）提供 DeepReader 项目的开发规范和最佳实践。

---

## 项目概览

**DeepReader** 是一个为 Obsidian 提供 PDF/EPUB 智能索引的插件，采用前后端解耦架构：

- **前端**: TypeScript (Obsidian Plugin API) - 完全独立运行
- **后端**: Python 3.10+ (FastAPI) - 可选的增强服务
- **通信**: REST API @ `http://localhost:6088`

**关键设计原则**：
- 后端是可选的，前端必须能独立运行
- 严格类型化，禁止原始 dict/any
- 配置通过环境变量，禁止硬编码密钥

---

## 构建/测试命令

### 前端 (`/frontend`)

```bash
# 开发模式（监听变化，自动重新构建）
npm run dev

# 生产构建（包含类型检查）
npm run build

# 运行所有测试
npm run test:run

# 运行单个测试文件
npx vitest run path/to/test.test.ts

# 测试 UI 界面
npm run test:ui

# 部署到测试 vault
npm run deploy
```

**测试文件位置**: `frontend/src/**/__tests__/**/*.test.ts`

**测试框架**: Vitest
```typescript
// 测试示例
import { describe, it, expect, vi } from 'vitest';

describe('feature name', () => {
  it('should do something', async () => {
    const result = await functionUnderTest();
    expect(result).toBe(expected);
  });
});
```

### 后端 (`/backend`)

```bash
# 启动开发服务器（必须使用 asyncio loop）
uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio

# 运行所有测试
uv run pytest tests/ -v

# 运行单个测试文件
uv run pytest tests/test_file.py -v

# 运行单个测试函数
uv run pytest tests/test_file.py::test_function_name -v

# 代码检查
uv run ruff check .

# 代码格式化（行长度 100）
uv run black .

# 类型检查
uv run mypy src/
```

**测试文件位置**: `backend/**/test_*.py` 或 `backend/**/*_test.py`

---

## 代码风格指南

### 导入顺序

**TypeScript**:
```typescript
// 1. 外部依赖（Node.js/第三方库）
import { Plugin, WorkspaceLeaf, Notice } from "obsidian";
import * as path from "path";
import * as fs from "fs/promises";

// 2. 项目内部模块（使用 .js 扩展名）
import { SidebarView } from "./views/sidebar-view.js";
import { DeepPDFClient } from "./api/http-client.js";
import type { Settings } from "./types/index.js";
```

**关键规则**：
- ✅ 内部导入必须使用 `.js` 扩展名（ES Module 要求）
- ✅ 使用 `import type` 导入仅用于类型的模块
- ✅ 使用 `* as` 导入整个模块

**Python**:
```python
# 1. 标准库
import asyncio
import json
from pathlib import Path
from typing import Dict, Any, Optional, List

# 2. 第三方库
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# 3. 项目内部模块
from deeppdf.config import settings
from deeppdf.services.indexer import extract_nodes
```

### 命名约定

| 类型 | TypeScript | Python |
|------|-----------|---------|
| 文件名 | `kebab-case.ts` | `snake_case.py` |
| 类名 | `PascalCase` | `PascalCase` |
| 函数/方法 | `camelCase` | `snake_case` |
| 变量 | `camelCase` | `snake_case` |
| 常量 | `UPPER_SNAKE_CASE` | `UPPER_SNAKE_CASE` |
| 接口/类型 | `PascalCase` | N/A (Pydantic models) |
| 私有成员 | `#privateField` | `_private_field` |

### 类型定义

**TypeScript**:
```typescript
// ✅ 正确：明确的接口定义
export interface SearchResult {
  id: string;
  title: string;
  score: number;
}

// ✅ 正确：使用类型别名
export type IndexStatus = "pending" | "processing" | "completed" | "failed";

// ❌ 错误：使用 any
function process(data: any): any { ... }

// ✅ 正确：使用泛型
function process<T>(data: T): Result<T> { ... }
```

**Python**:
```python
# ✅ 正确：使用 Pydantic 模型
from pydantic import BaseModel

class SearchResult(BaseModel):
    id: str
    title: str
    score: float

# ✅ 正确：使用类型提示
def process(data: Dict[str, Any]) -> Result:
    ...

# ❌ 错误：返回原始 dict
def get_data() -> dict:
    ...

# ✅ 正确：返回 Pydantic 模型
def get_data() -> DataModel:
    ...
```

### 异步策略

**Python 后端**:
```python
# I/O 密集型操作
result = await asyncio.to_thread(blocking_io_function)

# CPU 密集型操作（PDF 解析等）
loop = asyncio.get_event_loop()
result = await loop.run_in_executor(cpu_executor, cpu_intensive_function)

# 关键：必须设置 nest_asyncio
import nest_asyncio
nest_asyncio.apply()  # 在 PageIndex 调用前
```

**TypeScript 前端**:
```typescript
// 所有异步操作使用 async/await
async function processData(): Promise<Result> {
  const data = await fetchData();
  return transform(data);
}

// 并行执行多个异步操作
const [result1, result2] = await Promise.all([
  fetchFromSource1(),
  fetchFromSource2(),
]);
```

### 错误处理

**TypeScript**:
```typescript
// ✅ 正确：具体的错误类型
try {
  await riskyOperation();
} catch (error) {
  if (error instanceof NetworkError) {
    console.error('Network failed:', error.message);
  } else if (error instanceof ValidationError) {
    console.error('Invalid input:', error.details);
  } else {
    throw error; // 重新抛出未知错误
  }
}

// ✅ 正确：返回明确的错误对象
interface Result<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}
```

**Python**:
```python
# ✅ 正确：使用自定义异常
class IndexingError(Exception):
    def __init__(self, message: str, code: str):
        self.message = message
        self.code = code
        super().__init__(message)

# ✅ 正确：在 FastAPI 中返回 HTTP 错误
from fastapi import HTTPException

if not file_exists:
    raise HTTPException(
        status_code=404,
        detail={"code": "FILE_NOT_FOUND", "message": "File not found"}
    )
```

### 日志规范

**TypeScript**:
```typescript
// 使用 service 模块日志器
import { serviceLog as log } from './utils/logger.js';

log('[Component] Action performed');
log.error('[Component] Error occurred:', error);
```

**Python**:
```python
import logging

logger = logging.getLogger(__name__)

logger.info("Operation started")
logger.error(f"Operation failed: {error}")
```

---

## 项目特定规则

### 前端架构

```
frontend/src/
├── main.ts              # 插件入口
├── api/                 # HTTP 客户端封装
├── views/               # Obsidian UI 组件
├── agent/               # Frontend Agent (独立使用 LLM)
├── components/          # 可复用 UI 组件
├── config/              # 设置和配置
├── services/            # 业务服务层
└── types/               # TypeScript 类型定义
```

**关键模块**：
- `agent/`: 独立的 LLM Agent，后端未连接时仍可工作
- `components/reading-mode/`: 阅读模式核心组件
- `config/providers.ts`: 多 LLM 提供商配置

### 后端架构

```
backend/deeppdf-api/src/deeppdf/
├── api/                 # 仅路由和 Pydantic 模型，禁止业务逻辑
├── services/            # 业务逻辑层
│   ├── indexer.py       # PDF 解析（CPU 密集型）
│   └── querier.py       # 搜索逻辑
├── storage/             # ChromaDB 和嵌入模型
└── config.py            # 配置管理（环境变量）
```

**关键规则**：
- `api/` 层禁止包含业务逻辑
- 所有配置通过 `config.py` 加载，禁止硬编码
- CPU 密集型操作使用 `ThreadPoolExecutor`

### 常见陷阱

1. **后端启动错误**：
   ```
   ValueError: Can't patch loop of type uvloop
   ```
   **修复**: 启动命令必须包含 `--loop asyncio` 标志

2. **Pydantic 验证错误**：
   ```
   Extra inputs not permitted
   ```
   **修复**: 检查 `.env` 与 `Settings` 类匹配，或设置 `extra="ignore"`

3. **前端类型检查失败**：
   - 确保 `obsidian` 类型包存在
   - 或使用 `// @ts-ignore` 并注明原因

4. **Obsidian 插件调试**：
   - 使用 `Obsidian --help` 查看开发选项
   - 测试 vault 路径: `/Users/lizhao/workspace/deepreadertest`

---

## Git 提交规范

**提交前检查清单**：
- [ ] 运行 `npm run build` / `uv run ruff check .`
- [ ] 运行测试确保通过
- [ ] 检查敏感信息（API Key 等）未泄露
- [ ] 更新相关文档

**提交格式**：
```
<type>(<scope>): <subject>

<body>

<footer>
```

**类型**：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具相关

**示例**：
```
feat(frontend): add PageIndex core integration

- Add node.ts export for Node.js compatibility
- Remove openai SDK dependency, use native fetch
- Implement two-tier BM25 index for paragraph search

Closes #123
```

---

## 资源链接

- **后端 API 文档**: http://localhost:6088/docs (启动后端后访问)
- **测试 Vault**: `/Users/lizhao/workspace/deepreadertest`
- **日志位置**: `backend/logs/deeppdf.log`

---

## 注意事项

- ⚠️ **不要自行提交代码**，除非明确指定
- ⚠️ **后端是可选的**，前端必须能独立运行
- ⚠️ **端口默认 6088**，如修改需同步更新前后端配置
- ⚠️ **密钥在 `.env` 中**，禁止硬编码
- ⚠️ **前后端解耦**，Agent 独立使用 LLM API

---

**最后更新**: 2026-04-08
**维护者**: DeepReader Team