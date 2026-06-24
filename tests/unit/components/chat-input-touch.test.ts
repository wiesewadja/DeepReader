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
