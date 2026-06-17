---
feature: tts-preload-preview
status: delivered
specs:
  - docs/specs/tts-preload-preview.md
plans:
  - docs/specs/tts-preload-preview-plan.md
branch: feat/tts-preload-preview
commits: 2d7c8847..c754faff
---

# TTS 预加载功能 — 最终报告

## What Was Built

实现 AI 回复流式结束后自动预生成前 250 字语音的功能，优化点击朗读按钮时的首播速度。当用户点击气泡朗读按钮时，前 250 字语音已预生成，立即播放，而不是等待 TTS 合成。

**核心价值：** 用户体验提升，首播延迟从 3-5 秒降低到 0 秒（预加载完成时）。

## Architecture

### 组件关系

```
sidebar-view.ts
    │
    │  onStreamingEnd 回调
    │
    ▼
message-list.ts
    │
    │  传递回调给 AIMessage
    │
    ▼
message.ts
    │
    │  AIMessage.onStreamingEnd() 调用回调
    │
    ▼
tts-service.ts
    │
    │  preloadPreview() 预生成语音
    │
    ▼
tts-summarizer.ts
    │
    │  oralRewrite() 口语化改写
    │
    ▼
tts-client.ts
    │
    │  synthesize() 合成语音
```

### 数据流

1. **AI 回复流式结束** → `AIMessage.onStreamingEnd()` 触发
2. **通知消息列表** → `callbacks.onStreamingEnd(messageId, content)`
3. **预加载语音** → `ttsCtrl.ttsService.preloadPreview()`
4. **口语化改写** → `summarizer.oralRewrite()` 将书面语转为奚童口吻
5. **合成语音** → `client.synthesize()` 生成前 250 字音频
6. **缓存音频** → 存入内存缓存，供后续播放使用

### 关键文件

- `src/components/message-list/message-list.ts` — `MessageCallbacks` 接口，`notifyStreamingEnd()` 方法
- `src/components/message/message.ts` — `AIMessage.onStreamingEnd()` 方法
- `src/views/sidebar/sidebar-view.ts` — `preloadTTSPreview()` 方法
- `src/services/tts/tts-service.ts` — `preloadPreview()` 方法（已实现）
- `src/services/tts/voice-profile.ts` — `DEFAULT_VOICE_DESIGN_PROMPT` 音色描述

## Usage

### 自动预加载

无需用户操作。AI 回复流式结束后，自动预生成前 250 字语音。

### 手动朗读

用户点击气泡朗读按钮时：
1. 检查是否有预缓存的语音
2. 如果有，立即播放预缓存的语音
3. 同时后台继续生成剩余部分的语音
4. 预缓存播放完后，无缝衔接继续播放

### 音色设计

使用 VoiceDesign 模式时，音色描述已优化为：
- 一位二十岁左右的年轻女性
- 声音清亮柔和，带着书卷气和少女的灵动
- 语气温暖亲切，像在和好朋友分享读书心得
- 语速中等偏快，咬字清晰利落
- 像一位聪明伶俐的小师妹，是用户的伴读书童

## Verification

### 测试覆盖

- ✅ 单元测试：`npm run test:run` 全部通过（1581 passed）
- ✅ 构建验证：`npm run build` 通过
- ✅ 类型检查：TypeScript 严格模式通过

### 测试用例

1. **MessageList 传递 onStreamingEnd 回调** — 验证回调正确传递
2. **AIMessage.onStreamingEnd() 调用回调** — 验证调用时机正确
3. **预加载逻辑触发** — 验证预加载方法被正确调用

### 边界情况

- 预加载失败时静默处理，不影响用户操作
- TTS 服务未初始化时，跳过预加载
- 预加载的语音缓存不超过 20 条（现有逻辑）

## Journey Log

- [dead end] 最初计划在 `tts-summarizer.ts` 中使用 `promptRegistry` 获取提示词，但发现该文件是独立模块，不依赖 `agent/prompts` 系统
- [pivot] 从优化提示词统一改为实现预加载功能，因为用户需求是首播速度优化
- [lesson] VoiceDesign 模式的音色描述需要根据角色设定精心设计，不能简单使用默认值
- [lesson] 测试期望值需要与实际实现保持一致，修改音色描述后必须同步更新测试

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/specs/tts-preload-preview.md` | 功能规格书 | 定义验收标准和技术约束 |
| `docs/specs/tts-preload-preview-plan.md` | 实现计划 | 6 个垂直切片任务 |
| `src/services/tts/tts-service.ts` | TTS 服务 | `preloadPreview()` 方法已实现 |
| `src/services/tts/voice-profile.ts` | 音色配置 | VoiceDesign 音色描述 |
