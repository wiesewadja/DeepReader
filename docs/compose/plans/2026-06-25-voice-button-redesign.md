# 语音按钮交互重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 合并语音按钮和发送按钮为一个动态按钮，点击语音按钮后输入框区域切换为语音录制界面，PC 和移动端统一交互。

**Architecture:** 移除独立 voiceButton 和长按功能，sendButton 根据状态动态切换图标（mic/send/stop），VoiceOverlay 升级为输入框区域替换模式。

**Tech Stack:** TypeScript, CSS, VoiceOverlay, PushToTalkController

## Global Constraints

- PC 和移动端使用完全相同的交互（按钮位置、录制界面、交互流程）
- 移动端额外支持长按输入框触发语音输入（与点击语音按钮功能相同）
- 复用现有 PushToTalkController、AudioRecorder、ASRClient、VoiceRewriter
- 无平台特定差异（除移动端长按外）

---

## Task 1: 移除旧语音按钮和长按功能

**Covers:** [S3]

**Files:**
- Modify: `src/components/chat-input/chat-input.ts` (移除 voiceButton 相关代码)
- Modify: `src/views/sidebar/sidebar-view.ts` (移除 onVoiceToggle、onLongPress 相关代码)

**Interfaces:**
- Consumes: 无
- Produces: 清理后的 ChatInput 接口（无 voiceButton、无 longPress）

- [ ] **Step 1: 从 ChatInput 移除 voiceButton 创建**

```typescript
// src/components/chat-input/chat-input.ts:338-345
// 删除以下代码块
if (this.options.showVoiceButton && this.options.onVoiceToggle) {
  this.voiceButton = leftToolbar.createEl('button', {
    cls: 'deeppdf-voice-btn'
  });
  this.voiceButton.innerHTML = Icons.mic;
  this.voiceButton.setAttribute('aria-label', '语音输入');
  this.voiceButton.type = 'button';
}
```

- [ ] **Step 2: 从 ChatInput 移除 voiceButton 事件绑定**

```typescript
// src/components/chat-input/chat-input.ts:434-439
// 删除以下代码块
if (this.voiceButton && this.options.onVoiceToggle) {
  this.voiceClickHandler = () => {
    this.options.onVoiceToggle!();
  };
  this.voiceButton.addEventListener('click', this.voiceClickHandler);
}
```

- [ ] **Step 3: 从 ChatInput 移除 voiceButton 销毁**

```typescript
// src/components/chat-input/chat-input.ts:952-955
// 删除以下代码块
if (this.voiceButton && this.voiceClickHandler) {
  this.voiceButton.removeEventListener('click', this.voiceClickHandler);
  this.voiceClickHandler = null;
}
```

- [ ] **Step 4: 从 ChatInput 移除长按相关代码**

删除以下内容：
- `longPressTimer`, `longPressStartPos`, `longPressCancelled`, `longPressTriggered` 属性
- `setupLongPress()` 方法
- `attachEventListeners()` 中调用 `setupLongPress()` 的代码
- `destroy()` 中清理 `longPressTimer` 的代码

- [ ] **Step 5: 从 ChatInputOptions 移除旧配置项**

删除以下配置项：
- `showVoiceButton`
- `onVoiceToggle`
- `onLongPress`
- `onLongPressCancel`

- [ ] **Step 6: 从 SidebarView 移除旧集成代码**

```typescript
// src/views/sidebar/sidebar-view.ts:1066
// 修改 showVoiceButton 计算
const showVoiceButton = false; // 临时禁用，后续 Task 4 会重新集成

// src/views/sidebar/sidebar-view.ts:1090-1109
// 移除 onVoiceToggle、onLongPress、onLongPressCancel 回调
```

