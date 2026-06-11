/**
 * VoiceOverlay — 抽取自 ChatInput 的语音 overlay 渲染逻辑（P1-7 部分拆分）
 *
 * 目标不变量：
 *  1. show(label, showWave) 在 inputArea 上挂 overlay 元素
 *  2. showWave=true 时包含 .deeppdf-voice-wave span
 *  3. label 文本出现在 overlay 中
 *  4. transitionToRecordingIndicator 把 wave overlay 换成红点 + "录音中"
 *  5. remove() 移除 overlay 元素
 *  6. 多次 remove() 幂等
 *  7. show 后 inputArea.style.position 强制 relative（让 overlay 定位正确）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VoiceOverlay } from '@/components/chat-input/voice-overlay';

describe('VoiceOverlay — 从 ChatInput 抽出的语音 UI 渲染', () => {
    let inputArea: HTMLElement;
    let overlay: VoiceOverlay;

    beforeEach(() => {
        inputArea = document.createElement('div');
        const textarea = document.createElement('textarea');
        inputArea.appendChild(textarea);
        document.body.appendChild(inputArea);
    });

    afterEach(() => {
        inputArea.remove();
    });

    function getOverlayRoot(): HTMLElement | null {
        return inputArea.querySelector(
            '.deeppdf-voice-overlay, .deeppdf-voice-recording-indicator',
        );
    }

    describe('invariant 1 — show() 挂载 overlay', () => {
        it('show 后 inputArea 含 overlay 元素', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在聆听...', true);
            expect(getOverlayRoot()).toBeTruthy();
        });
    });

    describe('invariant 2 — wave span', () => {
        it('showWave=true 时含 .deeppdf-voice-wave', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在聆听...', true);
            const wave = inputArea.querySelector('.deeppdf-voice-wave');
            expect(wave).toBeTruthy();
        });

        it('showWave=false 时无 .deeppdf-voice-wave', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在识别...', false);
            const wave = inputArea.querySelector('.deeppdf-voice-wave');
            expect(wave).toBeNull();
        });
    });

    describe('invariant 3 — label 文本', () => {
        it('label 文本出现在 .deeppdf-voice-label', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在聆听...', true);
            const label = inputArea.querySelector('.deeppdf-voice-label');
            expect(label?.textContent).toBe('正在聆听...');
        });
    });

    describe('invariant 4 — 切换到录音指示器', () => {
        it('transitionToRecordingIndicator 把 wave 替换为红点 + "录音中"', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在聆听...', true);
            overlay.transitionToRecordingIndicator();
            // wave 应消失
            expect(inputArea.querySelector('.deeppdf-voice-wave')).toBeNull();
            // 红点 + "录音中" 应存在
            const dot = inputArea.querySelector('.deeppdf-voice-recording-dot');
            const text = inputArea.querySelector(
                '.deeppdf-voice-recording-indicator',
            );
            expect(dot).toBeTruthy();
            expect(text?.textContent).toContain('录音中');
        });
    });

    describe('invariant 5 — remove() 移除 overlay', () => {
        it('show 后 remove() 移除 overlay 元素', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在聆听...', true);
            expect(getOverlayRoot()).toBeTruthy();
            overlay.remove();
            expect(getOverlayRoot()).toBeNull();
        });
    });

    describe('invariant 6 — remove() 幂等', () => {
        it('多次 remove() 不抛错', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在聆听...', true);
            overlay.remove();
            expect(() => overlay.remove()).not.toThrow();
            expect(() => overlay.remove()).not.toThrow();
        });

        it('未 show 时 remove() 不抛错', () => {
            overlay = new VoiceOverlay(inputArea);
            expect(() => overlay.remove()).not.toThrow();
        });
    });

    describe('invariant 7 — inputArea 强制 position: relative', () => {
        it('show 后 inputArea.style.position = relative', () => {
            overlay = new VoiceOverlay(inputArea);
            overlay.show('正在聆听...', true);
            expect(inputArea.style.position).toBe('relative');
        });

        it('未 show 时不修改 inputArea.style', () => {
            inputArea.style.position = 'static';
            overlay = new VoiceOverlay(inputArea);
            expect(inputArea.style.position).toBe('static');
        });
    });
});
