/**
 * Message 组件测试
 * 测试聊天消息的渲染和交互功能
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	Message,
	UserMessage,
	AIMessage,
	Citation,
	createMessage,
	MessageData,
	CitationData,
	MessageRole
} from '@/components/message/message';

describe('Message 组件', () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	afterEach(() => {
		container.remove();
	});

	describe('UserMessage 用户消息', () => {
		it('应该渲染用户消息', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '你好，请介绍一下这个文档',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			expect(el).toBeTruthy();
			expect(el?.classList.contains('deeppdf-message')).toBe(true);
			expect(el?.classList.contains('deeppdf-message-user')).toBe(true);
		});

		it('应该右对齐显示', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			// 检查用户消息容器是否有正确的类名
			// 右对齐是通过 CSS 类 .deeppdf-message-user 实现的
			expect(el?.classList.contains('deeppdf-message-user')).toBe(true);
		});

		it('应该显示消息内容', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '这是一条测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe('这是一条测试消息');
		});

		it('应该显示时间戳', () => {
			const now = new Date();
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '测试消息',
				timestamp: now.toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const timeEl = el?.querySelector('.deeppdf-message-time');
			expect(timeEl).toBeTruthy();
			expect(timeEl?.textContent).toBeTruthy();
		});

		it('应该转义 HTML 特殊字符', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '<script>alert("xss")</script>',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.innerHTML).not.toContain('<script>');
		});

		it('应该使用用户消息样式', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const bubble = el?.querySelector('.deeppdf-message-bubble');
			expect(bubble?.classList.contains('deeppdf-message-bubble-user')).toBe(true);
		});
	});

	describe('AIMessage AI 消息', () => {
		it('应该渲染 AI 消息', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '你好！我可以帮助你理解这个文档。',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			expect(el).toBeTruthy();
			expect(el?.classList.contains('deeppdf-message')).toBe(true);
			expect(el?.classList.contains('deeppdf-message-assistant')).toBe(true);
		});

		it('应该左对齐显示', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			expect(el?.classList.contains('deeppdf-message-assistant')).toBe(true);
		});

		it('应该显示 AI 头像', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const avatar = el?.querySelector('.deeppdf-message-avatar');
			expect(avatar?.textContent).toBe('🤖');
		});

		it('应该显示消息内容', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '这是一条 AI 回复',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe('这是一条 AI 回复');
		});

		it('应该显示操作按钮', () => {
			const onRegenerate = vi.fn();
			const onCopy = vi.fn();

			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data, {
				onRegenerate,
				onCopy
			});
			const el = message.getElement();
			container.appendChild(el);

			const actions = el?.querySelector('.deeppdf-message-actions');
			expect(actions).toBeTruthy();

			const buttons = actions?.querySelectorAll('.deeppdf-message-action-btn');
			expect(buttons?.length).toBeGreaterThanOrEqual(2);
		});

		it('重新生成按钮应该触发回调', () => {
			const onRegenerate = vi.fn();

			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data, { onRegenerate });
			const el = message.getElement();
			container.appendChild(el);

			const regenerateBtn = Array.from(el?.querySelectorAll('.deeppdf-message-action-btn') || [])
				.find(btn => btn.textContent?.includes('重新生成'));

			regenerateBtn?.click();
			expect(onRegenerate).toHaveBeenCalledTimes(1);
		});

		it('复制按钮应该触发回调', () => {
			const onCopy = vi.fn();

			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data, { onCopy });
			const el = message.getElement();
			container.appendChild(el);

			const copyBtn = Array.from(el?.querySelectorAll('.deeppdf-message-action-btn') || [])
				.find(btn => btn.textContent?.includes('复制') && !btn.textContent?.includes('引用'));

			copyBtn?.click();
			expect(onCopy).toHaveBeenCalledTimes(1);
		});

		it('应该转义 HTML 特殊字符', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '<img src=x onerror="alert(1)">',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.innerHTML).not.toContain('<img');
		});

		it('应该使用 AI 消息样式', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const bubble = el?.querySelector('.deeppdf-message-bubble');
			expect(bubble?.classList.contains('deeppdf-message-bubble-ai')).toBe(true);
		});
	});

	describe('Citation 引用组件', () => {
		it('应该渲染引用组件', () => {
			const citation: CitationData = {
				pdf_name: 'test.pdf',
				page: 10,
				snippet: '这是一段引用文本'
			};

			const citationEl = new Citation(citation);
			const el = citationEl.getElement();
			container.appendChild(el);

			expect(el).toBeTruthy();
			expect(el?.classList.contains('deeppdf-citation')).toBe(true);
		});

		it('应该显示 PDF 文件名', () => {
			const citation: CitationData = {
				pdf_name: 'my-document.pdf',
				page: 5,
				snippet: '引用文本'
			};

			const citationEl = new Citation(citation);
			const el = citationEl.getElement();
			container.appendChild(el);

			const filenameEl = el?.querySelector('.deeppdf-citation-filename');
			expect(filenameEl?.textContent).toBe('my-document.pdf');
		});

		it('应该显示页码', () => {
			const citation: CitationData = {
				pdf_name: 'test.pdf',
				page: 42,
				snippet: '引用文本'
			};

			const citationEl = new Citation(citation);
			const el = citationEl.getElement();
			container.appendChild(el);

			const pageBadge = el?.querySelector('.deeppdf-citation-page-badge');
			expect(pageBadge?.textContent).toContain('42');
			expect(pageBadge?.textContent).toContain('第');
			expect(pageBadge?.textContent).toContain('页');
		});

		it('应该显示引用文本片段', () => {
			const citation: CitationData = {
				pdf_name: 'test.pdf',
				page: 1,
				snippet: '这是被引用的文本内容'
			};

			const citationEl = new Citation(citation);
			const el = citationEl.getElement();
			container.appendChild(el);

			const snippetEl = el?.querySelector('.deeppdf-citation-snippet');
			expect(snippetEl?.textContent).toBe('这是被引用的文本内容');
		});

		it('应该有跳转按钮（当提供回调时）', () => {
			const onJump = vi.fn();
			const citation: CitationData = {
				pdf_name: 'test.pdf',
				page: 1,
				snippet: '引用文本'
			};

			const citationEl = new Citation(citation, onJump);
			const el = citationEl.getElement();
			container.appendChild(el);

			const jumpBtn = el?.querySelector('.deeppdf-citation-jump-btn');
			expect(jumpBtn).toBeTruthy();
			expect(jumpBtn?.textContent).toContain('跳转');
		});

		it('跳转按钮应该触发回调', () => {
			const onJump = vi.fn();
			const citation: CitationData = {
				pdf_name: 'test.pdf',
				page: 1,
				snippet: '引用文本'
			};

			const citationEl = new Citation(citation, onJump);
			const el = citationEl.getElement();
			container.appendChild(el);

			const jumpBtn = el?.querySelector('.deeppdf-citation-jump-btn') as HTMLButtonElement;
			jumpBtn?.click();
			expect(onJump).toHaveBeenCalledWith(citation);
		});

		it('应该转义文件名中的 HTML 特殊字符', () => {
			const citation: CitationData = {
				pdf_name: '<script>alert("xss")</script>.pdf',
				page: 1,
				snippet: '引用文本'
			};

			const citationEl = new Citation(citation);
			const el = citationEl.getElement();
			container.appendChild(el);

			const filenameEl = el?.querySelector('.deeppdf-citation-filename');
			expect(filenameEl?.innerHTML).not.toContain('<script>');
		});
	});

	describe('AI 消息引用来源', () => {
		it('应该显示引用来源', () => {
			const citations: CitationData[] = [
				{
					pdf_name: 'doc1.pdf',
					page: 10,
					snippet: '引用文本 1'
				},
				{
					pdf_name: 'doc2.pdf',
					page: 20,
					snippet: '引用文本 2'
				}
			];

			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '这是 AI 回复',
				timestamp: new Date().toISOString(),
				citations
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const citationsContainer = el?.querySelector('.deeppdf-message-citations');
			expect(citationsContainer).toBeTruthy();

			const citationEls = citationsContainer?.querySelectorAll('.deeppdf-citation');
			expect(citationEls?.length).toBe(2);
		});

		it('应该显示复制+引用按钮（当有引用时）', () => {
			const onCopyWithCitation = vi.fn();
			const citations: CitationData[] = [
				{
					pdf_name: 'doc.pdf',
					page: 1,
					snippet: '引用文本'
				}
			];

			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '回复',
				timestamp: new Date().toISOString(),
				citations
			};

			const message = new AIMessage(data, { onCopyWithCitation });
			const el = message.getElement();
			container.appendChild(el);

			const copyWithCitationBtn = Array.from(
				el?.querySelectorAll('.deeppdf-message-action-btn') || []
			).find(btn => btn.textContent?.includes('复制+引用'));

			expect(copyWithCitationBtn).toBeTruthy();
		});

		it('复制+引用按钮应该触发回调', () => {
			const onCopyWithCitation = vi.fn();
			const citations: CitationData[] = [
				{
					pdf_name: 'doc.pdf',
					page: 1,
					snippet: '引用文本'
				}
			];

			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '回复',
				timestamp: new Date().toISOString(),
				citations
			};

			const message = new AIMessage(data, { onCopyWithCitation });
			const el = message.getElement();
			container.appendChild(el);

			const copyWithCitationBtn = Array.from(
				el?.querySelectorAll('.deeppdf-message-action-btn') || []
			).find(btn => btn.textContent?.includes('复制+引用'));

			copyWithCitationBtn?.click();
			expect(onCopyWithCitation).toHaveBeenCalledTimes(1);
		});
	});

	describe('消息更新功能', () => {
		it('用户消息应该能够更新内容', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '原始内容',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			let el = message.getElement();
			container.appendChild(el);

			let contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe('原始内容');

			// 更新内容
			message.update({ content: '更新后的内容' });

			el = message.getElement();
			contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe('更新后的内容');
		});

		it('AI 消息应该能够更新内容', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '原始回复',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			let el = message.getElement();
			container.appendChild(el);

			let contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe('原始回复');

			// 更新内容
			message.update({ content: '更新后的回复' });

			el = message.getElement();
			contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe('更新后的回复');
		});

		it('应该能够添加引用来源', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '回复',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			let el = message.getElement();
			container.appendChild(el);

			let citationsContainer = el?.querySelector('.deeppdf-message-citations');
			expect(citationsContainer).toBeFalsy();

			// 添加引用
			const citations: CitationData[] = [
				{
					pdf_name: 'doc.pdf',
					page: 1,
					snippet: '引用文本'
				}
			];
			message.update({ citations });

			el = message.getElement();
			citationsContainer = el?.querySelector('.deeppdf-message-citations');
			expect(citationsContainer).toBeTruthy();
		});
	});

	describe('createMessage 工厂函数', () => {
		it('应该创建用户消息', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '用户消息',
				timestamp: new Date().toISOString()
			};

			const message = createMessage(data);
			expect(message).toBeInstanceOf(UserMessage);
		});

		it('应该创建 AI 消息', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'AI 消息',
				timestamp: new Date().toISOString()
			};

			const message = createMessage(data);
			expect(message).toBeInstanceOf(AIMessage);
		});

		it('应该传递回调函数给 AI 消息', () => {
			const onRegenerate = vi.fn();
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'AI 消息',
				timestamp: new Date().toISOString()
			};

			const message = createMessage(data, { onRegenerate });
			const el = message.getElement();
			container.appendChild(el);

			const regenerateBtn = Array.from(
				el?.querySelectorAll('.deeppdf-message-action-btn') || []
			).find(btn => btn.textContent?.includes('重新生成'));

			expect(regenerateBtn).toBeTruthy();
		});
	});

	describe('边界情况', () => {
		it('应该处理空消息内容', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe('');
		});

		it('应该处理长消息内容', () => {
			const longContent = '这是一个非常长的消息内容。'.repeat(100);
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: longContent,
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe(longContent);
		});

		it('应该处理特殊字符', () => {
			const specialContent = '测试消息：\n换行\n\t制表符\t"引号"\'单引号\'';
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: specialContent,
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const contentEl = el?.querySelector('.deeppdf-message-content');
			expect(contentEl?.textContent).toBe(specialContent);
		});

		it('应该处理没有回调的 AI 消息', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'AI 消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			// 不应该有操作按钮
			const actions = el?.querySelector('.deeppdf-message-actions');
			expect(actions).toBeFalsy();
		});

		it('应该处理空引用列表', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: 'AI 消息',
				timestamp: new Date().toISOString(),
				citations: []
			};

			const message = new AIMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const citationsContainer = el?.querySelector('.deeppdf-message-citations');
			expect(citationsContainer).toBeFalsy();
		});

		it('应该处理没有回调的引用', () => {
			const citation: CitationData = {
				pdf_name: 'test.pdf',
				page: 1,
				snippet: '引用文本'
			};

			const citationEl = new Citation(citation);
			const el = citationEl.getElement();
			container.appendChild(el);

			const jumpBtn = el?.querySelector('.deeppdf-citation-jump-btn');
			expect(jumpBtn).toBeFalsy();
		});
	});

	describe('getData 方法', () => {
		it('用户消息应该返回数据副本', () => {
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new UserMessage(data);
			const retrievedData = message.getData();

			expect(retrievedData).toEqual(data);
			expect(retrievedData).not.toBe(data); // 应该是副本，不是同一个引用
		});

		it('AI 消息应该返回数据副本', () => {
			const data: MessageData = {
				id: 'msg-2',
				role: 'assistant',
				content: '测试消息',
				timestamp: new Date().toISOString()
			};

			const message = new AIMessage(data);
			const retrievedData = message.getData();

			expect(retrievedData).toEqual(data);
			expect(retrievedData).not.toBe(data);
		});
	});

	describe('时间戳格式化', () => {
		it('应该显示"刚刚"（1分钟内）', () => {
			const now = new Date();
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '测试',
				timestamp: now.toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const timeEl = el?.querySelector('.deeppdf-message-time');
			expect(timeEl?.textContent).toBe('刚刚');
		});

		it('应该显示"X 分钟前"（1小时内）', () => {
			const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '测试',
				timestamp: thirtyMinutesAgo.toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const timeEl = el?.querySelector('.deeppdf-message-time');
			expect(timeEl?.textContent).toContain('分钟前');
		});

		it('应该显示"X 小时前"（1天内）', () => {
			const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
			const data: MessageData = {
				id: 'msg-1',
				role: 'user',
				content: '测试',
				timestamp: twoHoursAgo.toISOString()
			};

			const message = new UserMessage(data);
			const el = message.getElement();
			container.appendChild(el);

			const timeEl = el?.querySelector('.deeppdf-message-time');
			expect(timeEl?.textContent).toContain('小时前');
		});
	});
});
