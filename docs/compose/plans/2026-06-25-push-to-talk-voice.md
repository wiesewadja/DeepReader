# Push-to-Talk 语音输入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移动端长按输入框启动 Push-to-Talk 语音输入，松手后 ASR 识别 + LLM 重写为书面语，填入输入框。

**Architecture:** 新建 `VoiceRewriter`（LLM 重写）和 `PushToTalkController`（状态机编排），复用现有 `AudioRecorder`/`ASRClient`/`VoiceOverlay`。ChatInput 新增 touch 事件监听，移动端长按触发回调。

**Tech Stack:** TypeScript, MediaRecorder API, MiMo ASR, OpenAI-compatible LLM API, Obsidian Platform API

## Global Constraints

- 移动端用 `Platform.isMobile` 守卫，桌面端不注册 touch 事件
- 复用现有 `AudioRecorder`/`ASRClient`/`VoiceOverlay`，不重复造轮子
- LLM 重写使用 `resolveRoleConfig("chat")` 配置
- ASR 使用 `resolveRoleConfig("tts")` 配置
- 所有异步操作需处理取消/失败路径

---

## Task 1: VoiceRewriter 模块

**Covers:** [S5]

**Files:**
- Create: `src/services/voice-rewriter.ts`
- Test: `tests/unit/services/voice-rewriter.test.ts`

**Interfaces:**
- Consumes: `resolveRoleConfig("chat")` 返回的 `{ apiKey, baseUrl }`
- Produces: `VoiceRewriter.rewrite(rawText, bookContext?) => Promise<string>`

- [ ] **Step 1: 创建 VoiceRewriter 类型定义**

```typescript
// src/services/voice-rewriter.ts
export interface VoiceRewriterConfig {
  apiKey: string;
  baseUrl: string;
}

export interface BookContext {
  title: string;
  description?: string;
}

export class VoiceRewriter {
  private config: VoiceRewriterConfig;

  constructor(config: VoiceRewriterConfig) {
    this.config = config;
  }

  async rewrite(rawText: string, bookContext?: BookContext): Promise<string> {
    const prompt = this.buildPrompt(rawText, bookContext);
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`VoiceRewriter failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  }

  private buildPrompt(rawText: string, bookContext?: BookContext): string {
    const bookInfo = bookContext
      ? `当前书籍：${bookContext.title}。${bookContext.description || ''}\n\n`
      : '';

    return `${bookInfo}你是文本优化助手。将用户口语化的表达转为书面语，保留原意但更正式。

用户语音：${rawText}

请输出优化后的书面语：`;
  }
}
```

- [ ] **Step 2: 编写单元测试**

```typescript
// tests/unit/services/voice-rewriter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceRewriter } from '../../../src/services/voice-rewriter.js';

describe('VoiceRewriter', () => {
  const mockConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://api.test.com/v1',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrite 将口语转为书面语', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '请总结本书的核心观点' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    const result = await rewriter.rewrite('这本书讲的啥');

    expect(result).toBe('请总结本书的核心观点');
    expect(fetch).toHaveBeenCalledWith(
      `${mockConfig.baseUrl}/chat/completions`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': `Bearer ${mockConfig.apiKey}`,
        }),
      })
    );
  });

  it('rewrite 带书籍上下文', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '《深度阅读》的核心观点是...' } }],
      }),
    };
    vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    const result = await rewriter.rewrite('总结一下', {
      title: '深度阅读',
      description: '一本关于阅读方法的书',
    });

    expect(result).toBe('《深度阅读》的核心观点是...');
    const body = JSON.parse((fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('深度阅读');
  });

  it('rewrite 失败时抛出错误', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);

    const rewriter = new VoiceRewriter(mockConfig);
    await expect(rewriter.rewrite('test')).rejects.toThrow('VoiceRewriter failed: 500');
  });
});
```

- [ ] **Step 3: 运行测试验证**

Run: `npx vitest run tests/unit/services/voice-rewriter.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/voice-rewriter.ts tests/unit/services/voice-rewriter.test.ts
git commit -m "feat(voice): add VoiceRewriter for口语→书面语 rewrite"
```

---

## Task 2: PushToTalkController 核心类

**Covers:** [S3, S4]

**Files:**
- Create: `src/services/push-to-talk.ts`
- Test: `tests/unit/services/push-to-talk.test.ts`

**Interfaces:**
- Consumes: `AudioRecorder`, `ASRClient`, `VoiceRewriter`, `ChatInput`
- Produces: `PushToTalkController.start()`, `.stop()`, `.cancel()`

- [ ] **Step 1: 创建状态机和核心控制器**

```typescript
// src/services/push-to-talk.ts
import { AudioRecorder } from './asr/audio-recorder.js';
import { ASRClient } from './asr/asr-client.js';
import { VoiceRewriter, type BookContext } from './voice-rewriter.js';
import type { ChatInput } from '../components/chat-input/chat-input.js';

