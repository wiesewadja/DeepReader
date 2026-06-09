# Spec: 拆分 AIMessage 组件

## Objective

将 `src/components/message/message.ts`（1088 行）中的 `AIMessage` 类拆分为多个委托控制器，使每个文件 ≤ 200 行，职责单一，可被 subagent 安全编辑。

## 背景

`AIMessage` 承担了过多职责：消息渲染、流式更新、TTS 朗读状态、文字选中/摘录、操作按钮、全屏展示。已有 `FullscreenController` 成功拆分的先例，本次沿用相同模式。

## 拆分模块

### 1. `tts-reading-controller.ts`（~130 行）

**职责**：TTS 朗读的 UI 状态管理（按钮图标切换、段落高亮、滚动跟随）。

**提取内容**：
- 字段：`ttsBtn`、`ttsWaveEl`、`scrollListener`、`userScrolled`
- 方法：`setTTSState()`、`highlightTTSProgress()`、`findScrollContainer()`、`detachScrollListener()`

**接口**：
```ts
interface TTSReadingHost {
  get el(): HTMLElement | null;
}
```

**调用点**：
- `render()` 中创建 `ttsWave` 后调用 `ctrl.setTtsWaveEl(el)`
- `renderActions()` 中创建 `ttsBtn` 后调用 `ctrl.setTtsBtn(btn)`
- `destroy()` 中调用 `ctrl.destroy()`
- 外部（message-list）直接调用 `msg.setTTSState()` / `msg.highlightTTSProgress()`，AIMessage 代理给 ctrl

### 2. `streaming-renderer.ts`（~180 行）

**职责**：流式消息的增量渲染和 Markdown 更新。

**提取内容**：
- 字段：`lastRenderedContent`、`lastRenderTime`、`lastRenderedLength`、`streamingAnimationFrame`
- 方法：`streamingUpdateContent()`、`fullUpdateContent()`、`updateToolCalls()`

**接口**：
```ts
interface StreamingRendererHost {
  get el(): HTMLElement | null;
  get app(): App | undefined;
  get data(): MessageData;
  get observers(): MutationObserver[];
  escapeHtml(text: string): string;
}
```

**调用点**：
- `updateContent()` 根据流式/非流式调用 `renderer.streamingRender()` 或 `renderer.fullRender()`
- `finalizeStreamingEnd()` 调用 `renderer.fullRender()` 做最终渲染

### 3. `selection-manager.ts`（~100 行）

**职责**：文字选中检测、选中菜单显示/隐藏、摘录保存。

**提取内容**：
- 字段：`selectionMenu`
- 方法：`setupSelectionListener()`、`handleExcerpt()`

**接口**：
```ts
interface SelectionHost {
  get el(): HTMLElement | null;
  get app(): App | undefined;
  get data(): MessageData;
  onExcerpt?(content: ExcerptContent, metadata: ExcerptMetadata): void;
  onQuote?(metadata: QuoteMetadata): void;
}
```

### 4. `message-actions.ts`（~100 行）

**职责**：渲染消息操作按钮行（TTS、全屏、跳转顶部、重新生成、复制、摘录、删除）。

**提取内容**：
- 方法：`renderActions()`、`scrollToMessageTop()`

**接口**：
```ts
interface MessageActionsHost {
  get data(): MessageData;
  onRegenerate?(): void;
  onCopy?(): void;
  onExcerpt?(): void;
  onDelete?(): void;
  onTTS?(messageId: string, content: string): void;
  openFullscreen(): void;
  ttsReadingCtrl: TTSReadingController;
}
```

## 拆分后 AIMessage 保留内容（~350 行）

- 字段声明 + 构造函数
- `render()` — 调用子模块挂载 DOM
- `update()` — 调度流式/全量更新
- `updateContent()` — 代理给 streamingRenderer
- `finalizeStreamingEnd()` — 结束流式
- `destroy()` — 调用子模块 destroy
- `setTTSState()` / `highlightTTSProgress()` — 代理给 ttsReadingCtrl
- `openFullscreen()` / `closeFullscreen()` — 委托给 fullscreenCtrl
- `requestRerender()` / `hideStreamingState()`
- `getPatternClass()`
- `createMessage()` 工厂函数

## 约束

1. **零行为变更**：拆分后所有功能与拆分前完全一致，仅文件组织变化
2. **对外接口不变**：`createMessage()`、`Message.setTTSState()`、`Message.highlightTTSProgress()` 签名不变
3. **委托模式**：与 `FullscreenController` 保持一致的模式——子模块通过 host 接口访问 AIMessage 状态
4. **不新增测试**：纯重构，现有测试应全部通过即可
5. **每个文件 ≤ 200 行**

## 验证

- `npx tsc -noEmit -skipLibCheck` 零新错误
- `npm run test:run` 全部通过
- `message.ts` ≤ 400 行
- 每个新文件 ≤ 200 行

## 实施顺序

按依赖链从叶子到根：

1. `tts-reading-controller.ts` — 无依赖，最独立
2. `selection-manager.ts` — 无依赖
3. `streaming-renderer.ts` — 依赖 MessageData 类型
4. `message-actions.ts` — 依赖 ttsReadingCtrl
5. 清理 `message.ts` — 集成所有子模块
6. 编译验证 + 测试
