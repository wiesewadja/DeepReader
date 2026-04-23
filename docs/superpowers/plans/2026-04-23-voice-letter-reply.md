# 语音书信回复 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 回复从纯文字气泡变为"语音对话气泡 + 信封书信"双形态，语音和文字从 S2 分析结果并行生成。

**Architecture:** Callback 驱动的并行管道。LangGraph 图结构不变，在 processGraphStream 中检测 analysisResult 后异步启动 VoicePipeline。TTS 非流式合成完整音频后通过 onVoiceReady 回调通知 UI。AIMessage 组件新增语音气泡和信封两个子区域。

**Tech Stack:** TypeScript, Obsidian Plugin API, Web Audio API, MiMo V2.5 TTS API, CSS Variables (主题适配)

**Branch:** `worktree-feat+tts-voice-summary`（已有 TTS 基础设施）

**Spec:** `docs/superpowers/specs/2026-04-23-voice-letter-reply-design.md`

---

## File Structure

| 文件 | 变更 | 职责 |
|------|------|------|
| `src/config/settings.ts` | 修改 | 新增 `enableVoiceReply` 设置项 |
| `src/settings/setting-tab.ts` | 修改 | 新增语音对话开关 UI |
| `src/agent/types.ts` | 修改 | AgentCallbacks 新增 `onVoiceReady` |
| `src/agent/index.ts` | 修改 | processGraphStream 中启动 VoicePipeline |
| `src/services/tts/tts-service.ts` | 修改 | 新增 `generateVoiceBlob()` 非流式合成方法 |
| `src/components/message/message.ts` | 修改 | 新增语音气泡 + 信封渲染 |
| `src/components/message/message.css` | 修改 | 信封、墨水动画、语音气泡样式 |
| `src/views/sidebar-view.ts` | 修改 | 接收 onVoiceReady、传递语音数据到消息组件 |

---

## Chunk 1: 设置与数据类型

### Task 1: 新增 enableVoiceReply 设置项

**Files:**
- Modify: `src/config/settings.ts`

- [ ] **Step 1: 在 DeepPDFSettings 接口中添加 enableVoiceReply**

在 `src/config/settings.ts` 第 100 行 `autoTTS: boolean;` 后面添加：

```typescript
// TTS 语音播报
autoTTS: boolean;
enableVoiceReply: boolean; // 语音对话+书信回复模式
```

- [ ] **Step 2: 在 DEFAULT_SETTINGS 中添加默认值**

在 `DEFAULT_SETTINGS` 中 `autoTTS: false,` 后面添加：

```typescript
autoTTS: false,
enableVoiceReply: false,
```

- [ ] **Step 3: 在 setting-tab.ts 中添加开关 UI**

在 `src/settings/setting-tab.ts` 的 `renderAdvancedSettings` 方法中（第 768 行附近，`enableDebugLog` toggle 之后），添加：

```typescript
// 语音对话回复
new Setting(container)
    .setName("语音书信回复")
    .setDesc("AI 回复变为语音对话气泡+书信模式。语音从分析结果并行生成，文字以信封形式呈现。")
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableVoiceReply)
        .onChange(async (value) => {
            this.plugin.settings.enableVoiceReply = value;
            await this.plugin.saveSettings();
        }));
```

