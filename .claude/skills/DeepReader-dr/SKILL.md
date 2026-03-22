---
name: DeepReader-dr
description: Use when working with DeepReader codebase — provides comprehensive module knowledge, design logic, and modification guides (generated from main branch d2c7bde)
---

# DeepReader 技能索引

## 项目概览

DeepReader 是一个基于 Obsidian 的 AI 阅读助手插件，实现 Mortimer Adler《如何阅读一本书》的四层次阅读方法论。通过认知状态机架构，为用户提供智能文档索引、语义检索、分析阅读和主题阅读能力。

### 仓库信息

- **源路径**: `/Users/lizhao/workspace/DeepReader`
- **版本**: commit d2c7bde (main 分支)
- **生成时间**: 2026-03-21
- **技术栈**: TypeScript (Obsidian Plugin) + Python (FastAPI Backend)

### 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                    Obsidian Plugin (Frontend)                    │
├─────────────────────────────────────────────────────────────────┤
│  agent/        │  components/  │  services/   │  api/           │
│  认知状态机     │  UI 组件库     │  前端服务层   │  HTTP 客户端   │
│  工具系统       │  聊天界面      │  阅读模式     │  服务器管理    │
│  记忆管理       │  模态框        │  摘录保存     │                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP API
┌─────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                               │
├─────────────────────────────────────────────────────────────────┤
│  api/                          │  services/                      │
│  REST API 路由                  │  核心业务逻辑                    │
│  请求/响应模型                  │  索引/查询/检索                   │
│  任务管理                       │  主题报告生成                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 模块清单

| 模块名称 | 描述 | 技能文件 |
|----------|------|----------|
| **agent** | 核心代理系统，包含认知状态机、工具系统、LLM 客户端、记忆管理 | `DeepReader-dr-agent/SKILL.md` |
| **components** | UI 组件库，包含聊天界面、模态框、导航、阅读模式组件 | `DeepReader-dr-components/SKILL.md` |
| **services** | 前端服务层，包含上下文管理、摘录保存、Markdown 导出、阅读模式 | `DeepReader-dr-services/SKILL.md` |
| **api** | HTTP 客户端和服务器管理，与后端 API 通信 | `DeepReader-dr-api/SKILL.md` |
| **backend-services** | 后端核心业务逻辑，包含索引、查询、智能检索、主题报告 | `DeepReader-dr-backend-services/SKILL.md` |
| **backend-api** | FastAPI REST API 层，暴露所有后端功能 | `DeepReader-dr-backend-api/SKILL.md` |

---

## 模块间依赖关系

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│                                                                  │
│  main.ts (插件入口)                                              │
│      │                                                           │
│      ├── agent/ ────────┬──> tools/ ──────> api/                │
│      │   (认知引擎)      │    (工具调用)      (HTTP 请求)         │
│      │                   │                                      │
│      │                   └──> services/                          │
│      │                        (文件操作)                          │
│      │                                                           │
│      └── components/ ──────> services/                           │
│           (UI 渲染)            (业务逻辑)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
│                                                                  │
│  api/ (FastAPI 路由)                                             │
│      │                                                           │
│      └──> services/ ──────> storage/                             │
│           (业务逻辑)          (数据持久化)                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 关键依赖

- **前端 → 后端**: `api/` 模块通过 HTTP 调用后端 API
- **agent → services**: 工具调用文件操作服务
- **components → services**: UI 触发业务逻辑
- **backend-api → backend-services**: 路由调用业务逻辑

---

## 跨模块场景指南

### 场景 1: 用户上传并索引一本 PDF

**涉及的模块**: api → backend-api → backend-services

**流程**:
1. **api** (`http-client.ts`): `fileAPI.upload()` 上传文件到 `/api/files`
2. **api** (`http-client.ts`): `indexAPI.createWithFile()` 创建索引任务
3. **backend-api** (`routes.py`): `POST /api/index` 接收请求，创建后台任务
4. **backend-services** (`indexer.py`): `index_pdf()` 执行索引
   - 解析 PDF 结构
   - 生成向量嵌入
   - 构建 BM25 索引
   - 提取封面
5. **api** (`http-client.ts`): `indexAPI.poll()` 轮询进度直到完成

**关键文件**:
- `frontend/src/api/http-client.ts:536-574` (uploadFile)
- `backend/deeppdf-api/src/deeppdf/api/routes.py:309-410` (create_index)
- `backend/deeppdf-api/src/deeppdf/services/indexer.py:595-800` (index_pdf)

### 场景 2: 用户与 AI 对话

**涉及的模块**: agent → api → backend-api → backend-services