export type PushToTalkState = 'idle' | 'listening' | 'recognizing' | 'rewriting';

export interface PushToTalkConfig {
  asrApiKey: string;
  asrBaseUrl: string;
  llmApiKey: string;
  llmBaseUrl: string;
  language?: string;
}

export interface PushToTalkCallbacks {
  onStateChange: (state: PushToTalkState) => void;
  onTextReady: (text: string) => void;
  onError: (error: Error) => void;
}

export class PushToTalkController {
  private state: PushToTalkState = 'idle';
  private recorder: AudioRecorder;
  private asrClient: ASRClient;
  private rewriter: VoiceRewriter;
  private chatInput: ChatInput;
  private callbacks: PushToTalkCallbacks;
  private incrementalTimer: ReturnType<typeof setInterval> | null = null;
  private lastIncrementalText = '';
  private config: PushToTalkConfig;

  constructor(
    chatInput: ChatInput,
    config: PushToTalkConfig,
    callbacks: PushToTalkCallbacks,
  ) {
    this.chatInput = chatInput;
    this.config = config;
    this.callbacks = callbacks;
    this.recorder = new AudioRecorder();
    this.asrClient = new ASRClient({
      apiKey: config.asrApiKey,
      baseUrl: config.asrBaseUrl,
    });
    this.rewriter = new VoiceRewriter({
      apiKey: config.llmApiKey,
      baseUrl: config.llmBaseUrl,
    });
  }

  getState(): PushToTalkState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.setState('listening');
    this.lastIncrementalText = '';