- [ ] **Step 4: 构建验证**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/feat+tts-voice-summary && npm run build`
Expected: 成功，无类型错误

- [ ] **Step 5: Commit**

```bash
git add src/config/settings.ts src/settings/setting-tab.ts
git commit -m "feat(voice-reply): 新增 enableVoiceReply 设置项和开关 UI"
```

---

### Task 2: 新增回调类型和 MessageData 字段

**Files:**
- Modify: `src/agent/types.ts` (第 86-92 行 AgentCallbacks)
- Modify: `src/components/message/message.ts` (第 222-263 行 MessageData)

- [ ] **Step 1: 在 AgentCallbacks 中新增 onVoiceReady**

在 `src/agent/types.ts` 的 `AgentCallbacks` 接口中（第 91 行 `onError` 之后）：

```typescript
export interface AgentCallbacks {
  onContent: (text: string) => void;
  onToolCall: (toolName: string, args: Record<string, unknown>) => void;
  onProgress: (status: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onVoiceReady?: (data: { audioBuffer: ArrayBuffer; duration: number }) => void;
}
```

- [ ] **Step 2: 在 MessageData 接口中新增语音和信封字段**

在 `src/components/message/message.ts` 的 `MessageData` 接口中（第 262 行 `bookAuthor` 之后）：

```typescript
  bookAuthor?: string;
  // 语音对话气泡
  voiceAudio?: ArrayBuffer;
  voiceDuration?: number;  // 秒
  voiceState?: 'loading' | 'ready' | 'playing' | 'paused' | 'ended';
  // 信封状态
  letterState?: 'sealing' | 'sealed' | 'opened';
  // 语音对话模式开关（由 sidebar-view 根据设置传入）
  enableVoiceReply?: boolean;
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 可能有未使用字段的 warning，但无类型错误

- [ ] **Step 4: Commit**

```bash
git add src/agent/types.ts src/components/message/message.ts
git commit -m "feat(voice-reply): 新增 onVoiceReady 回调和 MessageData 语音/信封字段"
```

---

## Chunk 2: VoicePipeline 并行管道

### Task 3: TTSService 新增 generateVoiceBlob 方法

**Files:**
- Modify: `src/services/tts/tts-service.ts`

- [ ] **Step 1: 在 TTSService 中添加 generateVoiceBlob 方法**

在 `src/services/tts/tts-service.ts` 中，`destroy()` 方法之前添加：

```typescript
/**
 * 非流式合成语音音频（用于语音对话气泡）
 * 返回完整的 WAV ArrayBuffer 和时长（秒）
 */
async generateVoiceBlob(
    content: string,
    userQuestion?: string,
    context?: TTSContext,
): Promise<{ audioBuffer: ArrayBuffer; duration: number }> {
    const summary = await this.summarizer.summarize(content, userQuestion, context);
    const audioBuffer = await this.client.synthesize(summary);
    // WAV 16bit mono 24000Hz: duration = byteCount / (sampleRate * bytesPerSample)
    const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
    return { audioBuffer, duration };
}

/**
 * 直接合成原文朗读（用于信封展开后的喇叭按钮，不经过 Summarizer）
 */
async synthesizeRawText(text: string): Promise<{ audioBuffer: ArrayBuffer; duration: number }> {
    const audioBuffer = await this.client.synthesize(text);
    const duration = (audioBuffer.byteLength - 44) / (24000 * 2);
    return { audioBuffer, duration };
}
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: Commit**

```bash
git add src/services/tts/tts-service.ts
git commit -m "feat(voice-reply): TTSService 新增 generateVoiceBlob 和 synthesizeRawText"
```

---

### Task 4: processGraphStream 中启动并行 VoicePipeline

**Files:**
- Modify: `src/agent/index.ts` (第 517-567 行 processGraphStream)

- [ ] **Step 1: 在 processGraphStream 中检测 analysisResult 并启动 VoicePipeline**

在 `src/agent/index.ts` 的 `processGraphStream` 方法中，找到处理 `stateUpdate` 的循环。在检测 `formattedOutput` 的代码块（约第 555 行）之前，添加 analysisResult 检测和 VoicePipeline 启动逻辑：

```typescript
// 在 processGraphStream 方法体顶部添加变量
let voicePipelineStarted = false;

// 在 for-await 循环中，处理 stateUpdate 时，formattedOutput 检测之前：
// 启动 VoicePipeline（语音对话并行生成）
if (stateUpdate.analysisResult && !voicePipelineStarted && callbacks.onVoiceReady) {
    voicePipelineStarted = true;
    // 异步启动，不阻塞主流程
    this.startVoicePipeline(stateUpdate.analysisResult, callbacks, {
        userQuestion: stateUpdate.rewrittenQuery,
        bookTitle: stateUpdate.pdfName,
        context: config?.configurable?.sharedContext,
    }).catch(err => {
        console.warn('[VoicePipeline] failed, silencing:', err);
    });
}
```

- [ ] **Step 2: 在 FrontendAgent 类中添加 startVoicePipeline 方法**

```typescript
private async startVoicePipeline(
    analysisResult: string,
    callbacks: AgentLoopOptions,
    options: {
        userQuestion?: string;
        bookTitle?: string;
        context?: any;
    },
): Promise<void> {
    const { TTSClient } = await import('../services/tts/tts-client.js');
    const { TTSSummarizer } = await import('../services/tts/tts-summarizer.js');

    const ttsConfig = this.config?.ttsConfig;
    if (!ttsConfig) return;

    const summarizer = new TTSSummarizer({
        apiKey: ttsConfig.apiKey,
        baseUrl: ttsConfig.baseUrl,
        model: ttsConfig.model,
    });

    const client = new TTSClient({
        apiKey: ttsConfig.apiKey,
        baseUrl: ttsConfig.baseUrl,
    });

    // 收集完整摘要文本
    let summary = '';
    for await (const delta of summarizer.summarizeStream(
        analysisResult,
        options.userQuestion,
        {
            bookTitle: options.bookTitle,
            memoryContent: options.context?.memoryContext,
        },
    )) {
        summary += delta;
    }

    if (!summary.trim()) return;

    // 非流式合成完整音频
    const audioBuffer = await client.synthesize(summary);
    const duration = (audioBuffer.byteLength - 44) / (24000 * 2);

    callbacks.onVoiceReady?.({ audioBuffer, duration });
}
```

注意：`this.config?.ttsConfig` 需要在 `FrontendAgent` 构造函数或 `runGraphEngine` 中从 settings 读取并缓存。具体实现方式：在 `runGraphEngine` 方法中从 `callbacks` 的 configurable 上下文中获取 TTS 配置，或通过新增参数传入。

实际实现时需要：
1. 在 `runGraphEngine` 的参数或 configurable 中传入 tts 配置（apiKey、baseUrl、model）
2. 将配置暂存到 `this.config` 或直接传入 `startVoicePipeline`

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 成功

- [ ] **Step 4: Commit**

```bash
git add src/agent/index.ts
git commit -m "feat(voice-reply): processGraphStream 中启动并行 VoicePipeline"
```

---

## Chunk 3: UI — 信封和语音气泡

### Task 5: 信封 CSS 样式

**Files:**
- Modify: `src/components/message/message.css`

- [ ] **Step 1: 在 message.css 末尾添加信封样式**

```css
/* ====== 信封样式（语音书信回复模式） ====== */

/* 信封外壳 */
.deeppdf-letter-envelope {
    position: relative;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 24px 16px 12px;
    margin-top: 6px;
    overflow: hidden;
}

/* 信封顶部翻盖装饰 */
.deeppdf-letter-envelope::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
    background: var(--background-primary);
    border-bottom: 1px solid var(--background-modifier-border);
    clip-path: polygon(0 0, 50% 100%, 100% 0);
    opacity: 0.6;
}