- [ ] **Step 7: 运行类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/components/chat-input/chat-input.ts src/views/sidebar/sidebar-view.ts
git commit -m "refactor(voice): remove legacy voice button and long press"
```

---

## Task 2: 合并按钮为动态切换

**Covers:** [S4]

**Files:**
- Modify: `src/components/chat-input/chat-input.ts` (sendButton 动态切换逻辑)

**Interfaces:**
- Consumes: `VoiceState` 类型
- Produces: `sendButton` 图标动态切换

- [ ] **Step 1: 修改 updateSendButtonState 逻辑**

```typescript
// src/components/chat-input/chat-input.ts
private updateSendButtonState(): void {
  if (!this.sendButton) return;

  // 录音/识别中 → 显示停止按钮
  if (this.voiceState === 'recording' || this.voiceState === 'recognizing') {
    this.sendButton.innerHTML = Icons.stop || '⏹';
    this.sendButton.setAttribute('aria-label', '停止录音');
    this.sendButton.disabled = false;
    return;
  }

  // 流式输出中 → 显示停止按钮（保持现有逻辑）
  if (this.isStreaming) {
    this.sendButton.innerHTML = Icons.stop || '⏹';
    this.sendButton.setAttribute('aria-label', '停止生成');
    this.sendButton.disabled = false;
    return;
  }

  // 有内容 → 显示发送按钮
  const value = this.getValue().trim();
  const hasContent = value.length > 0 || this.quotes.length > 0;

  if (hasContent) {
    this.sendButton.innerHTML = Icons.send;
    this.sendButton.setAttribute('aria-label', '发送消息');
    this.sendButton.disabled = false;
  } else {
    // 无内容 → 显示麦克风按钮
    this.sendButton.innerHTML = Icons.mic;
    this.sendButton.setAttribute('aria-label', '语音输入');
    this.sendButton.disabled = false;
  }
}
```

- [ ] **Step 2: 修改 clickHandler 逻辑**

```typescript
// src/components/chat-input/chat-input.ts
this.clickHandler = () => {
  // 录音/识别中 → 停止录音
  if (this.voiceState === 'recording' || this.voiceState === 'recognizing') {
    this.options.onVoiceStop?.();
    return;
  }

  // 流式输出中 → 停止生成
  if (this.isStreaming) {
    this.options.onStop?.();
    return;
  }

  // 有内容 → 发送消息
  const value = this.getValue().trim();
  const hasContent = value.length > 0 || this.quotes.length > 0;

  if (hasContent) {
    this.handleSend();
  } else {
    // 无内容 → 开始录音
    this.options.onVoiceStart?.();
  }
};
```

- [ ] **Step 3: 添加新的回调配置项**

```typescript
// src/components/chat-input/chat-input.ts
export interface ChatInputOptions {
  // ...existing
  /** 开始录音回调（点击麦克风按钮或移动端长按） */
  onVoiceStart?: () => void;
  /** 停止录音回调（点击停止按钮） */
  onVoiceStop?: () => void;
}
```

- [ ] **Step 4: 在 setVoiceState 中调用 updateSendButtonState**

```typescript
// src/components/chat-input/chat-input.ts
setVoiceState(state: VoiceState): void {
  this.voiceState = state;
  // ...existing overlay logic
  this.updateSendButtonState(); // 添加这行
}
```

- [ ] **Step 5: 在 input 事件中调用 updateSendButtonState**

确保 textarea 输入时按钮状态更新。

- [ ] **Step 6: 运行类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/chat-input/chat-input.ts
git commit -m "feat(voice): merge voice and send buttons with dynamic icon"
```

---

## Task 3: 升级 VoiceOverlay 为录制界面

**Covers:** [S5]

**Files:**
- Rewrite: `src/components/chat-input/voice-overlay.ts`
- Modify: `src/components/chat-input/chat-input.css`

**Interfaces:**
- Consumes: `onVoiceStop`, `onVoiceSend` 回调
- Produces: 全屏录制界面（波形+停止+发送）

- [ ] **Step 1: 重写 VoiceOverlay 为录制界面**

