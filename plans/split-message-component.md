# Implementation Plan: 拆分 AIMessage 组件

## Overview
将 message.ts（1088 行）中的 AIMessage 类拆为 4 个委托控制器 + 瘦核心，零行为变更。

## Dependency Graph
```
message.ts (AIMessage 核心)
  ├── tts-reading-controller.ts     ← 无依赖，叶子
  ├── selection-manager.ts          ← 无依赖，叶子
  ├── streaming-renderer.ts         ← 依赖 MessageData 类型（已有）
  ├── message-actions.ts            ← 依赖 tts-reading-controller
  ├── fullscreen-controller.ts      ← 已有，不动
  └── types.ts / utils.ts / ...     ← 已有，不动
```

## Task List

### Phase 1: 叶子模块（并行）

#### Task 1: 提取 tts-reading-controller.ts
- 从 AIMessage 提取 `ttsBtn`/`ttsWaveEl`/`scrollListener`/`userScrolled` 字段
- 提取 `setTTSState()`、`highlightTTSProgress()`、`findScrollContainer()`、`detachScrollListener()`
- host 接口只需 `get el(): HTMLElement | null`
- AIMessage 中字段改为 `private ttsReadingCtrl: TTSReadingController`
- `setTTSState()` / `highlightTTSProgress()` 改为代理调用
- **Acceptance**: 编译通过，朗读按钮状态切换和段落高亮行为不变
- **Verify**: `npx tsc -noEmit -skipLibCheck`（排除 chat-input 预存错误）
- **Files**: `tts-reading-controller.ts`(新), `message.ts`(改)
- **Scope**: S

#### Task 2: 提取 selection-manager.ts
- 从 AIMessage 提取 `selectionMenu` 字段
- 提取 `setupSelectionListener()`、`handleExcerpt()`
- host 接口: `get el()` / `get app()` / `get data()` / `onExcerpt` / `onQuote`
- AIMessage 中字段改为 `private selectionMgr: SelectionManager`
- **Acceptance**: 编译通过，文字选中和摘录菜单行为不变
- **Verify**: `npx tsc -noEmit -skipLibCheck`
- **Files**: `selection-manager.ts`(新), `message.ts`(改)
- **Scope**: S

### Checkpoint 1
- [ ] 编译零新错误
- [ ] `npm run test:run` 全部通过

### Phase 2: 依赖模块（可并行）

#### Task 3: 提取 streaming-renderer.ts
- 从 AIMessage 提取 `lastRenderedContent`/`lastRenderTime`/`lastRenderedLength`/`streamingAnimationFrame` 字段
- 提取 `streamingUpdateContent()`、`fullUpdateContent()`、`updateToolCalls()`
- host 接口: `get el()` / `get app()` / `get data()` / `get observers()` / `escapeHtml()`
- AIMessage 中字段改为 `private streamingRenderer: StreamingRenderer`
- `updateContent()` / `finalizeStreamingEnd()` 代理调用
- **Acceptance**: 编译通过，流式渲染和 Markdown 更新行为不变
- **Verify**: `npx tsc -noEmit -skipLibCheck`
- **Files**: `streaming-renderer.ts`(新), `message.ts`(改)
- **Scope**: M（涉及流式逻辑较复杂）

#### Task 4: 提取 message-actions.ts
- 从 AIMessage 提取 `renderActions()`、`scrollToMessageTop()`
- host 接口: `get data()` / 各种回调 / `openFullscreen()` / `ttsReadingCtrl`
- AIMessage 中调用改为 `this.actionsRenderer.render(bubble)`
- **Acceptance**: 编译通过，操作按钮渲染行为不变
- **Verify**: `npx tsc -noEmit -skipLibCheck`
- **Files**: `message-actions.ts`(新), `message.ts`(改)
- **Scope**: S

### Checkpoint 2
- [ ] 编译零新错误
- [ ] `npm run test:run` 全部通过
- [ ] `message.ts` ≤ 450 行
- [ ] 每个新文件 ≤ 200 行

### Phase 3: 集成验证

#### Task 5: 清理 + 最终验证
- 移除 message.ts 中残留的注释、空行
- 确认 re-export 无遗漏
- 最终行数统计
- **Acceptance**: 所有验证通过
- **Verify**: `npx tsc -noEmit -skipLibCheck` + `npm run test:run` + 行数统计
- **Files**: `message.ts`
- **Scope**: XS

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| host 接口设计不当导致循环依赖 | Med | 先定接口再写实现，接口只含 getter |
| streamingRenderer 的 `this` 指向变化 | Med | 通过 host 接口访问，不直接用闭包 |
| Message 基类的 `setTTSState`/`highlightTTSProgress` 抽象方法签名 | Low | 保持代理模式，签名不变 |

## Parallelization

- Task 1 和 Task 2 可并行（互不依赖）
- Task 3 和 Task 4 可并行（Task 4 依赖 Task 1 的 ttsReadingCtrl 类型，但 Task 1 先完成）
- Task 5 必须在 Task 1-4 之后