/* "奚童 来信" 标签 */
.deeppdf-letter-label {
    text-align: center;
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
    margin: 8px 0;
}

/* 墨水书写区域 */
.deeppdf-letter-ink {
    font-family: 'Noto Serif SC', 'Source Han Serif SC', Georgia, serif;
    font-size: 13px;
    line-height: 2.0;
    color: var(--text-normal);
    min-height: 80px;
    max-height: 160px;
    overflow: hidden;
}

/* 书写光标 */
.deeppdf-letter-cursor {
    display: inline-block;
    width: 2px;
    height: 14px;
    background: var(--text-normal);
    vertical-align: middle;
    margin-left: 1px;
    animation: deeppdf-cursor-blink 0.8s infinite;
}

@keyframes deeppdf-cursor-blink {
    0%, 45% { opacity: 1; }
    50%, 100% { opacity: 0; }
}

/* 拆信按钮 */
.deeppdf-letter-open-btn {
    display: block;
    margin: 8px auto 0;
    padding: 4px 16px;
    font-size: 12px;
    color: var(--text-muted);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
}

.deeppdf-letter-open-btn:hover {
    color: var(--interactive-accent);
    border-color: var(--interactive-accent);
}

/* ====== 语音气泡样式 ====== */

.deeppdf-voice-bubble {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: var(--interactive-accent);
    color: var(--text-on-accent);
    border-radius: 4px 16px 16px 16px;
    max-width: 65%;
    margin-bottom: 4px;
    cursor: pointer;
    transition: opacity 0.2s;
}

