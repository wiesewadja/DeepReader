/**
 * DeepPDF 追问问题卡片组件
 * 显示可点击的追问问题列表
 */

import { FollowUpQuestion } from '../message/message.js';

/**
 * 追问问题组件选项
 */
export interface FollowUpQuestionsOptions {
	/** 问题列表 */
	questions: FollowUpQuestion[];
	/** 点击问题的回调 */
	onQuestionClick?: (question: string) => void;
}

/**
 * 追问问题卡片组件
 */
export class FollowUpQuestions {
	private el: HTMLElement;
	private options: FollowUpQuestionsOptions;

	constructor(options: FollowUpQuestionsOptions) {
		this.options = options;
		this.el = this.render();
	}

	private render(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'deeppdf-followup-questions';

		// 标题
		const header = document.createElement('div');
		header.className = 'deeppdf-followup-header';
		header.innerHTML = `<span class="deeppdf-followup-icon">💭</span> 继续探索`;
		container.appendChild(header);

		// 问题列表
		const questionsList = document.createElement('div');
		questionsList.className = 'deeppdf-followup-list';

		this.options.questions.forEach((q) => {
			const questionCard = document.createElement('div');
			questionCard.className = 'deeppdf-followup-card';
			questionCard.textContent = q.question;

			// 点击事件
			questionCard.addEventListener('click', () => {
				this.options.onQuestionClick?.(q.question);
			});

			// 悬停效果
			questionCard.addEventListener('mouseenter', () => {
				questionCard.addClass('deeppdf-followup-card-hover');
			});
			questionCard.addEventListener('mouseleave', () => {
				questionCard.removeClass('deeppdf-followup-card-hover');
			});

			questionsList.appendChild(questionCard);
		});

		container.appendChild(questionsList);
		return container;
	}

	getElement(): HTMLElement {
		return this.el;
	}
}
