# SPEC: 移除 PI Agent 及内部绘图/技能引擎

## 背景

PI Agent 和内部绘图引擎（ExcalidrawEngine、SenseNova 信息图）都将被 Hermes MCP Server 替代。
奚童不再自己实现任何图表/可视化能力，全部委托给 Hermes。

## 范围

### 删除文件（源码）

**PI Agent 模块**：
| 文件 | 说明 |
|------|------|
| `src/agent/pi/` 整个目录 | PI 进程管理、RPC、配置、上下文 |

**ExcalidrawEngine**：
| 文件 | 说明 |
|------|------|
| `src/agent/tools/excalidraw-engine/index.ts` | 引擎入口 |
| `src/agent/tools/excalidraw-engine/layout-graph.ts` | 图布局 |
| `src/agent/tools/excalidraw-engine/layout-mindmap.ts` | 思维导图布局 |
| `src/agent/tools/excalidraw-engine/renderer.ts` | ExcalidrawAutomate 渲染 |
| `src/agent/tools/excalidraw-engine/styles.ts` | 样式定义 |
| `src/agent/tools/excalidraw-engine/types.ts` | 引擎类型 |
| `src/agent/tools/excalidraw.ts` | excalidraw 工具包装 |
| `src/agent/tools/definitions/excalidraw.ts` | excalidraw 工具定义 |
| `src/services/excalidraw-service.ts` | Excalidraw 集成服务 |
| `src/utils/excalidraw.ts` | ExcalidrawAutomate 检测工具 |

**信息图**：
| 文件 | 说明 |
|------|------|
| `src/agent/tools/definitions/generate-infographic.ts` | 信息图工具定义 |
| `src/services/infographic-generator.ts` | SenseNova 信息图生成 |

**Canvas**（依赖 ExcalidrawAutomate）：
| 文件 | 说明 |
|------|------|
| `src/agent/tools/canvas.ts` | Canvas 工具（内部调 ExcalidrawAutomate） |

**Prompt**：
| 文件 | 说明 |
|------|------|
| `src/agent/graph/prompts/visualizer-prompt.ts` | 可视化 prompt（描述 excalidraw/info 工具用法） |

**类型**：
| 文件 | 改动 |
|------|------|
| `src/types/excalidraw.d.ts` | 删除（ExcalidrawAutomate 类型声明） |

### 删除文件（测试）

| 路径 | 说明 |
|------|------|
| `tests/unit/agent/pi/` 整个目录 | 4 个 PI 单元测试 |
| `tests/e2e/specs/pi-agent.e2e.ts` | |
| `tests/e2e/specs/pi-detection.e2e.ts` | |
| `tests/e2e/specs/pi-rpc.e2e.ts` | |
| `tests/e2e/specs/pi-visualizer.e2e.ts` | |
| `tests/e2e/specs/visualizer-pi.e2e.ts` | |

### 删除文件（文档）

| 路径 | 说明 |
|------|------|
| `docs/features/pi-system.md` | PI 系统文档 |

### 修改文件

#### `src/agent/graph/nodes/visualizer.ts`
- 删除全部 PI 导入和调用路径
- 删除 ExcalidrawEngine、createVizTools、buildVisualizerPrompt 导入
- 删除本地引擎路径（ExcalidrawAutomate / SenseNova）
- **整个函数体替换为占位实现**：返回提示"图表生成功能已迁移到 Hermes，请等待 MCP 集成完成"
- 或者**直接删除 visualizer node**（如果 graph 能跳过它）

#### `src/agent/tools/index.ts`
- 移除 `createExcalidrawToolDefinition`、`createCanvasTool` 导入/导出
- 移除 `createGenerateInfographicTool` 导入/导出
- 移除 `createVizTools` 函数
- 从 `createAllTools` 中移除 excalidraw、canvas、generate_infographic 注册

#### `src/agent/graph/edges.ts`
- `_needsVisualization` 中的 `excalidraw` / `generate_infographic` 检查改为跳过
- 或者直接在路由中跳过 visualizer node

#### `src/agent/graph/nodes/analytical.ts`
- 移除 `s2ToolNames.push('generate_infographic')` 行

#### `src/agent/index.ts`
- 移除 `PiProcessManager` / `PiConfig` 导入
- 移除 `piManager` 字段和构造
- 移除 `buildGraphConfig` 中的 PI 配置块
- 移除 destroy 中的 `piManager.stop()`

#### `src/config/settings.ts`
- 移除 `piEnabled: boolean`
- 移除 `customPiPath: string`
- 移除对应默认值
- **保留** `pi?: { ... }` 块用于未来 Hermes 配置

#### `src/settings/sections/advanced-section.ts`
- 移除 PI 开关、路径配置、检测按钮
- 移除 `detectPiCli` 等导入

#### `src/main.ts`
- 移除 `getExcalidrawAutomate` 导入
- 移除 3 处 ExcalidrawAutomate 调用（行 352、424、875-886）

#### `docs/features/README.md`
- 移除 PI 系统条目

### 不变

| 文件/模块 | 原因 |
|-----------|------|
| `src/agent/tools/local/` | 本地搜索/索引工具 |
| `src/agent/tools/search-read-books.ts` | 阅读搜索 |
| `src/agent/tools/write-note.ts` | 笔记写入 |
| `src/agent/tools/memory.ts` | 记忆管理 |
| `src/agent/tools/profile.ts` | 用户画像 |
| `src/agent/tools/search-book.ts` | 书籍搜索 |
| `src/agent/tools/search-journal.ts` | 日记搜索 |
| `src/agent/tools/types.ts` | 通用工具类型 |

## visualizer node 处理

visualizer node 当前是 graph 路由中的一个可选节点。移除内部绘图能力后有两个选择：

**方案 A：保留占位** — visualizer node 存在但直接返回 "功能迁移中"
- 优点：graph 结构不变，后续 Hermes 集成只需改这一个函数
- 缺点：用户看到提示但不生效

**方案 B：暂时跳过** — 在 edges.ts 中让路由跳过 visualizer
- 优点：用户无感
- 缺点：后续集成时需要恢复路由

**推荐方案 A**。后续 Hermes MCP client SPEC 直接替换 visualizer 的实现即可。

## 验证

1. `npx tsc -noEmit -skipLibCheck` 零错误
2. `npm run test:run` — 无回归（PI 相关测试已删除）
3. `npm run build` — bundle 减小（移除 excalidraw-engine + canvas + infographic-generator）
4. 插件加载正常，Agent 对话功能正常
5. 用户问"画图"时收到"功能迁移中"提示

## 不在范围内

- Hermes MCP client 实现（后续 SPEC）
- `pi?: { ... }` 设置块的用途变更
- 新的图表生成方案设计
