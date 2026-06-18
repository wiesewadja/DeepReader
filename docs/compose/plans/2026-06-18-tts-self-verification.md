# TTS 朗读自证文档

> 两个 TTS 场景的完整链路验证。目标是确认每条路径都能正确地从用户交互走到音频播放。

---

## 场景 A：AI 回复朗读

### 前置条件

| 条件 | 验证 | 代码依据 |
|------|------|----------|
| 用户已配置 TTS (小米 API Key) | ✅ 否则按钮不可用 | `resolveRoleConfig('tts')` 在 sidebar-view 初始化时调用 |
| AI 回复已流式完成 | ✅ 否则 TTS 按钮不可点击 | TTS 按钮只渲染在 `AIMessage` 上 |

### 流程

```
时间线 ─────────────────────────────────────────────────────────────┐
                                                                    │
① AI 回复流式结束                                                    │
   │                                                                 │
   ├─ AIMessage.finalizeStreamingEnd()                               │
   │   → onStreamingEnd(messageId, content)                          │
   │   → sidebar-view.preloadTTSPreview(messageId, content)          │
   │       │                                                         │
   │       ├─ ttsCtrl.ensureService()           ← FIX: 提前初始化   │
   │       │   → initTTSService()                                    │
   │       │     → new TTSService({ttsApiKey, ttsModel, ...})        │
   │       │     → creates TTSClient (mimo, 用户配置模型)            │
   │       │     → creates TTSSummarizer (LLM 口语化改写)             │
   │       │     → sets this.ttsService                              │
   │       │                                                         │
   │       └─ ttsService.preloadPreview(messageId, content)          │
   │           → 截取前 250 字符                                      │
   │           → LLM 口语化改写 (oralRewrite)                         │
   │           → ExpressivePreprocessor 清洗                         │
   │           → TTS 合成 (synthesize, 非流式 WAV)                   │
   │           → 缓存 BlobUrl + Audio，标记 isFull=false             │
   │           ← 预加载完成                                          │
   │                                                                 │
② 用户点击 AI 消息的 🔊 按钮                                          │
   │                                                                 │
   ├─ message-actions.ts: ttsBtn click                               │
   │   → host.onTTS(messageId, content)                              │
   │   → sidebar-view: this.ttsCtrl.handleTTS(id, content, {rawText:true})│
   │       │                                                         │
   │       ├─ ttsService.play(messageId, content, userQuestion,      │
   │       │                      context, { rawText: true })        │
   │       │   ├─ setState('tts_loading')          ← 按钮变旋转     │
   │       │   ├─ 推测书籍类型 (genre detection)                     │
   │       │   ├─ 解析音色 (voiceProfile)                            │
   │       │   ├─ 查缓存 (内存 → 磁盘)                               │
   │       │   │                                                      │
   │       │   └─ playWithOralRewrite(cleanContent, voiceProfile,     │
   │       │                              cached /* 步骤①的产物*/)  │
   │       │       │                                                  │
   │       │       ├─ !cached → cached 存在 → ✅                     │
   │       │       │   cached 有 isFull=false                         │
   │       │       │   (预加载只合成了前 250 字符)                     │
   │       │       │                                                  │
   │       │       ├─ cached.audio.play()          ← 即时出声        │
   │       │       │   setState('playing')          ← 按钮变音波     │
   │       │       │   250 字符 ≈ 10 秒播放                          │
   │       │       │                                                  │
   │       │       ├─ 同时后台并发合成剩余文本:                       │
   │       │       │   splitTextIntoSegments(剩余, 300字符/段)       │
   │       │       │   并发池 (SYNTHESIS_CONCURRENCY=3,              │
   │       │       │   tt-service.ts:485)                             │
   │       │       │   每段: synthesize() → playAudioAndWait()       │
   │       │       │                                                  │
   │       │       └─ 全部播完 → 合并写入磁盘缓存                    │
   │       │           setState('idle')            ← 按钮恢复        │
   │       │           highlightTTSProgress(-1)    ← 清除高亮        │
   │       │                                                         │
   │       └─ 同时: TTSReadingController.highlightProgress(progress) │
   │           → message.css 中 .deeppdf-tts-reading-paragraph       │
   │           → 墨水晕染动画从左到右扩散                             │
   │           → scrollIntoView                                      │
   │                                                                  │
③ 用户再次点击同一消息的 🔊 按钮                                      │
   │                                                                  │
   └─ handleTTS → getCurrentMessageId() === messageId               │
       → state !== 'idle' → togglePauseResume()     ← 暂停/继续    │
```

