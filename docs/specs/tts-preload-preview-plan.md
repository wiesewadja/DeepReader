# 实现方案：TTS 预加载功能

> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> ⚠️ 本文件为历史实现记录，已归档。

## 概览

实现 AI 回复流式结束后自动预生成前 250 字语音的功能，优化点击朗读按钮时的首播速度。

## 架构决策

1. **使用现有回调模式** — 遵循 `onTTS`、`onRegenerate` 等回调模式，添加 `onStreamingEnd` 回调
2. **复用现有方法** — 调用已实现的 `preloadPreview()` 方法，不重复实现
3. **异步执行** — 预加载必须异步执行，不阻塞 UI
4. **静默降级** — 预加载失败时静默处理，不影响用户操作

## 任务列表

### 阶段 1：地基

- [x] 任务 1：修改 MessageCallbacks 接口，添加 onStreamingEnd 回调
- [x] 任务 2：修改 MessageList，传递 onStreamingEnd 回调给 AIMessage

### 检查点：地基
- [x] npm run build 通过
- [x] 回调接口正确定义

### 阶段 2：核心功能

- [x] 任务 3：修改 AIMessage.onStreamingEnd() 方法，调用 onStreamingEnd 回调
- [x] 任务 4：修改 sidebar-view.ts，实现 onStreamingEnd 回调和预加载逻辑

### 检查点：核心功能
- [x] npm run build 通过
- [x] npm run test:run 通过
- [x] 预加载逻辑正确触发

### 阶段 3：收尾

- [x] 任务 5：添加日志记录预加载状态
- [x] 任务 6：编写单元测试

### 检查点：全部完成
- [x] 所有验收条件满足
- [x] npm run build 和 npm run test:run 通过
- [x] 可提交审查

## 风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| 预加载失败影响用户体验 | 低 | 静默处理，降级到原有流程 |
| 预加载时机过早（流式未完成） | 中 | 确保 `streamingEnded = true` 时才触发 |
| TTS 服务未初始化 | 低 | 检查 `ttsService` 是否存在 |
| 内存泄漏（预加载音频未释放） | 低 | 使用现有的缓存机制（最多 20 条） |

## 待确认问题

- [ ] 是否需要在预加载时显示加载状态（如 TTS 按钮显示 loading）？
- [ ] 预加载的语音是否需要在界面上提示用户（如"语音已准备好"）？
- [ ] 是否需要支持取消预加载（如用户切换到其他消息）？

## 详细任务

### 任务 1：修改 MessageCallbacks 接口

**描述：** 在 `MessageCallbacks` 接口添加 `onStreamingEnd` 回调，用于通知 AI 回复流式结束。

**验收条件：**
- [ ] `MessageCallbacks` 接口包含 `onStreamingEnd` 回调
- [ ] 回调签名为 `(messageId: string, content: string) => void`
- [ ] 回调是可选的（`onStreamingEnd?:`）

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 类型检查通过

**依赖：** 无

**涉及文件：**
- src/components/message-list/message-list.ts

**预估范围：** XS

### 任务 2：修改 MessageList，传递回调

**描述：** 在 `MessageList` 类中添加 `notifyStreamingEnd` 方法，将 `onStreamingEnd` 回调传递给 `AIMessage`。

**验收条件：**
- [ ] `MessageList` 类包含 `notifyStreamingEnd` 方法
- [ ] 方法签名为 `notifyStreamingEnd(messageId: string, content: string): void`
- [ ] 方法内部调用 `this.callbacks.onStreamingEnd?.(messageId, content)`
- [ ] 在创建 `AIMessage` 时传递回调

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 类型检查通过

**依赖：** 任务 1

**涉及文件：**
- src/components/message-list/message-list.ts

**预估范围：** XS

### 任务 3：修改 AIMessage.onStreamingEnd() 方法

**描述：** 在 `AIMessage.onStreamingEnd()` 方法中调用 `onStreamingEnd` 回调，通知消息列表流式结束。

**验收条件：**
- [ ] `AIMessage.onStreamingEnd()` 方法调用 `this.callbacks.onStreamingEnd?.(this.data.id, this.data.content)`
- [ ] 调用时机正确（流式结束时）
- [ ] 不影响现有的渲染逻辑

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 测试通过：npm run test:run

**依赖：** 任务 2

**涉及文件：**
- src/components/message/message.ts

**预估范围：** XS

### 任务 4：修改 sidebar-view.ts，实现预加载逻辑

**描述：** 在 `sidebar-view.ts` 中实现 `onStreamingEnd` 回调，调用 `ttsCtrl.ttsService.preloadPreview()` 预生成前 250 字语音。

**验收条件：**
- [ ] 在创建 `MessageList` 时实现 `onStreamingEnd` 回调
- [ ] 回调内部调用 `this.ttsCtrl.ttsService.preloadPreview()`
- [ ] 传入正确的上下文（bookId、bookTitle、bookAuthor、memoryContent）
- [ ] 预加载失败时静默处理
- [ ] 预加载异步执行，不阻塞 UI

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 测试通过：npm run test:run
- [ ] 手动测试：AI 回复完成后，检查控制台是否有预加载日志

**依赖：** 任务 3

**涉及文件：**
- src/views/sidebar/sidebar-view.ts

**预估范围：** S

### 任务 5：添加日志记录预加载状态

**描述：** 在预加载的关键步骤添加日志，便于调试和监控。

**验收条件：**
- [ ] 预加载开始时记录日志
- [ ] 预加载成功时记录日志
- [ ] 预加载失败时记录日志
- [ ] 使用 `utils/logger.ts`，不用 `console.log`

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动测试：触发预加载，检查日志输出

**依赖：** 任务 4

**涉及文件：**
- src/views/sidebar/sidebar-view.ts

**预估范围：** XS

### 任务 6：编写单元测试

**描述：** 为修改的代码编写单元测试，确保回调正确传递和预加载逻辑正确触发。

**验收条件：**
- [ ] 测试 `MessageList` 传递 `onStreamingEnd` 回调
- [ ] 测试 `AIMessage.onStreamingEnd()` 调用回调
- [ ] 测试 `sidebar-view.ts` 中预加载逻辑的触发
- [ ] 测试覆盖关键场景
- [ ] 不依赖外部 API（mock TTS 服务）

**验证方法：**
- [ ] 测试通过：npm run test:run
- [ ] 覆盖率检查

**依赖：** 任务 5

**涉及文件：**
- tests/unit/components/message-list/test_message-list.ts
- tests/unit/views/sidebar/test_sidebar-view.ts

**预估范围：** S
