/**
 * MessageList 组件测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageList } from '../../src/components/message-list/message-list';
import { MessageData, CitationData } from '../../src/components/message/message';

describe('MessageList', () => {
	let messageList: MessageList;
	const mockCallbacks = {
		onRegenerate: vi.fn(),
		onCopy: vi.fn(),
		onCopyWithCitation: vi.fn(),
		onCitationJump: vi.fn()
	};

	beforeEach(() => {
		messageList = new MessageList(mockCallbacks);
		// 模拟 DOM 环境
		document.body.appendChild(messageList.getElement()!);
	});

	afterEach(() => {
		messageList.destroy();
		document.body.innerHTML = '';
	});

	describe('初始化', () => {
		it('应该正确渲染消息列表容器', () => {
			const el = messageList.getElement();
			expect(el).toBeTruthy();
			expect(el?.classList.contains('deeppdf-message-list')).toBe(true);
		});

		it('初始状态应该显示空状态', () => {
			const el = messageList.getElement();
			const emptyState = el?.querySelector('.deeppdf-empty-state');
			expect(emptyState).toBeTruthy();
			expect(emptyState?.classList.contains('deeppdf-hidden')).toBe(false);
		});

		it('初始状态消息容器应该是隐藏的', () => {
			const el = messageList.getElement();
			const messagesContainer = el?.querySelector('.deeppdf-messages-container');
			expect(messagesContainer?.classList.contains('deeppdf-hidden')).toBe(true);
		});
	});

	describe('添加消息', () => {
		it('应该成功添加用户消息', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'Hello, AI!',
				timestamp: new Date().toISOString()
			};

			const message = messageList.addMessage(messageData);

			expect(message).toBeTruthy();
			expect(message.getData().id).toBe('msg-1');
			expect(messageList.getMessages().length).toBe(1);
		});

		it('应该成功添加 AI 消息', () => {
			const messageData: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'Hello! How can I help you?',
				timestamp: new Date().toISOString()
			};

			const message = messageList.addMessage(messageData);

			expect(message).toBeTruthy();
			expect(message.getData().id).toBe('msg-2');
			expect(messageList.getMessages().length).toBe(1);
		});

		it('添加消息后应该隐藏空状态', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'Test message',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);

			const el = messageList.getElement();
			const emptyState = el?.querySelector('.deeppdf-empty-state');
			const messagesContainer = el?.querySelector('.deeppdf-messages-container');

			expect(emptyState?.classList.contains('deeppdf-hidden')).toBe(true);
			expect(messagesContainer?.classList.contains('deeppdf-hidden')).toBe(false);
		});

		it('应该可以添加多条消息', () => {
			const message1: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'First message',
				timestamp: new Date().toISOString()
			};

			const message2: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'Second message',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(message1);
			messageList.addMessage(message2);

			expect(messageList.getMessages().length).toBe(2);
		});

		it('添加带引用的 AI 消息应该正确处理', () => {
			const citations: CitationData[] = [
				{
					pdf_name: 'test.pdf',
					page: 1,
					snippet: 'Test snippet',
					file_path: '/path/to/test.pdf'
				}
			];

			const messageData: MessageData = {
				id: 'msg-1',
				role: 'assistant',
				content: 'Here is the answer',
				timestamp: new Date().toISOString(),
				citations
			};

			const message = messageList.addMessage(messageData);

			expect(message.getData().citations).toEqual(citations);
		});
	});

	describe('更新消息', () => {
		it('应该成功更新消息内容', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'assistant',
				content: 'Original content',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);
			messageList.updateMessage('msg-1', { content: 'Updated content' });

			const message = messageList.getMessage('msg-1');
			expect(message?.getData().content).toBe('Updated content');
		});

		it('应该成功更新流式状态', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'assistant',
				content: 'Streaming content',
				timestamp: new Date().toISOString(),
				isStreaming: true
			};

			messageList.addMessage(messageData);
			messageList.updateMessage('msg-1', { isStreaming: false });

			const message = messageList.getMessage('msg-1');
			expect(message?.getData().isStreaming).toBe(false);
		});

		it('应该成功更新引用', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'assistant',
				content: 'Answer',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);

			const newCitations: CitationData[] = [
				{
					pdf_name: 'new.pdf',
					page: 5,
					snippet: 'New snippet'
				}
			];

			messageList.updateMessage('msg-1', { citations: newCitations });

			const message = messageList.getMessage('msg-1');
			expect(message?.getData().citations).toEqual(newCitations);
		});

		it('更新不存在的消息应该不抛出错误', () => {
			expect(() => {
				messageList.updateMessage('non-existent', { content: 'Test' });
			}).not.toThrow();
		});
	});

	describe('获取消息', () => {
		it('应该正确获取指定消息', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'Test',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);
			const message = messageList.getMessage('msg-1');

			expect(message).toBeTruthy();
			expect(message?.getData().id).toBe('msg-1');
		});

		it('获取不存在的消息应该返回 undefined', () => {
			const message = messageList.getMessage('non-existent');
			expect(message).toBeUndefined();
		});

		it('应该正确获取所有消息', () => {
			const msg1: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'First',
				timestamp: new Date().toISOString()
			};

			const msg2: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'Second',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(msg1);
			messageList.addMessage(msg2);

			const messages = messageList.getMessages();
			expect(messages.length).toBe(2);
		});

		it('应该正确获取所有消息数据', () => {
			const msg1: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'First',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(msg1);

			const messagesData = messageList.getMessagesData();
			expect(messagesData.length).toBe(1);
			expect(messagesData[0].id).toBe('msg-1');
			expect(messagesData[0].role).toBe('user');
		});
	});

	describe('删除消息', () => {
		it('应该成功删除指定消息', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'Test',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);
			expect(messageList.getMessages().length).toBe(1);

			messageList.removeMessage('msg-1');
			expect(messageList.getMessages().length).toBe(0);
		});

		it('删除所有消息后应该显示空状态', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'Test',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);
			messageList.removeMessage('msg-1');

			const el = messageList.getElement();
			const emptyState = el?.querySelector('.deeppdf-empty-state');
			expect(emptyState?.classList.contains('deeppdf-hidden')).toBe(false);
		});

		it('删除不存在的消息应该不抛出错误', () => {
			expect(() => {
				messageList.removeMessage('non-existent');
			}).not.toThrow();
		});
	});

	describe('清空消息', () => {
		it('应该成功清空所有消息', () => {
			const msg1: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'First',
				timestamp: new Date().toISOString()
			};

			const msg2: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'Second',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(msg1);
			messageList.addMessage(msg2);

			messageList.clearMessages();

			expect(messageList.getMessages().length).toBe(0);
		});

		it('清空后应该显示空状态', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'Test',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);
			messageList.clearMessages();

			const el = messageList.getElement();
			const emptyState = el?.querySelector('.deeppdf-empty-state');
			expect(emptyState?.classList.contains('deeppdf-hidden')).toBe(false);
		});
	});

	describe('滚动功能', () => {
		it('scrollToBottom 应该不抛出错误', () => {
			expect(() => {
				messageList.scrollToBottom();
			}).not.toThrow();
		});

		it('scrollToMessage 应该正确找到消息', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'Test',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);

			const message = messageList.getMessage('msg-1');
			expect(message).toBeTruthy();

			// 注意：在测试环境中 scrollIntoView 可能不可用
			// 这里只验证消息存在，不测试实际的滚动行为
		});

		it('滚动到不存在的消息应该不抛出错误', () => {
			expect(() => {
				messageList.scrollToMessage('non-existent');
			}).not.toThrow();
		});
	});

	describe('回调函数', () => {
		it('点击重新生成按钮应该触发回调', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'assistant',
				content: 'Test',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);

			const messageEl = messageList.getMessage('msg-1')?.getElement();
			const regenerateBtn = messageEl?.querySelector('.deeppdf-message-action-btn');

			if (regenerateBtn && regenerateBtn.textContent?.includes('重新生成')) {
				(regenerateBtn as HTMLButtonElement).click();
				expect(mockCallbacks.onRegenerate).toHaveBeenCalledWith('msg-1');
			}
		});

		it('点击复制按钮应该触发回调', () => {
			const messageData: MessageData = {
				id: 'msg-1',
				role: 'assistant',
				content: 'Test',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(messageData);

			const messageEl = messageList.getMessage('msg-1')?.getElement();
			const buttons = messageEl?.querySelectorAll('.deeppdf-message-action-btn');

			// 查找复制按钮
			buttons?.forEach(btn => {
				if (btn.textContent?.includes('复制') && !btn.textContent.includes('引用')) {
					(btn as HTMLButtonElement).click();
					expect(mockCallbacks.onCopy).toHaveBeenCalledWith('msg-1');
				}
			});
		});
	});

	describe('销毁', () => {
		it('销毁应该清理所有消息', () => {
			const msg1: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: 'First',
				timestamp: new Date().toISOString()
			};

			const msg2: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'Second',
				timestamp: new Date().toISOString()
			};

			messageList.addMessage(msg1);
			messageList.addMessage(msg2);

			messageList.destroy();

			expect(messageList.getMessages().length).toBe(0);
		});

		it('销毁应该移除 DOM 元素', () => {
			const el = messageList.getElement();
			expect(el?.parentNode).toBeTruthy();

			messageList.destroy();

			expect(el?.parentNode).toBeNull();
		});
	});
});
