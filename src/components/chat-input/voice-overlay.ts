import { setIcon } from 'obsidian';

/**
 * VoiceOverlay — 语音录制界面
 *
 * 点击语音按钮后，替换输入框区域为录制界面：
 * - 左侧：停止按钮
 * - 中间：声纹动画
 * - 右侧：发送按钮
 */

export interface VoiceOverlayCallbacks {
  onCancel: () => void;
  onSend: () => void;
}

export class VoiceOverlay {
  private container: HTMLElement;
  private current: HTMLElement | null = null;
  private callbacks: VoiceOverlayCallbacks;
  private waveSpans: HTMLElement[] = [];
  private animationFrame: number | null = null;

  constructor(container: HTMLElement, callbacks: VoiceOverlayCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  /**
   * 显示录制界面
   */
  showRecording(): void {
    this.remove();

    // 隐藏整个输入框容器
    this.container.style.display = 'none';

    // 创建录制界面
    this.current = this.container.parentElement!.createDiv({
      cls: 'deeppdf-voice-recording-panel',
    });

    // 取消按钮
    const cancelBtn = this.current.createEl('button', {
      cls: 'deeppdf-voice-stop-btn',
    });
    setIcon(cancelBtn, 'x');
    cancelBtn.setAttribute('aria-label', '取消录音');
    cancelBtn.addEventListener('click', () => this.callbacks.onCancel());

    // 声纹动画容器
    const waveContainer = this.current.createDiv({
      cls: 'deeppdf-voice-wave-container',
    });

    // 创建 12 条声纹
    for (let i = 0; i < 12; i++) {
      const span = waveContainer.createDiv({
        cls: 'deeppdf-voice-wave-bar',
      });
      this.waveSpans.push(span);
    }

    // 发送按钮
    const sendBtn = this.current.createEl('button', {
      cls: 'deeppdf-voice-send-btn',
    });
    setIcon(sendBtn, 'arrow-up');
    sendBtn.setAttribute('aria-label', '发送语音');
    sendBtn.addEventListener('click', () => this.callbacks.onSend());

    // 启动声纹动画
    this.startWaveAnimation();
  }

  /**
   * 启动声纹动画
   */
  private startWaveAnimation(): void {
    let t = 0;
    const animate = () => {
      t += 0.15;
      this.waveSpans.forEach((span, i) => {
        // 结合正弦波与随机噪点，创造出自然顺滑流动的声纹波动效果
        const wave = Math.sin(t + i * 0.5);
        const noise = 0.8 + Math.random() * 0.4;
        const height = 6 + Math.abs(wave) * 22 * noise;
        span.style.height = `${height}px`;
        span.style.opacity = `${0.4 + Math.abs(wave) * 0.6}`;
      });
      this.animationFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  /**
   * 停止声纹动画
   */
  private stopWaveAnimation(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    // 重置声纹高度
    this.waveSpans.forEach(span => {
      span.style.height = '6px';
      span.style.opacity = '0.4';
    });
  }

  /**
   * 移除录制界面（幂等）
   */
  remove(): void {
    this.stopWaveAnimation();
    if (this.current) {
      this.current.remove();
      this.current = null;
      this.waveSpans = [];
      // 恢复输入框容器
      this.container.style.display = '';
    }
  }
}
