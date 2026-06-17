# TTS + ASR 集成

> 文本转语音（Text-to-Speech）和语音转文本（Automatic Speech Recognition）—— DeepReader 的
> "眼睛 + 耳朵" 双向接口。
>
> 配套阅读：[system-overview.md 第 8 节 集成边界](../architecture/system-overview.md#integrations)、[config-system.md 角色表 tts](../architecture/config-system.md#roles)、[features/ui.md F-22~F-25](../features/ui.md)。

---

## 目录

1. [设计意图：让用户"听书 + 说话"](#why)
2. [TTS：文本 → 语音](#tts)
3. [ASR：语音 → 文本](#asr)
4. [语音输入控制器：用户操作流](#controller)
5. [已知限制 limits](#limits)
6. [关键源文件](#files)

---

## 设计意图 (why)

DeepReader 主要是**视觉交互**——用户看 / 听 AI 的回答。但有两类用户场景需要"耳朵"：

1. **通勤 / 运动时听书**——把 Agent 回答 / 当前章节用 TTS 念出来
2. **语音提问**——用户用嘴代替键盘，把问题说给 AI

**TTS** + **ASR** 一起提供这套能力。

---

## TTS：文本 → 语音

**位置**：`src/services/tts/tts-service.ts`（1527 行）

### Provider

**默认**：`xiaomi` 的 `mimo-v2.5-tts-voicedesign` 模型——支持**声音设计**（指定音色、年龄、性别）。

### 角色配置

```typescript
{
  tts: AIRoleConfig | null;
  // null = 禁用 TTS 功能
}
```

**位置**：[配置系统详解 § 8 角色](../architecture/config-system.md#roles)。奚童预设默认配置 `tts: mimo-v2.5-tts-voicedesign`。

### 关键能力

- **多段拼接**：长文本分句生成音频 → 拼接（避免单次请求超时）
- **缓存**：相同文本的音频**MurmurHash 缓存**到本地，避免重复请求
- **流式播放**：`HTMLAudioElement` 边下边播
- **声音设计参数**：`age` / `gender` / `emotion` / `speed` 来自 settings

### 播放入口

- **回答气泡的"播放"按钮**（`src/views/sidebar/message.ts`）
- **当前章节"听书"模式**（`src/views/sidebar/reading-mode-tts.ts`）
- **搜索结果"听摘要"**（`src/views/sidebar/search-utils.ts`）

### 缓存策略

`cache/<text_hash>.mp3` —— 同文本下次播放直接走本地文件。

**位置**：`src/services/tts/tts-service.ts:TTSCache`

```typescript
class TTSCache {
  private cacheDir = '.obsidian/plugins/deepreader/tts-cache/';
  async get(text: string): Promise<Buffer | null> { /* ... */ }
  async put(text: string, audio: Buffer): Promise<void> { /* ... */ }
}
```

**命中率**：用户重复听同一段 AI 回答的频率高——缓存**实用价值高**。

### 错误降级

| 错误 | 降级 |
|---|---|
| Provider 不可达 | 提示"语音服务暂不可达" + 隐藏播放按钮 |
| 文本过长 (> 5000 字) | 自动分 5 段 + 并行生成 |
| 流式中断 | 重试 1 次 + 仍失败则用本地缓存降级 |
| 声音设计参数不支持 | 回退到该 Provider 默认音色 |

---

## ASR：语音 → 文本

**位置**：`src/services/asr/` (4 文件)

### Provider

**默认**：自建 ASR 服务（`src/services/asr/asr-client.ts`）——通过 WebSocket 推送音频流。

**支持浏览器 API**：`MediaRecorder` + `getUserMedia` 录音。

### 关键设计

#### 1. 增量识别（不是录完再传）

```typescript
// src/services/asr/audio-recorder.ts
class AudioRecorder {
  start() { /* MediaRecorder.start(100) 每 100ms 切片 */ }
  onChunk = (chunk: Blob) => ws.send(chunk);  // 实时推
  stop()   { /* 发送结束帧，等待最终结果 */ }
}
```

**好处**：用户说完 5 秒，**前 4 秒已经开始识别**——不用等 5 秒全部录完再返回。

#### 2. 增量结果 + 最终结果（两阶段）

| 阶段 | 返回内容 | 用户感知 |
|---|---|---|
| 中间结果 | 实时变化的"暂定"文本（覆盖式更新） | 输入框文字边说边改 |
| 最终结果 | "已确定"文本 | 触发发送 |

**协议**：WebSocket 消息 `{ type: 'partial' | 'final', text, confidence }`。

#### 3. VAD（Voice Activity Detection）

`src/services/asr/audio-utils.ts:detectSilence()` —— 监测音频能量，**2 秒无声自动停止**。

**好处**：用户说完忘了点"停止"——不会无限录音。

### 错误降级

| 错误 | 降级 |
|---|---|
| getUserMedia 被拒 | 提示"需要麦克风权限" + 显式引导 |
| WebSocket 断开 | 自动重连 3 次，**最终失败则保留已识别文本** |
| 浏览器不支持 MediaRecorder | 显式提示 + 禁用语音入口 |

---

## 语音输入控制器：用户操作流 (controller)

**位置**：`src/services/asr/voice-input-controller.ts`（150 行）

### 状态机

```
idle
  ↓ 用户点麦克风按钮
recording (MediaRecorder.start)
  ↓ 用户点停止 / VAD 触发
processing (等待 ASR 最终结果)
  ↓ final 文本到达
idle (把 final 文本塞入 chat input)
```

### 集成点

```typescript
// src/components/chat-input/chat-input.ts
const controller = new VoiceInputController({
  onFinalText: (text) => { this.insertText(text); },
  onPartialText: (text) => { this.showInterimText(text); },
  onError: (err) => { this.showError(err); },
});
```

**关键**：`onPartialText` 让用户**实时看到识别结果**——及时纠错（中文 ASR 同音字多）。

### 移动端兼容

`getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })` —— 在移动端浏览器启用**回声消除 + 噪音抑制**。

---

## 已知限制 limits

### TTS

- **不支持多说话人** —— 一次只能合成一个声音
- **不支持 SSML** —— 不能精细控制停顿 / 重音
- **缓存键不含声音设计参数** —— 同一文本用不同音色播会**复用缓存**（错）
- **不支持导出音频** —— 用户不能把"听书" 保存成 MP3 文件

### ASR

- **不支持中英混合识别** —— 中文模型识别英文差，英文模型识别中文差
- **不支持领域术语** —— 专业书（哲学 / 法律）的术语识别率低
- **无说话人分离** —— 不能识别"用户 A" vs "用户 B" 的声音
- **不支持离线** —— 必须联网

---

## 关键源文件 (files)

| 文件 | 职责 |
|---|---|
| `src/services/tts/tts-service.ts` | TTS 主服务（合成 + 缓存 + 流式播放） |
| `src/services/tts/tts-client.ts` | HTTP 客户端（小米 TTS API） |
| `src/services/tts/book-genre-detector.ts` | 书籍题材检测（影响音色选择） |
| `src/services/asr/asr-client.ts` | ASR WebSocket 客户端 |
| `src/services/asr/audio-recorder.ts` | MediaRecorder 封装（增量切片） |
| `src/services/asr/audio-utils.ts` | 音频工具（VAD / 能量检测 / 格式转换） |
| `src/services/asr/voice-input-controller.ts` | 状态机控制器 |
| `src/components/chat-input/chat-input.ts` | 语音入口 UI 集成 |
| `tests/unit/services/tts/tts-service.test.ts` | TTS 单测（mock Provider） |
| `tests/unit/services/tts-client.test.ts` | TTS 客户端单测 |
| `tests/unit/asr/asr-client.test.ts` | ASR 客户端单测 |
| `tests/unit/asr/audio-utils.test.ts` | 音频工具单测 |

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/services/tts/*` 1527 行 + `src/services/asr/*` 4 文件的架构视角文档。TTS（小米 v2.5-tts-voicedesign + 缓存）/ ASR（MediaRecorder + 增量 + VAD）双覆盖。已知限制 7 条 |
