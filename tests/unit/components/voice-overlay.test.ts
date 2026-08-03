/**
 * VoiceOverlay — 极简内联语音浮层测试
 *
 * 两种状态：
 * - recording：showRecording() → 5 个波形条 + "录音中"
 * - recognizing：showRecognizing() → spinner + "识别中"
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VoiceOverlay } from '@/components/chat-input/voice-overlay';

describe('VoiceOverlay — 极简内联语音浮层', () => {
    let inputArea: HTMLElement;
    let overlay: VoiceOverlay;

    beforeEach(() => {
        inputArea = document.createElement('div');
        const textarea = document.createElement('textarea');
        inputArea.appendChild(textarea);
        document.body.appendChild(inputArea);
    });

    afterEach(() => {
        overlay?.remove();
        inputArea.remove();
    });

    function getOverlayRoot(): HTMLElement | null {
        return inputArea.querySelector('.deeppdf-voice-overlay');
    }

    // ── recording 状态 ──────────────────────────────────────────────────

    it('showRecording() 挂载 overlay 元素', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecording();
        expect(getOverlayRoot()).toBeTruthy();
    });

    it('showRecording() 渲染 12 个波形条', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecording();
        const bars = inputArea.querySelectorAll('.deeppdf-voice-wave span');
        expect(bars.length).toBe(12);
    });

    it('showRecording() 不渲染 spinner', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecording();
        expect(inputArea.querySelector('.deeppdf-voice-spinner')).toBeNull();
    });

    // ── recognizing 状态 ──────────────────────────────────────────────────

    it('showRecognizing() 挂载 overlay 元素', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecognizing();
        expect(getOverlayRoot()).toBeTruthy();
    });

    it('showRecognizing() 渲染 spinner', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecognizing();
        expect(inputArea.querySelector('.deeppdf-voice-spinner')).toBeTruthy();
    });

    it('showRecognizing() 渲染 "识别中" 状态文字', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecognizing();
        const label = inputArea.querySelector('.deeppdf-voice-label.recognizing');
        expect(label?.textContent).toBe('识别中');
    });

    it('showRecognizing() 不渲染波形条', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecognizing();
        expect(inputArea.querySelectorAll('.deeppdf-voice-wave span').length).toBe(0);
    });

    // ── 生命周期 ──────────────────────────────────────────────────────────

    it('remove() 移除 overlay 元素', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecording();
        overlay.remove();
        expect(getOverlayRoot()).toBeNull();
    });

    it('多次 remove() 不抛错', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecording();
        overlay.remove();
        expect(() => overlay.remove()).not.toThrow();
        expect(() => overlay.remove()).not.toThrow();
    });

    it('未 showRecording 时 remove() 不抛错', () => {
        overlay = new VoiceOverlay(inputArea);
        expect(() => overlay.remove()).not.toThrow();
    });

    it('showRecording() → showRecognizing() 会替换 overlay（只有一个 root）', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecording();
        overlay.showRecognizing();
        expect(inputArea.querySelectorAll('.deeppdf-voice-overlay').length).toBe(1);
        expect(inputArea.querySelector('.deeppdf-voice-spinner')).toBeTruthy();
        expect(inputArea.querySelectorAll('.deeppdf-voice-wave span').length).toBe(0);
    });

    it('重复 showRecording() 会先移除旧 overlay', () => {
        overlay = new VoiceOverlay(inputArea);
        overlay.showRecording();
        const first = getOverlayRoot();
        overlay.showRecording();
        const second = getOverlayRoot();
        expect(first).not.toBe(second);
        expect(inputArea.querySelectorAll('.deeppdf-voice-overlay').length).toBe(1);
    });
});
