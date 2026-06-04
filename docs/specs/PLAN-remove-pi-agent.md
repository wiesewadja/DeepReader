# Implementation Plan: 移除 PI Agent 及内部绘图/技能引擎

## Overview

移除 PI Agent、ExcalidrawEngine、SenseNova 信息图、Canvas 工具等全部内部绘图能力。
visualizer node 保留占位。29 个文件删除，7 个文件修改。

## Architecture Decisions

- **visualizer node 保留占位**（方案 A）：graph 结构不变，后续 Hermes 集成只改 visualizer 实现
- **`pi?: {...}` 设置块保留**：未来 Hermes 配置复用
- **按依赖关系从叶到根删除**：先删无依赖的工具/引擎文件，再删调用方

## Dependency Graph

```
settings.ts (piEnabled, customPiPath) ─┐
advanced-section.ts (PI UI)            │
main.ts (ExcalidrawAutomate 调用)      │
                                       ▼
agent/index.ts (PiProcessManager) ──► agent/graph/nodes/visualizer.ts
                                       ▲
agent/tools/index.ts (工具注册) ────────┤
  ├── excalidraw.ts                    │
  ├── definitions/excalidraw.ts        │
  ├── excalidraw-engine/*              │
  ├── canvas.ts                        │
  ├── definitions/generate-infographic.ts
  └── services/infographic-generator.ts

agent/graph/edges.ts (路由判断) ────► visualizer
agent/graph/nodes/analytical.ts (工具名推送)

agent/graph/prompts/visualizer-prompt.ts
utils/excalidraw.ts
types/excalidraw.d.ts
services/excalidraw-service.ts
```

## Task List

### Phase 1: 删除无依赖的叶文件

- [ ] **Task 1**: 删除 PI Agent 模块源码和测试
- [ ] **Task 2**: 删除 ExcalidrawEngine、信息图、Canvas 相关源码和测试
- [ ] **Task 3**: 删除类型声明、工具函数、Prompt、文档

### Checkpoint: Phase 1
- [ ] `npx tsc -noEmit -skipLibCheck` 预期有错误（调用方还引用被删模块）

### Phase 2: 修改调用方（消除编译错误）

- [ ] **Task 4**: 修改 `agent/tools/index.ts` — 移除工具注册和 `createVizTools`
- [ ] **Task 5**: 修改 `agent/index.ts` — 移除 PiProcessManager 全部引用
- [ ] **Task 6**: 修改 `visualizer.ts` — 替换为占位实现
- [ ] **Task 7**: 修改 `edges.ts` + `analytical.ts` — 移除可视化路由判断

### Checkpoint: Phase 2
- [ ] `npx tsc -noEmit -skipLibCheck` 零错误

### Phase 3: 修改配置和入口

- [ ] **Task 8**: 修改 `settings.ts` + `advanced-section.ts` — 移除 PI 配置
- [ ] **Task 9**: 修改 `main.ts` — 移除 ExcalidrawAutomate 调用

### Checkpoint: Phase 3 — 完整验证
- [ ] `npx tsc -noEmit -skipLibCheck` 零错误
- [ ] `npm run test:run` 通过
- [ ] `npm run build` 成功

---

## Task Details

### Task 1: 删除 PI Agent 模块源码和测试
**Description**: 删除 `src/agent/pi/` 目录和所有 PI 相关测试文件。

**Acceptance criteria:**
- [ ] `src/agent/pi/` 目录不存在
- [ ] `tests/unit/agent/pi/` 目录不存在
- [ ] `tests/e2e/specs/pi-agent.e2e.ts` 不存在
- [ ] `tests/e2e/specs/pi-detection.e2e.ts` 不存在
- [ ] `tests/e2e/specs/pi-rpc.e2e.ts` 不存在
- [ ] `tests/e2e/specs/pi-visualizer.e2e.ts` 不存在
- [ ] `tests/e2e/specs/visualizer-pi.e2e.ts` 不存在

**Verification:** `ls src/agent/pi/ 2>&1` 和 `ls tests/unit/agent/pi/ 2>&1` 返回不存在

**Dependencies:** None
**Files:** 11 个文件删除
**Scope:** S

---

### Task 2: 删除 ExcalidrawEngine、信息图、Canvas 相关源码和测试
**Description**: 删除所有内部绘图引擎、工具定义、服务文件。

**Acceptance criteria:**
- [ ] `src/agent/tools/excalidraw-engine/` 目录不存在
- [ ] `src/agent/tools/excalidraw.ts` 不存在
- [ ] `src/agent/tools/definitions/excalidraw.ts` 不存在
- [ ] `src/agent/tools/definitions/generate-infographic.ts` 不存在
- [ ] `src/agent/tools/canvas.ts` 不存在
- [ ] `src/services/excalidraw-service.ts` 不存在
- [ ] `src/services/infographic-generator.ts` 不存在

**Verification:** 文件不存在

**Dependencies:** None
**Scope:** S

---

### Task 3: 删除类型声明、工具函数、Prompt、文档
**Description**: 删除 ExcalidrawAutomate 类型声明、工具函数、可视化 prompt、PI 系统文档。

**Acceptance criteria:**
- [ ] `src/types/excalidraw.d.ts` 不存在
- [ ] `src/utils/excalidraw.ts` 不存在
- [ ] `src/agent/graph/prompts/visualizer-prompt.ts` 不存在
- [ ] `docs/features/pi-system.md` 不存在
- [ ] `docs/features/README.md` 中 PI 系统条目已移除

