/**
 * TaskProgressCard 组件测试
 * 测试任务进度卡片的渲染和更新功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskProgressCard } from '../../src/components/task-progress-card';
import { TaskProgress, STEP_CONFIG } from '../../src/types/index';

describe('TaskProgressCard 组件', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        container.remove();
    });

    describe('处理中状态', () => {
        it('应该渲染处理中的任务卡片', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '正在处理...',
                pdf_name: 'test.pdf',
                current_step: 'parse_pdf',
                progress_percent: 55
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            expect(el).toBeTruthy();
            expect(el?.classList.contains('deeppdf-task-card')).toBe(true);
        });

        it('应该显示 PDF 名称', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '正在处理...',
                pdf_name: 'my-document.pdf',
                progress_percent: 30
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const nameEl = el?.querySelector('.deeppdf-task-name');
            expect(nameEl?.textContent).toContain('my-document.pdf');
        });

        it('应该显示进度条和百分比', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                current_step: 'parse_pdf',
                progress_percent: 75
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const progressFill = el?.querySelector('.deeppdf-task-progress-fill');
            expect(progressFill?.style.width).toBe('75%');

            const progressText = el?.querySelector('.deeppdf-task-progress-text');
            expect(progressText?.textContent).toContain('75%');
        });

        it('应该显示当前步骤信息', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                current_step: 'parse_pdf',
                progress_percent: 50
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const progressText = el?.querySelector('.deeppdf-task-progress-text');
            expect(progressText?.textContent).toContain('📄 解析 PDF');
        });

        it('应该有取消按钮', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                progress_percent: 10
            };

            let cancelClicked = false;
            const card = new TaskProgressCard(progress, () => {
                cancelClicked = true;
            });
            const el = card.getElement();
            container.appendChild(el);

            const cancelBtn = el?.querySelector('button');
            expect(cancelBtn).toBeTruthy();
            expect(cancelBtn?.textContent).toContain('取消');

            // 测试点击事件
            cancelBtn?.click();
            expect(cancelClicked).toBe(true);
        });

        it('应该使用默认步骤处理未知步骤', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                current_step: 'unknown_step',
                progress_percent: 5
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const progressText = el?.querySelector('.deeppdf-task-progress-text');
            // 应该使用 start 步骤的配置作为默认
            expect(progressText?.textContent).toContain('🚀');
        });
    });

    describe('已完成状态', () => {
        it('应该渲染已完成的任务卡片', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'completed',
                message: '完成',
                pdf_name: 'done.pdf',
                progress_percent: 100
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            expect(el?.classList.contains('deeppdf-task-card-completed')).toBe(true);
        });

        it('应该显示完成状态和成功图标', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'completed',
                message: '完成',
                pdf_name: 'done.pdf',
                progress_percent: 100
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const nameEl = el?.querySelector('.deeppdf-task-name');
            expect(nameEl?.textContent).toContain('✅');

            const statusEl = el?.querySelector('.deeppdf-task-status');
            expect(statusEl?.textContent).toBe('索引创建完成');
        });
    });

    describe('失败状态', () => {
        it('应该渲染失败的任务卡片', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'failed',
                message: '失败',
                pdf_name: 'failed.pdf',
                error: 'PDF 文件损坏'
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            expect(el?.classList.contains('deeppdf-task-card-failed')).toBe(true);
        });

        it('应该显示错误信息', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'failed',
                message: '失败',
                pdf_name: 'failed.pdf',
                error: '连接超时'
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const nameEl = el?.querySelector('.deeppdf-task-name');
            expect(nameEl?.textContent).toContain('❌');

            const errorEl = el?.querySelector('.deeppdf-task-error');
            expect(errorEl?.textContent).toContain('连接超时');
        });

        it('应该有重试按钮', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'failed',
                message: '失败',
                pdf_name: 'failed.pdf',
                error: '未知错误'
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const retryBtn = el?.querySelector('button');
            expect(retryBtn).toBeTruthy();
            expect(retryBtn?.textContent).toContain('🔄 重试');
        });
    });

    describe('更新功能', () => {
        it('应该能够更新任务状态', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                progress_percent: 30
            };

            const card = new TaskProgressCard(progress);
            let el = card.getElement();
            container.appendChild(el);

            // 验证初始状态
            let progressFill = el?.querySelector('.deeppdf-task-progress-fill');
            expect(progressFill?.style.width).toBe('30%');

            // 更新进度
            progress.progress_percent = 60;
            progress.current_step = 'store_chromadb';
            card.update(progress);

            // 验证更新后的状态
            el = card.getElement();
            progressFill = el?.querySelector('.deeppdf-task-progress-fill');
            expect(progressFill?.style.width).toBe('60%');
        });

        it('应该能够从处理中更新为已完成', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                progress_percent: 90
            };

            const card = new TaskProgressCard(progress);
            let el = card.getElement();
            container.appendChild(el);

            // 更新为完成状态
            progress.status = 'completed';
            progress.progress_percent = 100;
            card.update(progress);

            // 验证状态变化
            el = card.getElement();
            expect(el?.classList.contains('deeppdf-task-card-completed')).toBe(true);
            expect(el?.classList.contains('deeppdf-task-card')).toBe(true);
        });

        it('应该能够从处理中更新为失败', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                progress_percent: 50
            };

            const card = new TaskProgressCard(progress);
            let el = card.getElement();
            container.appendChild(el);

            // 更新为失败状态
            progress.status = 'failed';
            progress.error = '处理错误';
            card.update(progress);

            // 验证状态变化
            el = card.getElement();
            expect(el?.classList.contains('deeppdf-task-card-failed')).toBe(true);
        });
    });

    describe('边界情况', () => {
        it('应该处理缺失的 pdf_name', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                progress_percent: 50
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const nameEl = el?.querySelector('.deeppdf-task-name');
            expect(nameEl?.textContent).toContain('未知文件');
        });

        it('应该处理缺失的 progress_percent', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf'
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const progressFill = el?.querySelector('.deeppdf-task-progress-fill');
            expect(progressFill?.style.width).toBe('0%');
        });

        it('应该处理缺失的 current_step', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: 'file.pdf',
                progress_percent: 10
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const progressText = el?.querySelector('.deeppdf-task-progress-text');
            expect(progressText?.textContent).toContain('🚀 任务开始');
        });

        it('应该处理缺失的错误信息', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'failed',
                message: '失败',
                pdf_name: 'file.pdf'
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const errorEl = el?.querySelector('.deeppdf-task-error');
            expect(errorEl?.textContent).toContain('未知错误');
        });
    });

    describe('HTML 转义', () => {
        it('应该转义 PDF 名称中的 HTML 特殊字符', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'processing',
                message: '处理中',
                pdf_name: '<script>alert("xss")</script>.pdf',
                progress_percent: 50
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const nameEl = el?.querySelector('.deeppdf-task-name');
            expect(nameEl?.innerHTML).not.toContain('<script>');
        });

        it('应该转义错误信息中的 HTML 特殊字符', () => {
            const progress: TaskProgress = {
                id: 'task-1',
                status: 'failed',
                message: '失败',
                pdf_name: 'file.pdf',
                error: '<img src=x onerror="alert(1)">'
            };

            const card = new TaskProgressCard(progress);
            const el = card.getElement();
            container.appendChild(el);

            const errorEl = el?.querySelector('.deeppdf-task-error');
            expect(errorEl?.innerHTML).not.toContain('<img');
        });
    });
});

describe('STEP_CONFIG 常量', () => {
    it('应该包含所有必需的步骤', () => {
        const requiredSteps = ['start', 'init_pageindex', 'create_llm_client', 'parse_pdf', 'store_chromadb', 'save_metadata', 'completed'];

        requiredSteps.forEach(step => {
            expect(STEP_CONFIG[step]).toBeDefined();
        });
    });

    it('每个步骤应该有正确的属性', () => {
        Object.entries(STEP_CONFIG).forEach(([step, config]) => {
            expect(config.label).toBeTruthy();
            expect(config.icon).toBeTruthy();
            expect(typeof config.minPercent).toBe('number');
            expect(typeof config.maxPercent).toBe('number');
            expect(config.minPercent).toBeLessThan(config.maxPercent);
        });
    });

    it('步骤进度应该正确衔接', () => {
        const steps = Object.values(STEP_CONFIG);
        for (let i = 0; i < steps.length - 1; i++) {
            const current = steps[i];
            const next = steps[i + 1];
            expect(current.maxPercent).toBe(next.minPercent);
        }
    });
});
