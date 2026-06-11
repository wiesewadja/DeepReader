/**
 * VoiceOverlay — 语音输入态 UI 渲染（P1-7 部分拆分）
 *
 * 抽自 ChatInput 的内联方法 showVoiceOverlay / removeVoiceOverlay /
 * transitionToRecordingIndicator。负责：
 *  - "正在聆听..." 状态：wave 动画 + label
 *  - "正在识别..." 状态：label only
 *  - "录音中" 状态：右上角小红点 + 文字
 *
 * 与 ChatInput 解耦后：单测独立、行为可观察、可被其他聊天组件复用。
 */

export class VoiceOverlay {
    private inputArea: HTMLElement;
    private current: HTMLElement | null = null;

    constructor(inputArea: HTMLElement) {
        this.inputArea = inputArea;
    }

    /**
     * 显示带 wave / label 的 overlay
     * @param label 显示文字（如 "正在聆听..." / "正在识别..."）
     * @param showWave true 时显示 wave 动画（"正在聆听" 阶段）
     */
    show(label: string, showWave: boolean): void {
        this.remove();

        // 让 overlay 定位正确（absolute/fixed 的祖先需要非 static）
        this.inputArea.style.position = 'relative';

        this.current = this.inputArea.createDiv({
            cls: 'deeppdf-voice-overlay',
        });

        if (showWave) {
            const wave = this.current.createSpan({
                cls: 'deeppdf-voice-wave',
            });
            for (let i = 0; i < 5; i++) {
                wave.createSpan();
            }
        }

        this.current.createSpan({
            cls: 'deeppdf-voice-label',
            text: label,
        });
    }

    /**
     * 从"wave overlay" 过渡到"小红点 + 录音中"指示器
     * （用户开始说话后，文本需要可见，wave 收起）
     */
    transitionToRecordingIndicator(): void {
        if (!this.current) return;
        this.remove();

        this.current = this.inputArea.createDiv({
            cls: 'deeppdf-voice-recording-indicator',
        });
        this.current.createSpan({ cls: 'deeppdf-voice-recording-dot' });
        this.current.createSpan({ text: '录音中' });
    }

    /**
     * 移除当前 overlay（幂等）
     */
    remove(): void {
        if (this.current) {
            this.current.remove();
            this.current = null;
        }
    }
}
