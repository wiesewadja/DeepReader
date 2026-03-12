/**
 * HumanizedAgentView - 拟人化 Agent 状态视图
 *
 * 展示像真人一样的阅读、思考、回答过程
 */

import type { HumanizedProgress, ReadingProgressItem, AgentAction } from './humanized-types';

/**
 * 创建拟人化状态元素
 */
export function createHumanizedStatusElement(progress: HumanizedProgress): HTMLElement {
	const container = document.createElement('div');
	container.className = 'deepreader-agent-humanized';

	// 主动作区域
	const actionArea = container.createDiv({ cls: 'agent-action-area' });
	renderMainAction(actionArea, progress.mainAction);

	// 阅读进度（如果有）
	if (progress.readingSteps.length > 0) {
		const readingArea = container.createDiv({ cls: 'agent-reading-area' });
		renderReadingProgress(readingArea, progress.readingSteps, progress.overallProgress);
	}

	// 思考气泡（如果有）
	if (progress.thoughtBubble) {
		const thoughtArea = container.createDiv({ cls: 'agent-thought-bubble' });
		thoughtArea.createSpan({ cls: 'thought-icon', text: '💭' });
		thoughtArea.createSpan({ cls: 'thought-text', text: progress.thoughtBubble });
	}

	// 生成内容（如果有）
	if (progress.generatedContent) {
		const contentArea = container.createDiv({ cls: 'agent-content-area' });
		renderGeneratedContent(contentArea, progress.generatedContent);
	}

	return container;
}

/**
 * 渲染主动作
 */
function renderMainAction(container: HTMLElement, action: AgentAction): void {
	const icons: Record<string, string> = {
		reading: '📖',
		searching: '🔍',
		thinking: '🧠',
		writing: '📝',
		waiting: '⏳',
	};

	const icon = icons[action.type] || '🔄';

	container.createSpan({ cls: 'action-icon', text: icon });

	const textSpan = container.createSpan({ cls: 'action-text' });

	// 根据动作类型添加动画效果
	if (action.type === 'reading') {
		textSpan.innerHTML = `<span class="typing-text">${escapeHtml(action.detail)}</span>`;
	} else if (action.type === 'thinking') {
		textSpan.innerHTML = `<span class="thinking-text">${escapeHtml(action.detail)}</span>`;
	} else {
		textSpan.textContent = action.detail;
	}
}

/**
 * 渲染阅读进度
 */
function renderReadingProgress(
	container: HTMLElement,
	steps: ReadingProgressItem[],
	overallProgress: number
): void {
	// 标题
	const title = container.createDiv({ cls: 'reading-title' });
	title.createSpan({ text: '📖 阅读书籍中...' });

	// 步骤列表
	const stepsList = container.createDiv({ cls: 'reading-steps' });

	for (const step of steps) {
		const stepItem = stepsList.createDiv({ cls: `step-item step-${step.status}` });

		// 状态图标
		const statusIcon =
			step.status === 'done' ? ' ✓' : step.status === 'current' ? ' ◌' : ' ○';
		stepItem.createSpan({ cls: 'step-status', text: statusIcon });

		// 动作描述
		stepItem.createSpan({ cls: 'step-action', text: ` ${step.action}` });

		// 耗时（已完成时显示）
		if (step.duration && step.status === 'done') {
			const duration =
				step.duration < 1000
					? `${step.duration}ms`
					: `${(step.duration / 1000).toFixed(1)}s`;
			stepItem.createSpan({ cls: 'step-duration', text: ` ${duration}` });
		}
	}

	// 进度条
	const progressBar = container.createDiv({ cls: 'progress-bar-container' });
	const bar = progressBar.createDiv({ cls: 'progress-bar' });
	bar.style.setProperty('--progress', `${overallProgress}%`);

	const progressText = progressBar.createSpan({ cls: 'progress-text' });
	progressText.textContent = `${Math.round(overallProgress)}%`;
}

/**
 * 渲染生成内容
 */
function renderGeneratedContent(container: HTMLElement, content: string): void {
	const title = container.createDiv({ cls: 'content-title' });
	title.createSpan({ text: '📝 整理回答中...' });

	const contentBox = container.createDiv({ cls: 'content-box' });

	// 内容预览（最多显示前 300 字符）
	const preview =
		content.length > 300 ? content.slice(0, 300) + '...' : content;

	contentBox.textContent = preview;

	// 添加流式动画效果
	contentBox.addClass('streaming');
}

/**
 * 更新现有元素（用于流式更新）
 */
export function updateHumanizedStatusElement(
	element: HTMLElement,
	progress: HumanizedProgress
): void {
	// 清空并重新渲染
	element.empty();
	const newElement = createHumanizedStatusElement(progress);

	// 复制子元素
	while (newElement.firstChild) {
		element.appendChild(newElement.firstChild);
	}
}

/**
 * 转义 HTML 特殊字符
 */
function escapeHtml(text: string): string {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}
