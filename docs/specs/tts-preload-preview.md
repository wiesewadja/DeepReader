# Spec：TTS 预加载功能

> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> [Final Report](../compose/reports/tts-preload-preview.md)

## 目标

优化点击气泡朗读按钮时的首播速度。当 AI 回复流式结束后，自动预生成前 250 字的语音，让用户点击朗读按钮时能立即播放，而不是等待 TTS 合成。

**用户场景：**
- 用户在侧边栏与 AI 对话
- AI 回复完成后，用户想听语音朗读
- 当前：点击朗读按钮后，需要等待 TTS 合成前 250 字（约 3-5 秒）
- 优化后：点击朗读按钮时，前 250 字语音已预生成，立即播放

## 命令（Commands）

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 开发：`npm run dev`
- 部署：`npm run deploy` → test-vault
- 冒烟：`npm run smoke:core`
- 轻量 E2E：`npm run e2e-light`

## 受影响模块

### 新增/修改
- `src/components/message-list/message-list.ts` — 添加 `onStreamingEnd` 回调接口
- `src/components/message/message.ts` — 在流式结束时调用回调
- `src/views/sidebar/sidebar-view.ts` — 实现预加载逻辑

### 不修改
- `src/services/tts/tts-service.ts` — `preloadPreview()` 方法已实现，不修改
- `src/services/tts/tts-summarizer.ts` — 不修改

## 技术约束

1. 遵循现有回调模式（`onTTS`、`onRegenerate` 等）
2. 预加载必须异步执行，不阻塞 UI
3. 预加载失败时静默处理，不影响用户操作
4. 使用现有的 `preloadPreview()` 方法，不重复实现
5. 日志用 `utils/logger.ts`，不用 `console.log`

## 代码风格

```typescript
// 回调命名：on + 事件名
onStreamingEnd?: (messageId: string, content: string) => void;

// 方法命名：动词 + 名词
private async preloadTTSPreview(messageId: string, content: string): Promise<void> {
  // 异步执行，不 await
  this.preloadTTSPreview(messageId, content).catch(() => {});
}

// 错误处理：静默处理
try {
  await this.ttsService.preloadPreview(messageId, content, context);
} catch {
  // 预加载失败，静默处理
}
```

## 测试策略

- 测试层级：单元（Vitest）
- 测试位置：`tests/unit/components/message-list/` 和 `tests/unit/views/sidebar/`
- 覆盖范围：
  - `MessageList` 新增 `onStreamingEnd` 回调的传递
  - `AIMessage.onStreamingEnd()` 方法的调用时机
  - `sidebar-view.ts` 中预加载逻辑的触发
- 不依赖外部 API（mock TTS 服务）

## 边界

**Always（必须做）**
- 跑 `npm run test:run` 和 `npm run build` 再提交
- 遵循命名约定（camelCase 函数、PascalCase 类）
- 新增方法写 JSDoc
- 预加载必须异步执行，不阻塞 UI

**Ask First（先问用户）**
- 新增 npm 依赖
- 改构建配置
- 改数据模型 / schema
- 修改 `preloadPreview()` 方法的逻辑

**Never（禁止）**
- 提交密钥到 git
- 修改 `bin/` 下的构建产物
- 删除失败的测试用例
- `console.log` 替代 `utils/logger.ts`
- 预加载失败时抛出错误（必须静默处理）

## 验收标准

1. **触发时机正确**
   - AI 回复流式结束后，自动调用 `preloadPreview()`
   - 用户消息不触发预加载
   - 只有 AI 回复消息触发预加载

2. **预加载逻辑正确**
   - 调用 `ttsService.preloadPreview(messageId, content, context)`
   - 传入正确的上下文（bookId、bookTitle、bookAuthor、memoryContent）
   - 异步执行，不阻塞 UI

3. **降级处理正确**
   - 预加载失败时，不抛出错误
   - 用户点击朗读时，走原来的流程（`playWithOralRewrite()`）
   - 预加载的语音会被缓存，第二次点击时直接使用

4. **性能影响**
   - 预加载不阻塞 UI 线程
   - 预加载的语音缓存不超过 20 条（现有逻辑）

## 待确认问题

1. 是否需要在预加载时显示加载状态（如 TTS 按钮显示 loading）？
2. 预加载的语音是否需要在界面上提示用户（如"语音已准备好"）？
3. 是否需要支持取消预加载（如用户切换到其他消息）？

## 实现方案

### 修改点

1. **`src/components/message-list/message-list.ts`**
   - 在 `MessageCallbacks` 接口添加 `onStreamingEnd` 回调
   - 在 `MessageList` 中传递回调给 `AIMessage`

2. **`src/components/message/message.ts`**
   - 在 `AIMessage.onStreamingEnd()` 方法中调用 `callbacks.onStreamingEnd`

3. **`src/views/sidebar/sidebar-view.ts`**
   - 在创建 `MessageList` 时实现 `onStreamingEnd` 回调
   - 调用 `ttsCtrl.ttsService.preloadPreview()`

### 调用链

```
AI 回复流式结束
  → message.ts:96 streamingEnded = true
    → message.ts:108 onStreamingEnd()
      → message-list.ts callbacks.onStreamingEnd()
        → sidebar-view.ts 调用 ttsCtrl.ttsService.preloadPreview()
```
