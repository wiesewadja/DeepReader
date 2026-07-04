/**
 * VoiceOverlay — 极简内联语音浮层测试
 *
 * 当前实现：在 container 内部创建一个绝对定位覆盖层（点状波纹），
 * 只暴露 showRecording() / remove()。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VoiceOverlay } from '@/components/chat-input/voice-overlay';

describe('VoiceOverlay — 极简内联语音浮层', () => {
    let inputArea: HTMLElement;
    let overlay: VoiceOverlay;
    const callbacks = {
        onCancel: vi.fn(),
        onSend: vi.fn(),
    };

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
        return inputArea.querySelector('.deeppdf-voice-ripple');
    }

    it('showRecording() 挂载 overlay 元素', () => {
        overlay = new VoiceOverlay(inputArea, callbacks);
        overlay.showRecording();
        expect(getOverlayRoot()).toBeTruthy();
    });

    it('showRecording() 渲染 3 个跳动圆点', () => {
        overlay = new VoiceOverlay(inputArea, callbacks);
        overlay.showRecording();
        const dots = inputArea.querySelectorAll('.deeppdf-voice-dot');
        expect(dots.length).toBe(3);
    });

    it('remove() 移除 overlay 元素', () => {
        overlay = new VoiceOverlay(inputArea, callbacks);
        overlay.showRecording();
        expect(getOverlayRoot()).toBeTruthy();
        overlay.remove();
        expect(getOverlayRoot()).toBeNull();
    });

    it('多次 remove() 不抛错', () => {
        overlay = new VoiceOverlay(inputArea, callbacks);
        overlay.showRecording();
        overlay.remove();
        expect(() => overlay.remove()).not.toThrow();
        expect(() => overlay.remove()).not.toThrow();
    });

    it('未 showRecording 时 remove() 不抛错', () => {
        overlay = new VoiceOverlay(inputArea, callbacks);
        expect(() => overlay.remove()).not.toThrow();
    });

    it('重复 showRecording() 会先移除旧 overlay', () => {
        overlay = new VoiceOverlay(inputArea, callbacks);
        overlay.showRecording();
        const first = getOverlayRoot();
        overlay.showRecording();
        const second = getOverlayRoot();
        expect(first).not.toBe(second);
        expect(inputArea.querySelectorAll('.deeppdf-voice-ripple').length).toBe(1);
    });
});