### 关键自证点

| 步骤 | 是否正确 | 证据 |
|------|---------|------|
| 流式结束触发预加载 | ✅ | `sidebar-view.ts:1054` — `onStreamingEnd` → `preloadTTSPreview` |
| 首次预加载前 TTS 服务已初始化 | ✅ | `sidebar-view.ts:1283-1286` — `ensureService()` 提前调 `initTTSService()` |
| 预加载合成了前 250 字符 | ✅ | `tts-service.ts:310` — `cleanContent.slice(0, 250)` |
| 点击按钮时缓存命中 | ✅ | `playWithOralRewrite()` 首段查 `this.cache.get(cacheKey)` |
| 缓存命中则即时播放 | ✅ | `tts-service.ts:388-403` — 有缓存直接 `playAudioAndWait(cached.audio)` |
| 剩余文本并发合成 | ✅ | `tts-service.ts:485` — `SYNTHESIS_CONCURRENCY=3` 并发池 |
| 消息段落可高亮 | ✅ | `tts-service.ts:744` 注释 `highlightTTSProgress`，`tts-reading-controller.ts:71` |
| 同消息点击切换暂停/继续 | ✅ | `handleTTS:157-164` — `togglePauseResume()` |

---

## 场景 B：原文朗读

### 前置条件

| 条件 | 验证 | 代码依据 |
|------|------|----------|
| 用户已配置 TTS | ✅ | `initReadingClient()` 检查 `resolveRoleConfig('tts')` |
| 阅读模式已激活 | ✅ | 按钮在 ReadingTopbar 中，只有阅读模式可见 |

### 流程

```
时间线 ─────────────────────────────────────────────────────────────┐
                                                                    │
① 用户点击阅读顶栏 🔊 按钮                                           │
   │                                                                 │
   ├─ readingTopbar.ts: ttsBtn click                                 │
   │   → onToggleReadingTTS()                                        │
   │   → sidebar-view.toggleReadingTTS()                             │
   │       │                                                         │
   │       ├─ readingTopbar state → idle → 走朗读分支                │
   │       │                                                         │
   │       ├─ 获取文本 (有选区用选区，否则用当前页段落拼接)          │
   │       │   → 仅用于判空，实际朗读不依赖此文本                    │
   │       │                                                         │
   │       ├─ readingTopbar.setReadingTTSState('loading')            │
   │       │                                                         │
   │       └─ ttsCtrl.handleReadingTTS()                             │
   │           │                                                     │
   │           ├─ currentSource = 'reading'                          │
   │           ├─ readingAbort = new AbortController()               │
   │           ├─ readingClient = new TTSClient(                     │
   │           │     model='mimo-v2.5-tts')   ← 固定预置音色模型    │
   │           │                                                     │
   │           └─ readCurrentPage()                                  │
   │               │                                                 │
② readCurrentPage() — Page N                                        │
   │                                                                 │
   ├─ getPageParagraphs()                                            │
   │   ├─ totalParagraphs = 30, _currentPage = N, totalPages = 3    │
   │   ├─ startIdx = (N-1)*30/3, endIdx = N*30/3                    │
   │   └─ return [{element:<p>, text:"原文"}, ...] (当前页段落)     │
   │                                                                 │
   ├─ if paragraphs.length === 0 → goToNextPage() → 递归            │
   │                                                                 │
   ├─ setReadingTTSState('playing')    ← 按钮变音波 + 脉冲动画       │
   │                                                                 │
   ├─ player = new PCMStreamPlayer()   ← 一个 player 服务整页       │
   │   AudioContext 只在此时创建一次                                   │
   │                                                                 │
   ├─ for i = 0 .. paragraphs.length-1:                             │
   │   ├─ highlightElement(paragraphs[i].element)                    │
   │   │   → <p> 加 .deeppdf-tts-reading-paragraph                  │
   │   │   → 墨水晕染动画                                             │
   │   │   → scrollIntoView                                          │
   │   │                                                             │
   │   ├─ preprocessForTTS(paragraphs[i].text)                       │
   │   │   → stripMarkdown / stripWikiLinks / stripBlockIds          │
   │   │   → compressWhitespace                                      │
   │   │                                                             │
   │   ├─ readingClient.synthesizeStream(cleanText, {voice:'冰糖'},  │
   │   │                                readingAbort.signal)         │
   │   │   → POST /chat/completions {stream:true, format:pcm16}     │
   │   │   → SSE delta.audio.data (base64 PCM16 chunks)             │
   │   │                                                             │
   │   └─ for await (chunk of stream):                               │
   │       → player.enqueue(chunk)            ← 连续入队，不等待    │
   │       → PCM 实时播放                                             │
   │                                                                 │
   ├─ 所有段落 stream 完毕                                           │
   │   → player.seal()                                              │
   │   → await player.waitForEnd()          ← 等待全部播完          │
   │                                                                 │
   ├─ clearHighlight()                                               │
   │                                                                 │
   └─ goToNextPage()                                                 │
       └─ paginator.nextPage()                                       │
           ├─ scrollBy(pageWidth)          ← 平滑翻页               │
           ├─ _currentPage = Min(N+1, totalPages)  ← FIX: 立即同步  │
           ├─ forceRerender()                                        │
           └─ return true (非末页) / false (末页)                    │
                                                                     │
③ 递归 readCurrentPage() — Page N+1 (仅当 goToNextPage 返回 true)   │
   └─ 重复步骤②                                                        │
                                                                     │
④ 章节末尾 (goToNextPage 返回 false)                                 │
   └─ stopReading() → Notice('朗读完毕')                             │
                                                                     │
⑤ 用户中途停止 (再次点击 🔊 / 手动翻页 / 切章)                      │
   │                                                                 │
   ├─ toggleReadingTTS(): state !== 'idle' → stopReadingTTS()       │
   │   ├─ ttsCtrl.stopReading()                                     │
   │   │   ├─ readingAbort.abort()      ← fetch 中断               │
   │   │   ├─ readingPlayer.stop()      ← 声音立即停止              │
   │   │   ├─ currentSource = 'message'                             │
   │   │   └─ clearHighlight()                                       │
   │   └─ readingTopbar.setReadingTTSState('idle')                   │
   │                                                                 │
   └─ readingModeOrchestrator:onStopReadingTTS (翻页/切章自动触发)   │
       → main.ts: view.stopReadingTTS()                              │
       → 同上 stop 流程                                              │
```

