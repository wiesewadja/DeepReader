/**
 * VoiceOverlay — 语音录制界面
 *
 * 点击语音按钮后，替换输入框区域为录制界面：
 * - 左侧：停止按钮
 * - 中间：波形动画
 * - 右侧：发送按钮
 */

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

  /**
   * 显示录制界面
   */
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

  /**
   * 移除录制界面（幂等）
   */
  remove(): void {
    if (this.current) {
      this.current.remove();
      this.current = null;
      // 恢复 textarea
      this.inputArea.style.display = '';
    }
  }
}