```typescript
// src/components/chat-input/voice-overlay.ts
export interface VoiceOverlayCallbacks {
  onStop: () => void;
  onSend: () => void;
}

export class VoiceOverlay {
  private inputArea: HTMLElement;
  private current: HTMLElement | null = null;
  private callbacks: VoiceOverlayCallbacks;

  constructor(inputArea: HTMLElement, callbacks: VoiceOverlayCallbacks) {
    this.inputArea = inputArea;
    this.callbacks = callbacks;
  }

  showRecording(): void {
    this.remove();

    // 隐藏 textarea
    this.inputArea.style.display = 'none';

    // 创建录制界面
    this.current = this.inputArea.parentElement!.createDiv({
      cls: 'deeppdf-voice-recording-panel',
    });

    // 停止按钮
    const stopBtn = this.current.createEl('button', {
      cls: 'deeppdf-voice-stop-btn',
    });
    stopBtn.innerHTML = '✕';
    stopBtn.setAttribute('aria-label', '停止录音');
    stopBtn.addEventListener('click', () => this.callbacks.onStop());

    // 波形动画
    const wave = this.current.createDiv({
      cls: 'deeppdf-voice-wave',
    });
    for (let i = 0; i < 5; i++) {
      wave.createSpan();
    }

    // 发送按钮
    const sendBtn = this.current.createEl('button', {
      cls: 'deeppdf-voice-send-btn',
    });
    sendBtn.innerHTML = '↑';
    sendBtn.setAttribute('aria-label', '发送语音');
    sendBtn.addEventListener('click', () => this.callbacks.onSend());
  }

  remove(): void {
    if (this.current) {
      this.current.remove();
      this.current = null;
      // 恢复 textarea
      this.inputArea.style.display = '';
    }
  }
}
```

- [ ] **Step 2: 添加录制界面样式**

```css
/* src/components/chat-input/chat-input.css */
.deeppdf-voice-recording-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: 12px;
  margin: 1px 10px 3px 4px;
}

.deeppdf-voice-stop-btn,
.deeppdf-voice-send-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: var(--background-modifier-border);
  color: var(--text-normal);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.deeppdf-voice-stop-btn:hover {
  background: var(--background-modifier-hover);
}

.deeppdf-voice-send-btn {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}

.deeppdf-voice-send-btn:hover {
  opacity: 0.9;
}

.deeppdf-voice-wave {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
}

.deeppdf-voice-wave span {
  width: 4px;
  height: 20px;
  background: var(--interactive-accent);
  border-radius: 2px;
  animation: deeppdf-wave 1s ease-in-out infinite;
}

.deeppdf-voice-wave span:nth-child(1) { animation-delay: 0s; }
.deeppdf-voice-wave span:nth-child(2) { animation-delay: 0.1s; }
.deeppdf-voice-wave span:nth-child(3) { animation-delay: 0.2s; }
.deeppdf-voice-wave span:nth-child(4) { animation-delay: 0.3s; }
.deeppdf-voice-wave span:nth-child(5) { animation-delay: 0.4s; }

@keyframes deeppdf-wave {
  0%, 100% { height: 20px; }
  50% { height: 40px; }
}
```

- [ ] **Step 3: 修改 ChatInput 以使用新的 VoiceOverlay**

```typescript
// src/components/chat-input/chat-input.ts
private showRecordingPanel(): void {
  if (!this.inputContainer) return;

  if (!this.voiceOverlay) {
    this.voiceOverlay = new VoiceOverlay(
      this.inputContainer.querySelector('.deeppdf-input-area')!,
      {
        onStop: () => this.options.onVoiceStop?.(),
        onSend: () => {
          // 停止录音并直接发送
          this.options.onVoiceStop?.();
          // 标记为直接发送
          this.pendingVoiceSend = true;
        },
      }
    );
  }

  this.voiceOverlay.showRecording();
  this.inputContainer.addClass('deeppdf-voice-active');
}

private removeRecordingPanel(): void {
  this.voiceOverlay?.remove();
  this.inputContainer?.removeClass('deeppdf-voice-active');
  this.pendingVoiceSend = false;
}
```