### 关键自证点

| 步骤 | 是否正确 | 证据 |
|------|---------|------|
| 按钮在 ReadingTopbar 右侧 | ✅ | `reading-topbar.ts:100-113` — 在书库/设置按钮旁 |
| 点击→互斥检查 | ✅ | `handleReadingTTS` 先 stop 再 start；`handleTTS` 同理 |
| `_currentPage` 翻页后正确 | ✅ | `page-paginator.ts:257` — `_currentPage = Min(current+1, totalPages)` |
| `getPageParagraphs()` 返回正确段落 | ✅ | 使用更新后的 `_currentPage` 计算 `slice` |
| 高亮段落 = 朗读段落 | ✅ | 同一次 `getPageParagraphs()` 返回的 `element` 和 `text` |
| 不创建多个 AudioContext | ✅ | `new PCMStreamPlayer()` 在 for 循环**外** |
| 段落间无间隙 | ✅ | 每段 stream 连续 `enqueue` 到同一个 player |
| 停止时立即无声 | ✅ | `player.stop()` + `abort()` 双重保障 |
| 翻页/切章自动停止 | ✅ | `onStopReadingTTS` 回调 |
| 固定 mimo-v2.5-tts 非 voicedesign | ✅ | `initReadingClient()` 写死 `model='mimo-v2.5-tts'` |
| 预加载不干扰原文朗读 | ✅ | 原文朗读用独立 `readingClient`，不走 `ttsService` |

## 两场景对比

| 维度 | AI 回复朗读 | 原文朗读 |
|------|------------|----------|
| 触发 | 消息气泡 🔊 按钮 | 阅读顶栏 🔊 按钮 |
| 模型 | `mimo-v2.5-tts-voicedesign`(用户配置) | `mimo-v2.5-tts`(固定) |
| 音色 | VoiceDesign 从文本生成 | 预置音色 冰糖 |
| 合成方式 | 非流式 `synthesize()` → `new Audio()` | 流式 `synthesizeStream()` → `PCMStreamPlayer` |
| 文本来源 | 消息 content | `getPageParagraphs()` DOM 段落 |
| 高亮 | `highlightTTSProgress(0-100)` 进度 → 消息内 `<p>` | `highlightElement(el)` → 阅读页面 `<p>` |
| 预加载 | ✅ 流式结束后立即开始 | ❌ 不需要（点击后直接流式合成） |
| 暂停/继续 | ✅ `togglePauseResume()` | ❌ 不支持（设计如此） |
| 翻页联动 | ❌ 不涉及 | ✅ 读完当前页自动翻页 |
| 停止机制 | `ttsService.stop()` | `abort()` + `player.stop()` 双重 |
