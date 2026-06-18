# 朗读原文 — Bug 分析与修复方案

## 根因分析

| 问题 | 根因 | 严重度 |
|------|------|--------|
| 点击停止仍继续播放 | `readCurrentPage()` 使用 `new Audio()` 手动播放，而非 `TTSService.play()`。`ttsService.stop()` 对 `Audio` 元素无效。`audio.onended` 回调仍然触发后续翻页 | P0 |
| 每页只读 150 字符 | `previewText = cleanText.slice(0, 150)` 硬编码截断，整页文本被丢弃 | P0 |
| 播放和翻页不统一 | 用 `synthesizeRawText()` + 手动 `Audio`，每 150 字生成一个 blob、播放、翻页、重复。没有用 `TTSService` 的流式播放和状态机 | P0 |
| 没有有效的高亮 | `highlightText()` 用 `TreeWalker` + `surroundContents` 作用于 150 字片段，DOM 操作破坏原结构，且在翻页时被 `clearHighlight` 清除 | P1 |
| 未播放完就翻页 | 150 字快速读完 → 立即翻页。用户还没看到当前页的完整内容 | P0 |

## 修复方案

**核心思路**：放弃手动 `synthesizeRawText()` + `new Audio()` 模式，改用 `TTSService.play()` 进行完整流式朗读。

### 改动点

#### 1. `tts-controller.ts` — 改用 `TTSService.play()`

- `handleReadingTTS(text)` → 生成唯一的 `messageId`（如 `reading:chapter-3`），调用 `ttsService.play(messageId, fullPageText, userQuestion?, context?, { rawText: true })`
- `stopReading()` → 调用 `ttsService.stop()`，同时中断 `audio` 播放
- 移除 `readCurrentPage()` 中的 `synthesizeRawText()` + 手动 `Audio` 逻辑
- 播放结束后通过 `ttsService.getState()` 判断是否自然结束 → 调用 `goToNextPage()` 继续

#### 2. `tts-controller.ts` — 新增 `readingAudio: HTMLAudioElement | null`

- 存储当前 `Audio` 实例的引用，`stop()` 时调用 `readingAudio.pause()` + `readingAudio = null`
- 双重保障：`ttsService.stop()` + `audio.pause()`

#### 3. `page-paginator.ts` — 改进高亮

- 替换 `surroundContents` 高亮方式：使用 `mark` 标签包裹 + CSS 高亮，但在翻页前不清除，改为覆盖高亮区域（当前页整体高亮）
- 或者在 `reading-mode-orchestrator.ts` 层面，朗读时给当前页容器加 `.deeppdf-tts-reading-active` class，整页半透明高亮

#### 4. 翻页联动

- 当前页完整朗读完毕后（`ttsService.getState() === 'idle'`），自动调用 `goToNextPage()`
- 翻页后获取新页文本继续朗读，形成循环
- 用户点击停止 / 翻页 / 切章 → `stopReading()` 终止循环

### 不修改的文件

- `TTSService` 核心逻辑（`tts-service.ts`）
- `TTSClient` / `MiniMaxTTSClient`（TTS 引擎层）
- `ReadingModeService` 现有接口