.deeppdf-voice-bubble:hover {
    opacity: 0.9;
}

/* 播放按钮 */
.deeppdf-voice-play-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    flex-shrink: 0;
}

/* 音波条 */
.deeppdf-voice-bars {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 3px;
    height: 20px;
}

.deeppdf-voice-bar {
    width: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.5);
    transition: height 0.15s;
}

.deeppdf-voice-bubble.playing .deeppdf-voice-bar {
    animation: deeppdf-bar-pulse 0.6s ease-in-out infinite alternate;
}

@keyframes deeppdf-bar-pulse {
    0% { height: 6px; background: rgba(255, 255, 255, 0.4); }
    100% { height: 16px; background: rgba(255, 255, 255, 0.8); }
}

/* 时长 */
.deeppdf-voice-duration {
    font-size: 12px;
    opacity: 0.8;
    flex-shrink: 0;
}

/* 语音 loading 占位 */
.deeppdf-voice-loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px 16px 16px 16px;
    max-width: 65%;
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--text-muted);
}

/* 书信展开状态（收起按钮） */
.deeppdf-letter-collapse-btn {
    text-align: right;
    font-size: 11px;
    color: var(--text-muted);
    cursor: pointer;
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--background-modifier-border);
}

.deeppdf-letter-collapse-btn:hover {
    color: var(--interactive-accent);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/message/message.css
git commit -m "feat(voice-reply): 信封和语音气泡 CSS 样式"
```

---

### Task 6: AIMessage 组件渲染逻辑

**Files:**
- Modify: `src/components/message/message.ts`

这是最大的一个 task。需要修改 AIMessage 的 `render`、`update` 方法，新增信封和语音气泡的渲染逻辑。

- [ ] **Step 1: 在 AIMessage 类中新增状态字段**

在 `src/components/message/message.ts` 的 `AIMessage` 类中（约第 934 行 `isCollapsed` 附近），添加：

```typescript
private letterState: 'sealing' | 'sealed' | 'opened' = 'sealing';
private voiceState: 'loading' | 'ready' | 'playing' | 'paused' | 'ended' = 'loading';
private voiceAudio: ArrayBuffer | null = null;
private voiceDuration: number = 0;
private voiceAudioEl: HTMLAudioElement | null = null;
private enableVoiceReply: boolean = false;
```

- [ ] **Step 2: 修改构造函数接收新字段**

在 `AIMessage` 构造函数中（读取 `data.collapsed` 的位置附近），读取新字段：

```typescript
this.enableVoiceReply = data.enableVoiceReply ?? false;
if (data.voiceAudio) {
    this.voiceAudio = data.voiceAudio;
    this.voiceState = 'ready';
}
if (data.voiceDuration) {
    this.voiceDuration = data.voiceDuration;
}
if (data.letterState) {
    this.letterState = data.letterState;
}
```

- [ ] **Step 3: 新增 renderVoiceBubble 方法**

在 AIMessage 类中添加语音气泡渲染方法：

```typescript
private renderVoiceBubble(container: HTMLElement): void {
    if (!this.enableVoiceReply) return;
    if (this.voiceState === 'loading') {
        // loading 占位
        const loading = container.createDiv({ cls: 'deeppdf-voice-loading' });
        loading.textContent = '正在生成语音...';
        return;
    }

    const bubble = container.createDiv({ cls: 'deeppdf-voice-bubble' });
    if (this.voiceState === 'playing') bubble.addClass('playing');

    const playBtn = bubble.createDiv({ cls: 'deeppdf-voice-play-btn' });
    playBtn.textContent = (this.voiceState === 'playing') ? '⏸' : '▶';

    const bars = bubble.createDiv({ cls: 'deeppdf-voice-bars' });
    for (let i = 0; i < 8; i++) {
        const bar = bars.createDiv({ cls: 'deeppdf-voice-bar' });
        bar.style.height = `${6 + Math.random() * 10}px`;
    }

    const duration = bubble.createDiv({ cls: 'deeppdf-voice-duration' });
    const min = Math.floor(this.voiceDuration / 60);
    const sec = Math.floor(this.voiceDuration % 60);
    duration.textContent = `${min}:${sec.toString().padStart(2, '0')}`;

    bubble.addEventListener('click', () => {
        this.toggleVoicePlayback();
    });
}
```

- [ ] **Step 4: 新增 renderLetterEnvelope 方法**

```typescript
private renderLetterEnvelope(container: HTMLElement, content: string): void {
    if (!this.enableVoiceReply) return;

    if (this.letterState === 'opened') {
        // 展开状态：渲染完整内容 + 收起按钮
        const contentEl = container.createDiv({ cls: 'deeppdf-message-content' });
        // 渲染 Markdown（复用现有逻辑）
        // ... 并添加收起按钮
        const collapseBtn = container.createDiv({ cls: 'deeppdf-letter-collapse-btn' });
        collapseBtn.textContent = '收起 ↩';
        collapseBtn.addEventListener('click', () => {
            this.letterState = 'sealed';
            this.requestRerender();
        });
        return;
    }

    // 信封状态
    const envelope = container.createDiv({ cls: 'deeppdf-letter-envelope' });
    envelope.createDiv({ cls: 'deeppdf-letter-label' }).textContent = '奚童 来信';

    const ink = envelope.createDiv({ cls: 'deeppdf-letter-ink' });

    // 提取前几行文字做预览（墨水书写效果）
    const lines = content.split('\n').filter(l => l.trim());
    const displayLines = this.letterState === 'sealing' ? lines.slice(0, 4) : lines;
    for (let i = 0; i < displayLines.length; i++) {
        const lineEl = ink.createDiv();
        lineEl.textContent = displayLines[i].slice(0, 30) + '...';
    }

    // 书写光标（sealing 状态）
    if (this.letterState === 'sealing') {
        const cursor = ink.createSpan({ cls: 'deeppdf-letter-cursor' });
    }

    // 拆信按钮（sealed 状态）
    if (this.letterState === 'sealed') {
        const openBtn = envelope.createDiv({ cls: 'deeppdf-letter-open-btn' });
        openBtn.textContent = '✉ 拆开信封';
        openBtn.addEventListener('click', () => {
            this.letterState = 'opened';
            this.requestRerender();
        });
    }

    // sealing 状态点击也可以拆信
    if (this.letterState === 'sealing') {
        envelope.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.deeppdf-letter-open-btn')) return;
            this.letterState = 'opened';
            this.requestRerender();
        });
        envelope.style.cursor = 'pointer';
    }
}
```

- [ ] **Step 5: 新增语音播放控制方法**

```typescript
private toggleVoicePlayback(): void {
    if (!this.voiceAudio) return;

    if (this.voiceState === 'playing') {
        this.voiceAudioEl?.pause();
        this.voiceState = 'paused';
    } else {
        if (!this.voiceAudioEl) {
            const blob = new Blob([this.voiceAudio], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            this.voiceAudioEl = new Audio(url);
            this.voiceAudioEl.onended = () => {
                this.voiceState = 'ended';
                this.requestRerender();
            };
        }
        this.voiceAudioEl.play();
        this.voiceState = 'playing';
    }
    this.requestRerender();
}
```

- [ ] **Step 6: 修改 render 方法，集成语音气泡和信封**

在 `AIMessage` 的 `render` 方法中，当 `enableVoiceReply` 为 true 时：
1. 在 header 之后、content 之前插入 `renderVoiceBubble`
2. 将原来的 content 渲染替换为 `renderLetterEnvelope`

具体修改位置：render 方法中创建 `.deeppdf-message-content` div 的位置（约第 1050 行）。当 `enableVoiceReply` 为 true 时，改为调用 `renderLetterEnvelope`，同时在前面插入 `renderVoiceBubble`。

注意：展开状态（opened）下的 action 按钮区域保留喇叭按钮（复用现有 TTS 按钮，功能改为朗读原文）。喇叭按钮和语音气泡互斥：点击喇叭时先暂停语音气泡播放。

- [ ] **Step 7: 新增 updateVoiceData 方法**

用于 sidebar-view 在 VoicePipeline 完成后更新消息的语音数据：

```typescript
updateVoiceData(data: { audioBuffer: ArrayBuffer; duration: number }): void {
    this.voiceAudio = data.audioBuffer;
    this.voiceDuration = data.duration;
    this.voiceState = 'ready';
    this.requestRerender();
}
```

- [ ] **Step 8: 构建验证**

Run: `npm run build`
Expected: 成功

- [ ] **Step 9: Commit**

```bash
git add src/components/message/message.ts src/components/message/message.css
git commit -m "feat(voice-reply): AIMessage 信封和语音气泡渲染逻辑"
```

---

## Chunk 4: 侧边栏集成

### Task 7: sidebar-view 集成 VoicePipeline 和消息更新

**Files:**
- Modify: `src/views/sidebar-view.ts`

- [ ] **Step 1: 在 handleAgentQuery 中传入 enableVoiceReply 到消息数据**

在 `handleAgentQuery` 中创建 AI 消息时（约第 2300 行 `addMessage` 调用），添加 `enableVoiceReply` 字段：

```typescript
this.messageList?.addMessage({
    id: aiMessageId,
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
    isStreaming: true,
    isAgentMessage: true,
    enableVoiceReply: this.plugin.settings.enableVoiceReply && !!resolveRoleConfig('tts', this.plugin.settings),
});
```

- [ ] **Step 2: 在 callbacks 中新增 onVoiceReady**

在 `handleAgentQuery` 的 callbacks 对象中（约第 2270 行），添加 `onVoiceReady` 回调：

```typescript
onVoiceReady: (data: { audioBuffer: ArrayBuffer; duration: number }) => {
    if (this.messageList) {
        const msg = this.messageList.getMessagesData().find(m => m.id === aiMessageId);
        if (msg) {
            this.messageList.updateMessage(aiMessageId, {
                voiceAudio: data.audioBuffer,
                voiceDuration: data.duration,
                voiceState: 'ready',
            });
        }
    }
},
```

注意：需要检查 `MessageList.updateMessage` 是否支持传递 `voiceAudio` 等新字段到 `AIMessage.update`。如果 update 方法不处理这些字段，需要添加一个 `updateVoiceData` 调用路径。

实际实现方式：在 `MessageList` 中新增 `updateVoiceData(messageId, data)` 方法，直接调用 message 实例的 `updateVoiceData`。

- [ ] **Step 3: 在 onComplete 中更新信封状态为 sealed**

在 `onComplete` 回调中（约第 2379 行），当 `enableVoiceReply` 为 true 时，更新信封状态：

```typescript
onComplete: async () => {
    this.messageList?.updateMessage(aiMessageId, {
        isStreaming: false,
        timestamp: new Date().toISOString(),
    });

    // 信封书写完成
    if (this.plugin.settings.enableVoiceReply) {
        this.messageList?.updateMessage(aiMessageId, {
            letterState: 'sealed',
        });
    }

    // ... 现有的 autoTTS 逻辑改为喇叭朗读原文 ...
```

- [ ] **Step 4: 修改 autoTTS 逻辑为喇叭朗读原文**

在 `onComplete` 中，将 `autoTTS` 触发的 `ttsService.play()` 改为喇叭朗读原文的逻辑（直接合成 formattedOutput，不经过 Summarizer）。在信封展开后，用户点击喇叭按钮触发。

原有的 `autoTTS` 行为（自动播放语音摘要）在 `enableVoiceReply` 模式下不再适用，因为语音是 VoicePipeline 并行生成的，不需要 onComplete 时再生成。

```typescript
// 修改 onComplete 中的 autoTTS 逻辑
if (this.plugin.settings.autoTTS && !this.plugin.settings.enableVoiceReply) {
    // 仅在非语音书信模式下保留原有自动播放逻辑
    // ... 现有代码不变 ...
}
```

- [ ] **Step 5: 喇叭按钮回调（朗读原文）**

在 `onTTS` 回调中，当 `enableVoiceReply` 为 true 时，改为使用 `synthesizeRawText` 直接合成原文：

```typescript
onTTS: async (messageId: string, content: string) => {
    if (this.plugin.settings.enableVoiceReply) {
        // 朗读原文模式（不摘要，带奚童人设）
        if (!this.ttsService) {
            this.ttsService = this.initTTSService();
        }
        if (this.ttsService) {
            await this.ttsService.play(messageId, content);
        }
    } else {
        this.handleTTS(messageId, content);
    }
},
```

注意：这里的 `play` 需要支持直接合成原文（不经过 Summarizer）。可以在 TTSService 中新增 `playRawText(messageId, text)` 方法，直接调用 `client.synthesize()` 生成音频后播放。

- [ ] **Step 6: 在 runGraphEngine 调用中传入 TTS 配置**

在 `handleAgentQuery` 中调用 `this.frontendAgent.runGraphEngine()` 的位置，将 TTS 配置传入 configurable，使 `processGraphStream` 可以访问到 TTS 配置来启动 VoicePipeline。

具体方式：在 `callbacks` 的 `configurable` 中添加 `ttsConfig`：

```typescript
// 在 runGraphEngine 的 configurable 对象中
configurable: {
    // ... 现有字段 ...
    ttsConfig: this.plugin.settings.enableVoiceReply ? (() => {
        const cfg = resolveRoleConfig('tts', this.plugin.settings);
        return cfg ? { apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model } : undefined;
    })() : undefined,
}
```

- [ ] **Step 7: 构建验证**

Run: `npm run build`
Expected: 成功

- [ ] **Step 8: Commit**

```bash
git add src/views/sidebar-view.ts
git commit -m "feat(voice-reply): sidebar-view 集成 VoicePipeline 和语音数据传递"
```

---

## Chunk 5: 端到端集成测试

### Task 8: 构建部署测试

- [ ] **Step 1: 构建**

Run: `cd /Users/lizhao/workspace/DeepReader/.claude/worktrees/feat+tts-voice-summary && npm run build`
Expected: 成功

- [ ] **Step 2: 部署到 test-vault**

Run: `npm run deploy`
Expected: 成功复制到 test-vault

- [ ] **Step 3: 手动测试清单**

在 Obsidian 中测试以下场景：

1. **设置关闭状态**：`enableVoiceReply = false` → AI 回复应和原来一样（纯文字气泡）
2. **设置开启**：`enableVoiceReply = true` + 配置了 tts role → AI 回复应显示语音气泡 + 信封
3. **墨水动画**：AI 回复流式输出时，信封内文字逐行出现
4. **拆信**：点击信封 → 展开完整内容。点击收起 → 回到信封
5. **提前拆信**：墨水书写中点击信封 → 立即展开已生成的内容
6. **语音气泡**：VoicePipeline 完成后气泡出现，点击播放/暂停
7. **喇叭朗读**：信封展开后点击喇叭按钮 → 朗读完整原文
8. **互斥**：播放语音气泡时点喇叭 → 气泡暂停，切换到朗读
9. **降级**：TTS 配置错误 → 不显示语音气泡，只显示信封
10. **取消**：AI 生成中途取消 → 信封停留在 sealing 状态

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(voice-reply): 端到端集成完成"
```
