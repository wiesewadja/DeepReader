# MIMO v2.5 TTS 流式 API 对比分析

## API 规格

| 维度 | 文档说明 | 当前实现 |
|------|---------|----------|
| 流式端点 | `/chat/completions` + `stream: true` | ✅ `synthesizeStream()` 已实现 |
| 流式格式 | `format: pcm16`，SSE `delta.audio.data` (base64) | ✅ `readStream()` 解析正确 |
| 非流式格式 | `format: wav`，`message.audio.data` (base64 WAV) | ✅ `synthesize()` 已实现 |
| 音色 (tts) | `audio.voice` 字段传入 voice ID | ✅ 已实现 |
| 导演模式 | `messages[0].role: user` 写风格描述 | ✅ `options.styleText` 已实现 |
| 停止机制 | AbortController 中断 fetch | ❌ `readStream` 没有接入 AbortSignal |

## 当前实现的问题

**`handleReadingTTS()` 错误地使用了非流式路径：**

```
synthesizeRawText(text)     ← 非流式，等全部生成完才返回
  → TTSClient.synthesize()  ← format: wav，post 等待全部响应
    → base64 decode
    → new Blob([audioBuffer])  →  new Audio(blobUrl)
    → audio.play()            ← 播放时无法中断
```

**正确路径应该是（已有的基础设施）：**

```
TTSClient.synthesizeStream(text)  ← stream: true, format: pcm16
  → SSE data: 流式到达
  → PCMStreamPlayer.enqueue(chunk)  ← 实时播放
  → PCMStreamPlayer.seal() + waitForEnd()
  → 播放完毕 → 自动翻页
```

## 关键资产已就绪

| 资产 | 状态 |
|------|------|
| `TTSClient.synthesizeStream()` | ✅ 流式 API 调用已实现 |
| `PCMStreamPlayer` | ✅ 实时 PCM16 播放已实现 |
| `TTSService.stop()` | ✅ 可中断 fetch + 停止 player |
| AbortController | ❌ 需要传入到 `synthesizeStream()` 的 fetch |

## 修复路径

1. `handleReadingTTS()` 改为使用 `synthesizeStream()` + `PCMStreamPlayer`
2. 添加 `AbortController` 支持停止
3. 播放完整页文本，不截断 150 字
4. 播放完毕自动翻页
5. 原文高亮：朗读时给当前页容器加 `.deeppdf-tts-reading-active` class