**流程**:
1. **agent** (`engine.ts`): `runCognitiveEngine()` 启动认知状态机
2. **agent** (`router.ts`): S0 Router 分类查询深度
3. **agent** (`inspectional.ts`): S1 获取目录，锁定章节范围
4. **agent** (`analytical.ts`): S2 深度分析，调用工具
5. **agent** (`tools/search-doc.ts`): 执行 `search_doc` 工具
6. **api** (`http-client.ts`): `queryAPI.search()` 调用 `/api/query`
7. **backend-api** (`routes.py`): `POST /api/query` 处理查询
8. **backend-services** (`querier.py`): `query_pdf()` 执行混合检索
9. **agent** (`formatter.ts`): S4 格式化输出为 Obsidian 笔记

**关键文件**:
- `frontend/src/agent/cognitive-engine/engine.ts` (状态机编排)
- `frontend/src/agent/tools/search-doc.ts` (搜索工具)
- `backend/deeppdf-api/src/deeppdf/services/querier.py` (查询逻辑)

### 场景 3: 导出索引导出为 Markdown

**涉及的模块**: services → api → backend-api → backend-services

**流程**:
1. **services** (`markdown-exporter.ts`): `exportIndexToMarkdown()` 启动导出
2. **api** (`http-client.ts`): `baseAPI.exportIndex()` 获取节点数据
3. **backend-api** (`routes.py`): `GET /api/export/{indexId}` 返回数据
4. **services** (`markdown-exporter.ts`): 处理节点数据
   - 创建目录结构
   - 生成 Markdown 文件
   - 处理 block_id 映射
   - 下载 EPUB 图片

**关键文件**:
- `frontend/src/services/markdown-exporter.ts` (导出逻辑)
- `backend/deeppdf-api/src/deeppdf/api/routes.py:730-780` (export 端点)

### 场景 4: 阅读模式章节导航

**涉及的模块**: components → services

**流程**:
1. **services** (`reading-mode-service.ts`): 检测章节文件
2. **services** (`reading-mode-service.ts`): `activate()` 激活阅读模式
3. **components** (`chapter-nav.ts`): 渲染导航 UI
4. **components** (`selection-toolbar.ts`): 文本选择工具栏
5. **services** (`excerpt-service.ts`): 保存摘录

**关键文件**:
- `frontend/src/services/reading-mode-service.ts` (阅读模式管理)
- `frontend/src/components/reading-mode/chapter-nav.ts` (章节导航)
- `frontend/src/components/reading-mode/selection-toolbar.ts` (选择工具)

### 场景 5: 添加新的 AI 工具

**涉及的模块**: agent → (可选) api

**修改步骤**:
1. **agent/tools/**: 创建新工具文件 (如 `my-tool.ts`)
2. **agent/tools/index.ts**: 注册工具到 registry
3. **agent/cognitive-engine/states/**: 在需要的状态中添加工具到 `tools` 数组
4. (可选) **api/**: 如果需要后端支持，添加新的 API 方法

**关键文件**:
- `frontend/src/agent/tools/index.ts` (工具注册)
- `frontend/src/agent/cognitive-engine/states/analytical.ts` (状态工具列表)

### 场景 6: 更改 LLM Provider

**涉及的模块**: agent (前端) + backend-services (后端)

**前端修改**:
- `frontend/src/agent/llm-client.ts`: 修改 API 格式和 endpoint

**后端修改**:
- `backend/deeppdf-api/src/deeppdf/services/indexer.py:567+`: 添加新 Provider 配置

---

## 快速参考

### 前端入口文件

| 文件 | 用途 |
|------|------|
| `frontend/src/main.ts` | Obsidian 插件入口 |
| `frontend/src/agent/index.ts` | FrontendAgent 主类 |
| `frontend/src/views/sidebar-view.ts` | 侧边栏视图 |

### 后端入口文件

| 文件 | 用途 |
|------|------|
| `backend/deeppdf-api/src/deeppdf/main.py` | FastAPI 应用入口 |
| `backend/deeppdf-api/src/deeppdf/api/routes.py` | 主 API 路由 |

### 配置文件

| 文件 | 用途 |
|------|------|
| `frontend/src/config/settings.ts` | 前端设置 |
| `backend/deeppdf-api/src/deeppdf/config.py` | 后端配置 |

### 测试目录

| 目录 | 用途 |
|------|------|
| `frontend/tests/` | 前端单元测试 (Vitest) |
| `backend/deeppdf-api/src/deeppdf/api/__tests__/` | 后端 API 测试 |

---

## 使用建议

1. **阅读单个模块**: 直接引用对应的技能文件，如 `DeepReader-dr-agent/SKILL.md`
2. **跨模块开发**: 先阅读本索引了解依赖关系，再深入具体模块
3. **添加新功能**: 参考"跨模块场景指南"了解数据流和修改点
4. **调试问题**: 根据错误位置定位模块，查阅对应技能文件的"状态流"章节
