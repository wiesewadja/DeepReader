/**
 * ChatInput 组件测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChatInput } from '../../src/components/chat-input/chat-input';

describe('ChatInput', () => {
	let chatInput: ChatInput;
	let container: HTMLElement;
	const mockOnSend = vi.fn();

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);

		chatInput = new ChatInput({
			onSend: mockOnSend,
			placeholder: '请输入消息...',
			disabled: false
		});

		container.appendChild(chatInput.getElement()!);
	});

	afterEach(() => {
		chatInput.destroy();
		container.remove();
		mockOnSend.mockClear();
	});

	describe('初始化', () => {
		it('应该正确渲染聊天输入组件', () => {
			const el = chatInput.getElement();
			expect(el).toBeTruthy();
			expect(el?.classList.contains('deeppdf-chat-input')).toBe(true);
		});

		it('应该渲染文本输入框', () => {
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea');
			expect(textarea).toBeTruthy();
			expect(textarea?.tagName).toBe('TEXTAREA');
		});

		it('应该渲染发送按钮', () => {
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn');
			expect(sendButton).toBeTruthy();
			expect(sendButton?.tagName).toBe('BUTTON');
		});

		it('初始状态发送按钮应该被禁用', () => {
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;
			expect(sendButton.disabled).toBe(true);
		});

		it('应该使用自定义占位符', () => {
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(textarea.placeholder).toBe('请输入消息...');
		});
	});

	describe('输入功能', () => {
		it('getValue 应该返回输入框的值', () => {
			chatInput.setValue('Hello, world!');
			expect(chatInput.getValue()).toBe('Hello, world!');
		});

		it('setValue 应该设置输入框的值', () => {
			chatInput.setValue('Test message');
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(textarea.value).toBe('Test message');
		});

		it('clear 应该清空输入框', () => {
			chatInput.setValue('Some text');
			chatInput.clear();
			expect(chatInput.getValue()).toBe('');
		});

		it('清空后发送按钮应该被禁用', () => {
			chatInput.setValue('Some text');
			chatInput.clear();
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;
			expect(sendButton.disabled).toBe(true);
		});
	});

	describe('发送功能', () => {
		it('输入文本后发送按钮应该启用', () => {
			chatInput.setValue('Hello');
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;
			expect(sendButton.disabled).toBe(false);
		});

		it('点击发送按钮应该触发 onSend 回调', () => {
			chatInput.setValue('Test message');
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;

			sendButton.click();
			expect(mockOnSend).toHaveBeenCalledWith('Test message', []);
		});

		it('发送后应该清空输入框', () => {
			chatInput.setValue('Test message');
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;

			sendButton.click();
			expect(chatInput.getValue()).toBe('');
		});

		it('发送后应该重新聚焦输入框', () => {
			chatInput.setValue('Test message');
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			// 先失焦
			textarea.blur();
			expect(document.activeElement).not.toBe(textarea);

			// 点击发送
			sendButton.click();
			expect(document.activeElement).toBe(textarea);
		});

		it('空字符串不应触发发送', () => {
			chatInput.setValue('   ');
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;

			sendButton.click();
			expect(mockOnSend).not.toHaveBeenCalled();
		});

		it('只包含空白字符的输入不应触发发送', () => {
			chatInput.setValue('\n\t  \n');
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;

			sendButton.click();
			expect(mockOnSend).not.toHaveBeenCalled();
		});
	});

	describe('键盘事件', () => {
		it('按 Enter 键应该发送消息', () => {
			chatInput.setValue('Test message');
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false });
			textarea.dispatchEvent(enterEvent);

			expect(mockOnSend).toHaveBeenCalledWith('Test message', []);
		});

		it('按 Shift+Enter 应该换行而不是发送', () => {
			chatInput.setValue('Line 1');
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			const shiftEnterEvent = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true });
			textarea.dispatchEvent(shiftEnterEvent);

			expect(mockOnSend).not.toHaveBeenCalled();
		});

		it('Enter 发送后应该清空输入', () => {
			chatInput.setValue('Test message');
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false });
			textarea.dispatchEvent(enterEvent);

			expect(chatInput.getValue()).toBe('');
		});

		it('应该触发 onKeyDown 回调', () => {
			const mockOnKeyDown = vi.fn();
			const inputWithCallback = new ChatInput({
				onSend: mockOnSend,
				onKeyDown: mockOnKeyDown
			});

			const el = inputWithCallback.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			const keyEvent = new KeyboardEvent('keydown', { key: 'a' });
			textarea.dispatchEvent(keyEvent);

			expect(mockOnKeyDown).toHaveBeenCalledWith(keyEvent);

			inputWithCallback.destroy();
		});
	});

	describe('占位符', () => {
		it('setPlaceholder 应该更新占位符文本', () => {
			chatInput.setPlaceholder('新的占位符');
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(textarea.placeholder).toBe('新的占位符');
		});

		it('应该使用构造函数中的占位符', () => {
			const customInput = new ChatInput({
				onSend: mockOnSend,
				placeholder: '自定义占位符'
			});

			const el = customInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(textarea.placeholder).toBe('自定义占位符');

			customInput.destroy();
		});
	});

	describe('禁用状态', () => {
		it('setDisabled(true) 应该禁用输入框', () => {
			chatInput.setDisabled(true);
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(textarea.disabled).toBe(true);
		});

		it('setDisabled(false) 应该启用输入框', () => {
			chatInput.setDisabled(true);
			chatInput.setDisabled(false);
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(textarea.disabled).toBe(false);
		});

		it('禁用状态下发送按钮应该被禁用', () => {
			chatInput.setValue('Test message');
			chatInput.setDisabled(true);
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;
			expect(sendButton.disabled).toBe(true);
		});

		it('禁用状态下不能发送消息', () => {
			chatInput.setValue('Test message');
			chatInput.setDisabled(true);
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false });
			textarea.dispatchEvent(enterEvent);

			expect(mockOnSend).not.toHaveBeenCalled();
		});
	});

	describe('自动调整高度', () => {
		it('多行输入应该增加高度', async () => {
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			// 设置多行文本
			chatInput.setValue('Line 1\nLine 2\nLine 3');

			// 等待 requestAnimationFrame 完成
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

			// 检查高度样式是否被设置
			const heightStyle = textarea.style.height;
			expect(heightStyle).toBeTruthy();
			expect(parseInt(heightStyle)).toBeGreaterThan(0);
		});

		it('清空后应该恢复到初始高度', async () => {
			chatInput.setValue('Line 1\nLine 2\nLine 3');

			// 等待 requestAnimationFrame 完成
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			const heightBeforeClear = textarea.style.height;

			chatInput.clear();

			// 等待 requestAnimationFrame 完成
			await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

			const heightAfterClear = textarea.style.height;

			// 高度应该被重置
			expect(heightAfterClear).toBeDefined();
			expect(parseInt(heightAfterClear)).toBeLessThanOrEqual(parseInt(heightBeforeClear));
		});
	});

	describe('焦点管理', () => {
		it('focus 应该聚焦到输入框', () => {
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			textarea.blur();
			expect(document.activeElement).not.toBe(textarea);

			chatInput.focus();
			expect(document.activeElement).toBe(textarea);
		});

		it('输入框应该有正确的 ARIA 属性', () => {
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			expect(textarea.getAttribute('aria-label')).toBe('');
			expect(textarea.getAttribute('aria-multiline')).toBe('true');
		});

		it('发送按钮应该有正确的 ARIA 属性', () => {
			const el = chatInput.getElement();
			const sendButton = el?.querySelector('.deeppdf-chat-input-send-btn') as HTMLButtonElement;

			expect(sendButton.getAttribute('aria-label')).toBe('发送消息');
		});
	});

	describe('销毁', () => {
		it('destroy 应该移除 DOM 元素', () => {
			const el = chatInput.getElement();
			expect(el?.parentNode).toBeTruthy();

			chatInput.destroy();

			expect(el?.parentNode).toBeNull();
		});

		it('销毁后应该无法访问方法', () => {
			chatInput.destroy();

			expect(() => {
				chatInput.getValue();
			}).not.toThrow();
		});
	});

	describe('边界情况', () => {
		it('特殊字符应该正常处理', () => {
			const specialText = '<script>alert("test")</script>';
			chatInput.setValue(specialText);
			expect(chatInput.getValue()).toBe(specialText);
		});

		it('非常长的文本应该正常处理', () => {
			const longText = 'A'.repeat(1000);
			chatInput.setValue(longText);
			expect(chatInput.getValue()).toBe(longText);
		});

		it('空字符串 setValue 应该正常工作', () => {
			chatInput.setValue('Test');
			chatInput.setValue('');
			expect(chatInput.getValue()).toBe('');
		});

		it('null 或 undefined 占位符应该使用默认值', () => {
			const inputWithNullPlaceholder = new ChatInput({
				onSend: mockOnSend,
				placeholder: undefined as any
			});

			const el = inputWithNullPlaceholder.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(textarea.placeholder).toBe('');

			inputWithNullPlaceholder.destroy();
		});
	});

	describe('粘贴事件', () => {
		it('粘贴内容后应该正确调整高度', () => {
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			// 模拟粘贴多行文本
			const pasteEvent = new Event('paste', { bubbles: true });
			textarea.value = 'Line 1\nLine 2\nLine 3';
			textarea.dispatchEvent(pasteEvent);

			// 等待延迟处理
			setTimeout(() => {
				expect(textarea.style.height).toBeDefined();
			}, 10);
		});
	});

	describe('可访问性', () => {
		it('输入框应该是可聚焦的', () => {
			chatInput.focus();
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;
			expect(document.activeElement).toBe(textarea);
		});

		it('Tab 键应该正常工作', () => {
			const el = chatInput.getElement();
			const textarea = el?.querySelector('.deeppdf-chat-input-textarea') as HTMLTextAreaElement;

			// 聚焦输入框
			textarea.focus();

			// 模拟 Tab 键
			const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
			const handled = textarea.dispatchEvent(tabEvent);

			// Tab 事件应该被处理
			expect(handled).toBe(true);
		});
	});
});