**Verification:** 文件不存在

**Dependencies:** None
**Scope:** S

---

### Task 4: 修改 `agent/tools/index.ts`
**Description**: 移除 excalidraw、canvas、generate_infographic 的导入、导出、注册。
移除 `createVizTools` 函数。

**Acceptance criteria:**
- [ ] 无 excalidraw/canvas/infographic 相关 import
- [ ] `createAllTools` 不注册 excalidraw/canvas/infographic
- [ ] `createVizTools` 函数已删除
- [ ] 无 excalidraw/canvas/infographic 相关 export

**Verification:** `npx tsc -noEmit -skipLibCheck`（此文件本身编译通过，调用方错误在后续 task 修）

**Dependencies:** Task 1, 2, 3
**Files:** `src/agent/tools/index.ts`
**Scope:** S

---

### Task 5: 修改 `agent/index.ts`
**Description**: 移除 PiProcessManager/PiConfig 导入、piManager 字段、buildGraphConfig 中 PI 配置块、destroy 中 stop 调用。

**Acceptance criteria:**
- [ ] 无 `PiProcessManager` / `PiConfig` / `pi-manager` / `pi/types` import
- [ ] 无 `piManager` 字段
- [ ] `buildGraphConfig` 的 configurable 中无 `piManager` / `piConfig`
- [ ] `destroy` 中无 `this.piManager.stop()`

**Verification:** 文件编译通过

**Dependencies:** Task 1
**Files:** `src/agent/index.ts`
**Scope:** S

---

### Task 6: 修改 `visualizer.ts` — 替换为占位实现
**Description**: 删除全部 PI 导入、本地引擎导入。函数体替换为返回占位提示。

**Acceptance criteria:**
- [ ] 无 PI/ExcalidrawEngine/VizTools 相关 import
- [ ] 函数体直接返回 `{ analysisResult: "图表生成功能正在升级中，即将支持 Hermes 后端。" }`
- [ ] 保留函数签名（接受相同参数）以便后续替换

**Verification:** 编译通过

**Dependencies:** Task 2, 3
**Files:** `src/agent/graph/nodes/visualizer.ts`
**Scope:** S

---

### Task 7: 修改 `edges.ts` + `analytical.ts`
**Description**: edges.ts 中 `_needsVisualization` 不再匹配 excalidraw/generate_infographic（改为 return false 或直接跳过）。
analytical.ts 移除 `generate_infographic` 工具名推送。

**Acceptance criteria:**
- [ ] `_needsVisualization` 返回 false 或跳过
- [ ] `analytical.ts` 不推送 `generate_infographic`

**Verification:** 编译通过

**Dependencies:** Task 6
**Files:** `src/agent/graph/edges.ts`, `src/agent/graph/nodes/analytical.ts`
**Scope:** S

---

### Task 8: 修改 `settings.ts` + `advanced-section.ts`
**Description**: settings.ts 移除 `piEnabled`/`customPiPath` 字段和默认值。
advanced-section.ts 移除 PI 开关、路径配置、检测按钮。

**Acceptance criteria:**
- [ ] `DeepReaderSettings` 接口中无 `piEnabled` / `customPiPath`
- [ ] `DEFAULT_SETTINGS` 中无 `piEnabled` / `customPiPath`
- [ ] advanced-section.ts 中无 PI 相关 UI 元素
- [ ] 无 `detectPiCli` / `buildSpawnEnv` / `pi-config` import

**Verification:** 编译通过

**Dependencies:** Task 1
**Files:** `src/config/settings.ts`, `src/settings/sections/advanced-section.ts`
**Scope:** S

---

### Task 9: 修改 `main.ts`
**Description**: 移除 `getExcalidrawAutomate` 导入和 3 处 ExcalidrawAutomate 调用。

**Acceptance criteria:**
- [ ] 无 `getExcalidrawAutomate` / `excalidraw` import
- [ ] 无 `window.ExcalidrawAutomate` 引用
- [ ] 相关代码块（excalidraw 画布操作）已移除或注释

**Verification:** 编译通过

**Dependencies:** Task 3
**Files:** `src/main.ts`
**Scope:** S

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| main.ts 中 ExcalidrawAutomate 调用有副作用 | 用户功能缺失 | Task 9 仔细检查每处调用的上下文，非绘图功能的保留 |
| visualizer 占位导致 Agent 卡住 | 用户体验 | 占位直接返回文本，不抛异常，graph 正常流转 |
| 遗漏某个 PI import 导致编译失败 | 构建失败 | Checkpoint 验证 tsc 零错误 |
| 测试文件引用已删模块 | 测试失败 | Phase 1 优先删测试文件 |

## Parallelization

- **Task 1, 2, 3 可并行**：都是纯文件删除，无依赖
- **Task 4, 5, 6, 7, 8, 9 必须串行**：都依赖 Phase 1 的文件删除，且 Task 6→7 有依赖
- **Task 8 和 Task 9 可并行**：分别改不同文件

## Estimated Bundle Impact

移除以下模块预计减小 bundle：
- `excalidraw-engine/`（布局+渲染逻辑）
- `canvas.ts`（Obsidian canvas 操作）
- `infographic-generator.ts`（SenseNova API 调用）
- `excalidraw-service.ts`（ExcalidrawAutomate 封装）
- PI 管理器代码