- [ ] **Step 4: 运行类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-input/voice-overlay.ts src/components/chat-input/chat-input.css src/components/chat-input/chat-input.ts
git commit -m "feat(voice): upgrade VoiceOverlay to recording panel"
```

---

## Task 4: 适配 Sidebar-view

**Covers:** [S6]

**Files:**
- Modify: `src/views/sidebar/sidebar-view.ts` (适配新的按钮逻辑)

**Interfaces:**
- Consumes: `onVoiceStart`, `onVoiceStop` 回调
- Produces: PushToTalkController 集成

- [ ] **Step 1: 修改 ChatInput 实例化**

```typescript
// src/views/sidebar/sidebar-view.ts
this.chatInput = new ChatInput({
  // ...existing
  onVoiceStart: ttsConfig && chatConfig
    ? () => this.startVoiceRecording()
    : undefined,
  onVoiceStop: ttsConfig && chatConfig
    ? () => this.stopVoiceRecording()
    : undefined,
});
```

- [ ] **Step 2: 添加 startVoiceRecording 方法**

```typescript
// src/views/sidebar/sidebar-view.ts
private startVoiceRecording(): void {
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

  this.pushToTalkCtrl.start();
}
```

- [ ] **Step 3: 添加 stopVoiceRecording 方法**

```typescript
// src/views/sidebar/sidebar-view.ts
private stopVoiceRecording(sendDirectly = false): void {
  if (!this.pushToTalkCtrl) return;

  const bookContext = this.bookMgr.getCurrentBookInfo();
  this.pushToTalkCtrl.stop(bookContext ? {
    title: bookContext.title || '未知书籍',
    description: bookContext.docDescription || undefined,
  } : undefined);
}
```

- [ ] **Step 4: 修改 showVoiceButton 逻辑**

```typescript
// src/views/sidebar/sidebar-view.ts
const showVoiceButton = !!(ttsConfig && chatConfig);
```

- [ ] **Step 5: 添加移动端长按支持**

```typescript
// src/views/sidebar/sidebar-view.ts
// 在 ChatInput 实例化后
if (Platform.isMobile && ttsConfig && chatConfig) {
  const textarea = this.chatInput.getElement()?.querySelector('textarea');
  if (textarea) {
    // 复用 ChatInput 内部的长按逻辑，或者在这里添加
  }
}
```

- [ ] **Step 6: 运行类型检查**

Run: `npx tsc -noEmit -skipLibCheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/views/sidebar/sidebar-view.ts
git commit -m "feat(voice): integrate new voice button logic in SidebarView"
```

---

## Task 5: 清理和样式调整

**Covers:** [S2, S5]

**Files:**
- Modify: `src/components/chat-input/chat-input.css` (清理旧样式)

**Interfaces:**
- Consumes: 无
- Produces: 清理后的 CSS

- [ ] **Step 1: 移除旧的 voice-btn 样式**

删除以下样式：
- `.deeppdf-voice-btn` 相关样式（约 125-165 行）
- `.deeppdf-voice-btn.recording` 样式（约 470-478 行）
- `.deeppdf-voice-btn.recognizing` 样式（约 481-489 行）
- `@keyframes deeppdf-mic-pulse` 和 `deeppdf-mic-spin`

- [ ] **Step 2: 清理旧的 overlay 样式**

保留并调整：
- `.deeppdf-voice-overlay` → 改为 `.deeppdf-voice-recording-panel`
- 移除移动端 media query（不再需要 fixed 定位）

- [ ] **Step 3: 运行构建验证**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/chat-input/chat-input.css
git commit -m "style(voice): clean up legacy voice styles"
```

---

## Task 6: 测试

**Covers:** [S2, S3, S4, S5, S6]

**Files:**
- Modify: `tests/unit/components/chat-input-touch.test.ts` (更新测试)
- Modify: `tests/e2e-light/specs/push-to-talk.spec.mjs` (更新测试)

**Interfaces:**
- Consumes: 完整的语音按钮功能
- Produces: 测试验证

- [ ] **Step 1: 更新单元测试**

```typescript
// tests/unit/components/chat-input-touch.test.ts
// 更新测试以验证新的按钮逻辑
describe('ChatInput 语音按钮', () => {
  it('无内容时显示麦克风图标', () => {
    // ...
  });

  it('有内容时显示发送图标', () => {
    // ...
  });

  it('录音中显示停止图标', () => {
    // ...
  });
});
```

- [ ] **Step 2: 运行单元测试**

Run: `npx vitest run tests/unit/components/`
Expected: PASS

- [ ] **Step 3: 更新 E2E 测试**

更新 `tests/e2e-light/specs/push-to-talk.spec.mjs` 以验证新的交互流程。

- [ ] **Step 4: Commit**

```bash
git add tests/unit/components/ tests/e2e-light/specs/push-to-talk.spec.mjs
git commit -m "test(voice): update tests for new voice button interaction"
```
