# 语音书信回复设计文档

> **日期**: 2026-04-23
> **状态**: 设计确认
> **分支**: worktree-feat+tts-voice-summary
> **前置条件**: TTS 基础设施已就绪（tts-client.ts、tts-service.ts、tts-summarizer.ts、pcm-stream-player.ts）

---

## 概述

当用户配置了 TTS 服务后，AI 回复从"纯文字气泡"变为"语音对话 + 书信"双形态体验。语音消息是主角，文字默认藏在信封中，用户主动拆信才展开。语音和文字从状态机中间阶段（S2 分析结果）并行生成。

### 已有基础设施（当前分支）

- `TTSClient` — MiMo V2.5 导演模式，支持 `synthesize()`（非流式 WAV）和 `synthesizeStream()`（流式 PCM）
- `TTSSummarizer` — LLM 口语化摘要，`summarize()` 和 `summarizeStream()`
- `TTSService` — 播放状态管理（idle/summarizing/playing/paused），PCM 播放器
- `PCMStreamPlayer` — Web Audio API PCM 流播放，支持 pause/resume/stop
- `sidebar-view.ts` 已集成 TTS 播放按钮和 `initTTSService()`

---

## 设置

在现有 `tts` role 配置基础上新增：

- `enableVoiceReply: boolean` — 开关，默认 false

开启后 AI 回复进入"语音书信"模式。关闭则恢复当前纯文字气泡模式，零副作用。

---

## 数据流架构

方案 B：Callback 驱动的并行管道。LangGraph 图结构不变，TTS 作为"侧挂"管道独立运行。

```
用户提问
  ↓
S0 Router → S1 Inspectional → S2 Analytical（产出 analysisResult）
  ↓
processGraphStream 检测到 analysisResult && enableVoiceReply
  ├─ 分支A：S4 Formatter → onContent(accumulated) → 墨水动画流入信封
  └─ 分支B：异步启动 VoicePipeline(analysisResult, context)
       ↓
       TTSSummarizer.summarizeStream(analysisResult, userQuestion, context)
       ↓ 逐句产出摘要文本
       收集完整摘要 → TTSClient.synthesize(完整摘要)
       ↓ 非流式合成，一次性返回完整 WAV
       onVoiceReady({ audioBuffer, duration }) → 语音气泡出现
```

### 为什么用非流式合成

- 语音气泡需要显示时长（如 `0:42`），流式模式下时长未知
- 用户点击后才播放，不需要边合成边播
- MiMo V2.5 流式模式只是兼容模式（一次返回全部），没有真正的渐进
- 生成完成后才显示气泡，避免用户点击时音频不完整

### Summarizer

只保留"口头解读"模式，直接从 analysisResult 生成口语化的语音内容（200-300 字）。不再有"摘要播报"模式。

---

## UI 组件

### AIMessage 组件结构

```
AI 消息组件
├─ 语音气泡（voice bubble）
│   ├─ 播放按钮 ▶ / ⏸
│   ├─ 音波动画条（播放中）
│   ├─ 时长显示（如 0:42）
│   └─ 状态：loading → ready → playing → paused → ended
│
├─ 信封（letter envelope）
│   ├─ 信封外壳（固定高度，纸张质感，适配 Obsidian 主题）
│   ├─ 墨水书写区域
│   │   ├─ 已写入文字（主题前景色）
│   │   ├─ 书写光标（闪烁竖线）
│   │   └─ 未写入占位（主题低对比色）
│   └─ 拆信按钮
│
└─ 展开后的完整书信（opened）
    ├─ 完整 Markdown 渲染
    ├─ 喇叭按钮（朗读原文，TTS 直接合成完整 formattedOutput，带奚童人设但不摘要）
    ├─ 复用现有的 action 按钮（全屏、复制等）
    └─ 收起按钮（回到信封状态）
```

### 信封状态机

```
sealing（墨水书写中）→ sealed（书写完成）→ opened（已拆信）
     ↑                                      ↓
     └────────── 收起按钮 ←─────────────────┘
```

- `sealing`：S4 的 `onContent` 回调驱动墨水动画，文字逐行出现
- `sealed`：墨水写完，信封完整，显示"拆开信封"按钮
- `opened`：信封展开，完整格式化内容
- 任何状态下用户都可以点击拆信（包括 `sealing` 中）

### 语音气泡状态

```
loading（语音生成中）→ ready（可播放）→ playing → paused → ended
                                              ↓
                                          playing（可反复）
```

- `loading`：不显示气泡，或者显示带 loading 动画的占位
- `ready`：显示完整气泡（时长 + 播放按钮）
- `playing`：音波动画，按钮变为暂停
- `paused`：暂停音波，按钮变为播放
- `ended`：播放完毕，按钮回到播放图标

### 视觉风格

所有颜色使用 Obsidian CSS 变量，不硬编码颜色值：
- 信封背景：`--background-primary` / `--background-secondary`
- 文字颜色：`--text-normal` / `--text-muted`
- 边框：`--background-modifier-border`
- 强调色：`--interactive-accent`

### 交互规则

- 语音气泡和信封独立。点击语音不影响信封，反之亦然
- 语音播放时可同时展开信封阅读（边听边看）
- 未开启 `enableVoiceReply` 时不显示语音气泡和信封，回到纯文字模式
- 信封展开后，action 按钮区域保留喇叭按钮。点击喇叭 → TTS 直接合成 formattedOutput 全文（不走 Summarizer，不做摘要），带奚童导演模式人设但朗读原文。用于用户想边听边读完整内容的场景
- 喇叭朗读和语音气泡互斥：正在播放语音气泡时点击喇叭，暂停气泡播放并切换到朗读原文

---

## 错误处理与降级

- VoicePipeline 失败 → 静默降级，不显示语音气泡，只显示信封文字
- Graph 失败但 analysisResult 已拿到 → VoicePipeline 可以继续完成
- 用户取消查询 → `abortController` 同时取消 graph stream 和 voicePipeline

---

## 涉及文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/config/settings.ts` | 修改 | 新增 `enableVoiceReply` 设置项 |
| `src/settings/setting-tab.ts` | 修改 | 新增语音对话开关 UI |
| `src/agent/index.ts` | 修改 | processGraphStream 中新增 voicePipeline 分叉逻辑 |
| `src/agent/types.ts` | 修改 | AgentCallbacks 新增 `onVoiceReady` 回调 |
| `src/services/tts/tts-summarizer.ts` | 修改 | 统一为"口头解读"模式，输入改为 analysisResult |
| `src/services/tts/tts-service.ts` | 修改 | 新增 `generateVoiceBlob()` 方法（非流式合成） |
| `src/components/message/message.ts` | 修改 | 新增语音气泡 + 信封渲染逻辑 |
| `src/components/message/message.css` | 修改 | 信封样式、墨水动画、语音气泡样式 |
| `src/views/sidebar-view.ts` | 修改 | 接收 onVoiceReady、传递语音数据到消息组件 |
