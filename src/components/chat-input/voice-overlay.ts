/**
 * VoiceOverlay — 极简内联语音浮层
 *
 * 在输入框内部叠加绝对定位的动画层，两种状态有不同视觉：
 * - recording：红色波形条（5 根跳动的条）+ "录音中" 文字
 * - recognizing：蓝色 spinner 圆环 + "识别中" 文字
 */

export class VoiceOverlay {
  private container: HTMLElement;
  private current: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 显示录音态（红色波形条）
   */
  showRecording(): void {
    this.remove();
    this.current = this.container.createDiv({ cls: 'deeppdf-voice-overlay' });

    // 红色波形条（12 根）
    const wave = this.current.createDiv({ cls: 'deeppdf-voice-wave' });
    for (let i = 0; i < 12; i++) {
      wave.createEl('span');
    }
  }

  /**
   * 显示识别态（蓝色 spinner）
   */
  showRecognizing(): void {
    this.remove();
    this.current = this.container.createDiv({ cls: 'deeppdf-voice-overlay' });

    // 蓝色旋转圆环
    this.current.createDiv({ cls: 'deeppdf-voice-spinner' });

    // 状态文字
    this.current.createEl('span', {
      cls: 'deeppdf-voice-label recognizing',
      text: '识别中',
    });
  }

  /**
   * 移除覆层
   */
  remove(): void {
    if (this.current) {
      this.current.remove();
      this.current = null;
    }
  }
}
