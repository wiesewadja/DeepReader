/**
 * VoiceOverlay — 极简内联语音浮层
 *
 * 在输入框内部叠加一个绝对定位的动画层（点状波形），
 * 不再替换整个输入容器，实现无缝平滑切换。
 */

export interface VoiceOverlayCallbacks {
  onCancel: () => void;
  onSend: () => void;
}

export class VoiceOverlay {
  private container: HTMLElement;
  private current: HTMLElement | null = null;
  private callbacks: VoiceOverlayCallbacks;

  constructor(container: HTMLElement, callbacks: VoiceOverlayCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  /**
   * 显示录制界面
   */
  showRecording(): void {
    this.remove();

    // 在 container 内部创建一个绝对定位覆盖层
    this.current = this.container.createDiv({
      cls: 'deeppdf-voice-ripple',
    });

    // 3 个跳动的小圆点
    for (let i = 0; i < 3; i++) {
      this.current.createDiv({ cls: 'deeppdf-voice-dot' });
    }
  }

  /**
   * 移除录制界面
   */
  remove(): void {
    if (this.current) {
      this.current.remove();
      this.current = null;
    }
  }
}