    try {
      await this.recorder.start();
      this.chatInput.setVoiceState('recording');
      this.startIncrementalRecognition();
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  async stop(bookContext?: BookContext): Promise<void> {
    if (this.state !== 'listening') return;
    this.stopIncrementalRecognition();
    this.setState('recognizing');
    this.chatInput.setVoiceState('recognizing');

    try {
      const { audioBase64, mimeType } = await this.recorder.stop();
      const finalText = await this.asrClient.transcribe(audioBase64, mimeType, {
        language: this.config.language,
      });

      const textToRewrite = finalText || this.lastIncrementalText;
      if (!textToRewrite) {
        this.reset();
        return;
      }

      this.setState('rewriting');
      this.chatInput.setVoiceState('recognizing');
      const rewritten = await this.rewriter.rewrite(textToRewrite, bookContext);
      this.callbacks.onTextReady(rewritten);
      this.chatInput.setValue(rewritten);
      this.reset();
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  cancel(): void {
    this.stopIncrementalRecognition();
    this.recorder.cancel();
    this.reset();
  }

  destroy(): void {
    this.cancel();
    this.recorder.destroy();
  }

  private setState(state: PushToTalkState): void {
    this.state = state;
    this.callbacks.onStateChange(state);
  }

  private reset(): void {
    this.state = 'idle';
    this.lastIncrementalText = '';
    this.chatInput.setVoiceState('idle');
    this.callbacks.onStateChange('idle');
  }

  private handleError(error: Error): void {
    this.reset();
    this.callbacks.onError(error);
  }

  private startIncrementalRecognition(): void {
    this.incrementalTimer = setInterval(async () => {
      try {
        const { audioBase64, mimeType } = await this.recorder.getAccumulatedAudio();
        const stream = this.asrClient.transcribeStream(audioBase64, mimeType, {
          language: this.config.language,
        });

        let text = '';
        for await (const chunk of stream) {
          text += chunk;
        }

        if (text) {
          this.lastIncrementalText = text;
          this.chatInput.replaceVoiceText(text);
        }
      } catch {
        // 递增识别失败不中断录音
      }
    }, 3000);
  }

  private stopIncrementalRecognition(): void {
    if (this.incrementalTimer) {
      clearInterval(this.incrementalTimer);
      this.incrementalTimer = null;
    }
  }
}
```

- [ ] **Step 2: 编写单元测试**

```typescript
// tests/unit/services/push-to-talk.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PushToTalkController } from '../../../src/services/push-to-talk.js';

// Mock 依赖
vi.mock('../../../src/services/asr/audio-recorder.js', () => ({
  AudioRecorder: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({ audioBase64: 'audio', mimeType: 'audio/wav', duration: 5 }),
    getAccumulatedAudio: vi.fn().mockResolvedValue({ audioBase64: 'audio', mimeType: 'audio/wav' }),
    cancel: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock('../../../src/services/asr/asr-client.js', () => ({
  ASRClient: vi.fn().mockImplementation(() => ({
    transcribe: vi.fn().mockResolvedValue('识别的文字'),
    transcribeStream: vi.fn().mockImplementation(async function* () {
      yield '识别';
      yield '的文字';
    }),
  })),
}));

vi.mock('../../../src/services/voice-rewriter.js', () => ({
  VoiceRewriter: vi.fn().mockImplementation(() => ({
    rewrite: vi.fn().mockResolvedValue('优化后的书面语'),
  })),
}));

describe('PushToTalkController', () => {
  let controller: PushToTalkController;
  let mockChatInput: any;
  let callbacks: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockChatInput = {
      setVoiceState: vi.fn(),
      replaceVoiceText: vi.fn(),
      setValue: vi.fn(),
    };
    callbacks = {
      onStateChange: vi.fn(),
      onTextReady: vi.fn(),
      onError: vi.fn(),
    };
    controller = new PushToTalkController(
      mockChatInput,
      {
        asrApiKey: 'asr-key',
        asrBaseUrl: 'https://asr.test.com',
        llmApiKey: 'llm-key',
        llmBaseUrl: 'https://llm.test.com',
      },
      callbacks,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    controller.destroy();
  });

  it('start 进入 listening 状态并开始录音', async () => {
    await controller.start();
    expect(controller.getState()).toBe('listening');
    expect(mockChatInput.setVoiceState).toHaveBeenCalledWith('recording');
  });

  it('stop 进入 recognizing → rewriting → idle', async () => {
    await controller.start();
    await controller.stop({ title: '测试书籍' });

    expect(controller.getState()).toBe('idle');
    expect(mockChatInput.setValue).toHaveBeenCalledWith('优化后的书面语');
    expect(callbacks.onTextReady).toHaveBeenCalledWith('优化后的书面语');
  });

  it('cancel 取消录音并回到 idle', async () => {
    await controller.start();
    controller.cancel();
    expect(controller.getState()).toBe('idle');
  });

  it('非 idle 状态下 start 无效', async () => {
    await controller.start();
    await controller.start(); // 第二次调用
    expect(controller.getState()).toBe('listening'); // 仍为 listening
  });
});
```

- [ ] **Step 3: 运行测试验证**

Run: `npx vitest run tests/unit/services/push-to-talk.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/push-to-talk.ts tests/unit/services/push-to-talk.test.ts
git commit -m "feat(voice): add PushToTalkController with state machine"
```

---

## Task 3: ChatInput 触摸事件集成

**Covers:** [S6]

**Files:**
- Modify: `src/components/chat-input/chat-input.ts:49-84` (ChatInputOptions)
- Modify: `src/components/chat-input/chat-input.ts:370-467` (attachEventListeners)
- Modify: `src/components/chat-input/chat-input.ts:855-919` (destroy)
- Test: `tests/unit/components/chat-input-touch.test.ts`

**Interfaces:**
- Consumes: `PushToTalkController.start/stop/cancel`（通过回调）
- Produces: `ChatInputOptions.onLongPress` 回调

- [ ] **Step 1: 添加 onLongPress 配置项**

在 `ChatInputOptions` 接口中添加：
```typescript
// src/components/chat-input/chat-input.ts:49-84
export interface ChatInputOptions {
  // ...existing
  /** 长按触发回调（移动端 push-to-talk） */
  onLongPress?: () => void;
}
```

- [ ] **Step 2: 添加触摸事件监听**

在 `attachEventListeners()` 方法末尾添加：
```typescript
// src/components/chat-input/chat-input.ts:465-467
// 移动端长按事件（push-to-talk）
if (this.options.onLongPress) {
  this.setupLongPress();
}
```

新增 `setupLongPress()` 方法：
```typescript
// src/components/chat-input/chat-input.ts (新方法)
private longPressTimer: ReturnType<typeof setTimeout> | null = null;
private longPressStartPos = { x: 0, y: 0 };
private longPressCancelled = false;

private setupLongPress(): void {
  if (!this.textarea) return;

  const LONG_PRESS_THRESHOLD = 500;
  const SWIPE_CANCEL_THRESHOLD = 50;

  this.textarea.addEventListener('touchstart', (e) => {
    this.longPressCancelled = false;
    this.longPressStartPos = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
    this.longPressTimer = setTimeout(() => {
      if (!this.longPressCancelled) {
        e.preventDefault(); // 阻止键盘弹起
        this.options.onLongPress?.();
      }
    }, LONG_PRESS_THRESHOLD);
  }, { passive: false });

  this.textarea.addEventListener('touchmove', (e) => {
    if (this.longPressTimer) {
      const dy = e.touches[0].clientY - this.longPressStartPos.y;
      if (dy < -SWIPE_CANCEL_THRESHOLD) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
        this.longPressCancelled = true;
      }
    }
  }, { passive: true });

  this.textarea.addEventListener('touchend', () => {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }, { passive: true });
}
```

在 `destroy()` 方法中清理：
```typescript
// src/components/chat-input/chat-input.ts:855-919
// 清理长按计时器
if (this.longPressTimer) {
  clearTimeout(this.longPressTimer);
  this.longPressTimer = null;
}
```

- [ ] **Step 3: 编写触摸事件单元测试**

```typescript
// tests/unit/components/chat-input-touch.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatInput } from '../../../src/components/chat-input/chat-input.js';

describe('ChatInput 长按事件', () => {
  let chatInput: ChatInput;
  let onLongPress: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onLongPress = vi.fn();
    chatInput = new ChatInput({
      onSend: vi.fn(),
      onLongPress,
    });
  });

  afterEach(() => {
    chatInput.destroy();
    vi.useRealTimers();
  });

  it('长按 500ms 触发 onLongPress', () => {
    const textarea = chatInput.getElement()?.querySelector('textarea');
    expect(textarea).toBeTruthy();

    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    textarea!.dispatchEvent(touchStart);

    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalled();
  });

  it('短按不触发 onLongPress', () => {
    const textarea = chatInput.getElement()?.querySelector('textarea');
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    textarea!.dispatchEvent(touchStart);

    vi.advanceTimersByTime(300);
    textarea!.dispatchEvent(new TouchEvent('touchend'));
    vi.advanceTimersByTime(200);

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('上滑超过阈值取消长按', () => {
    const textarea = chatInput.getElement()?.querySelector('textarea');
    const touchStart = new TouchEvent('touchstart', {
      touches: [{ clientX: 100, clientY: 100 } as Touch],
    });
    textarea!.dispatchEvent(touchStart);

    vi.advanceTimersByTime(300);
    const touchMove = new TouchEvent('touchmove', {
      touches: [{ clientX: 100, clientY: 40 } as Touch], // 上滑 60px
    });
    textarea!.dispatchEvent(touchMove);

    vi.advanceTimersByTime(200);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 运行测试验证**

Run: `npx vitest run tests/unit/components/chat-input-touch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-input/chat-input.ts tests/unit/components/chat-input-touch.test.ts
git commit -m "feat(voice): add long press touch events to ChatInput"
```

---

## Task 4: Sidebar-view 集成

**Covers:** [S7]

**Files:**
- Modify: `src/views/sidebar/sidebar-view.ts:84` (成员变量)
- Modify: `src/views/sidebar/sidebar-view.ts:1049-1106` (createChatInputSection)
- Modify: `src/views/sidebar/sidebar-view.ts:1277-1344` (onClose)

**Interfaces:**
- Consumes: `PushToTalkController`, `resolveRoleConfig`
- Produces: 移动端长按入口集成

- [ ] **Step 1: 添加成员变量和导入**

```typescript
// src/views/sidebar/sidebar-view.ts:1-52
import { PushToTalkController } from "../../services/push-to-talk.js";

// src/views/sidebar/sidebar-view.ts:84
private pushToTalkCtrl: PushToTalkController | null = null;
```

- [ ] **Step 2: 修改 createChatInputSection 集成 PushToTalkController**

```typescript
// src/views/sidebar/sidebar-view.ts:1049-1106
private createChatInputSection(container: HTMLElement) {
  const section = container.createDiv({ cls: "deeppdf-chat-input-section" });

  const ttsConfig = resolveRoleConfig("tts", this.plugin.settings);
  const chatConfig = resolveRoleConfig("chat", this.plugin.settings);
  const showVoiceButton = !!ttsConfig && !Platform.isMobile; // 移动端隐藏麦克风按钮

  this.chatInput = new ChatInput({
    placeholder: "输入以开始对话...",
    onSend: (message, quotes) => {
      this.agentChatCtrl.sendMessage(message, this.quoteManager.getQuotes());
    },
    app: this.app,
    onStop: () => this.agentChatCtrl.stopGeneration(),
    onHeightChange: (height) => {
      const quotesHeight = this.quotesContainer?.offsetHeight || 0;
      this.messageList?.updateBottomPadding(height, quotesHeight);
    },
    onLoadCurrentDoc: async () => await this.loadCurrentDocument(),
    onUnloadCurrentDoc: async () => await this.unloadCurrentDocument(),
    showVoiceButton,
    onVoiceToggle: showVoiceButton && ttsConfig
      ? () => {
          if (!this.voiceInputCtrl) {
            this.voiceInputCtrl = new VoiceInputController(this.chatInput!, {
              apiKey: ttsConfig.apiKey,
              baseUrl: ttsConfig.baseUrl,
            });
          }
          this.voiceInputCtrl.toggle();
        }
      : undefined,
    // 移动端长按触发 Push-to-Talk
    onLongPress: Platform.isMobile && ttsConfig && chatConfig
      ? () => this.startPushToTalk()
      : undefined,
  });

  // ...existing quotesContainer code...
}
```

- [ ] **Step 3: 添加 startPushToTalk 方法**

```typescript
// src/views/sidebar/sidebar-view.ts (新方法)
private startPushToTalk(): void {
  const ttsConfig = resolveRoleConfig("tts", this.plugin.settings);
  const chatConfig = resolveRoleConfig("chat", this.plugin.settings);
  if (!ttsConfig || !chatConfig || !this.chatInput) return;

  if (!this.pushToTalkCtrl) {
    this.pushToTalkCtrl = new PushToTalkController(
      this.chatInput,
      {
        asrApiKey: ttsConfig.apiKey,
        asrBaseUrl: ttsConfig.baseUrl,
        llmApiKey: chatConfig.apiKey,
        llmBaseUrl: chatConfig.baseUrl,
      },
      {
        onStateChange: (state) => {
          // 状态变化由 ChatInput.setVoiceState 处理
        },
        onTextReady: (text) => {
          // 文本已通过 chatInput.setValue 填入
        },
        onError: (error) => {
          new Notice(`语音输入失败: ${error.message}`);
        },
      },
    );
  }

  // 长按触发时直接 start
  this.pushToTalkCtrl.start();

  // 监听 touchend 触发 stop
  const textarea = this.chatInput.getElement()?.querySelector('textarea');
  if (textarea) {
    const handleTouchEnd = () => {
      textarea.removeEventListener('touchend', handleTouchEnd);
      const bookContext = this.bookMgr.getCurrentBookInfo();
      this.pushToTalkCtrl?.stop(bookContext ? {
        title: bookContext.title || '未知书籍',
        description: bookContext.docDescription || undefined,
      } : undefined);
    };
    textarea.addEventListener('touchend', handleTouchEnd, { once: true });
  }
}
```

- [ ] **Step 4: 在 onClose 中清理**

```typescript
// src/views/sidebar/sidebar-view.ts:1277-1344
async onClose() {
  try {
    // ...existing cleanup...
    
    // 清理 Push-to-Talk 控制器
    if (this.pushToTalkCtrl) {
      this.pushToTalkCtrl.destroy();
      this.pushToTalkCtrl = null;
    }
  } catch (error) {
    logError("[DeepPDF] Error in onClose:", error);
  }
}
```

- [ ] **Step 5: 运行类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/views/sidebar/sidebar-view.ts
git commit -m "feat(voice): integrate PushToTalkController in SidebarView"
```

---

## Task 5: 覆盖层样式微调

**Covers:** [S2]

**Files:**
- Modify: `src/components/chat-input/chat-input.css` (voice-overlay 样式)

**Interfaces:**
- Consumes: 现有 VoiceOverlay CSS 类名
- Produces: 输入框上方轻量浮层样式

- [ ] **Step 1: 添加覆盖层样式**

```css
/* src/components/chat-input/chat-input.css */
.deeppdf-voice-overlay {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 120px;
  background: var(--background-primary);
  border-top: 1px solid var(--background-modifier-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 200;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.1);
}

.deeppdf-voice-overlay .deeppdf-voice-wave {
  margin-bottom: 8px;
}

.deeppdf-voice-overlay .deeppdf-voice-label {
  font-size: var(--font-smallest);
  color: var(--text-muted);
}
```

- [ ] **Step 2: 构建验证 CSS**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/chat-input/chat-input.css
git commit -m "style(voice): add push-to-talk overlay positioning"
```

---

## Task 6: 集成测试

**Covers:** [S2, S3, S4, S5, S6, S7]

**Files:**
- Test: `tests/e2e-light/specs/push-to-talk.spec.mjs`

**Interfaces:**
- Consumes: 完整的 Push-to-Talk 功能
- Produces: 端到端验证

- [ ] **Step 1: 编写 E2E 测试**

```javascript
// tests/e2e-light/specs/push-to-talk.spec.mjs
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Push-to-Talk 语音输入', () => {
  beforeAll(async () => {
    // 部署插件到 test-vault
    await exec('npm run deploy');
  });

  afterAll(async () => {
    // 清理
  });

  it('移动端长按输入框显示覆盖层', async () => {
    // 模拟移动端环境
    // 长按输入框 500ms
    // 验证覆盖层显示
  });

  it('松手后触发 ASR 识别', async () => {
    // 模拟录音完成
    // 验证进入 recognizing 状态
  });

  it('识别完成后触发 LLM 重写', async () => {
    // 模拟 ASR 返回文本
    // 验证进入 rewriting 状态
  });

  it('重写文本填入输入框', async () => {
    // 模拟 LLM 返回重写文本
    // 验证输入框内容更新
  });

  it('上滑取消录音', async () => {
    // 长按后上滑
    // 验证覆盖层关闭，输入框为空
  });
});
```

- [ ] **Step 2: 运行 E2E 测试**

Run: `npm run e2e-light`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e-light/specs/push-to-talk.spec.mjs
git commit -m "test(voice): add push-to-talk E2E tests"
```
