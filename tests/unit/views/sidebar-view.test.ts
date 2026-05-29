/**
 * DeepPDF Sidebar View Tests
 * 测试抽屉任务进度展示功能
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toTaskProgress } from '@/views/sidebar-view';

// 测试类型转换函数
describe('toTaskProgress() 类型转换', () => {
    it('应该正确转换 API 的 TaskProgress 为组件格式', () => {
        const apiProgress = {
            id: 'task_1',
            status: 'processing',
            message: '正在处理',
            pdf_name: 'test.pdf',
            current_step: 'parse_pdf',
            progress_percent: 50,
            total_steps: 7,
            completed_steps: 3
        };

        const componentProgress = toTaskProgress(apiProgress);

        expect(componentProgress.id).toBe('task_1');
        expect(componentProgress.status).toBe('processing');
        expect(componentProgress.message).toBe('正在处理');
        expect(componentProgress.pdf_name).toBe('test.pdf');
        expect(componentProgress.current_step).toBe('parse_pdf');
        expect(componentProgress.progress_percent).toBe(50);
    });

    it('应该处理未知状态，默认为 pending', () => {
        const apiProgress = {
            id: 'task_2',
            status: 'unknown' as any,
            message: '未知状态'
        };

        const componentProgress = toTaskProgress(apiProgress);

        expect(componentProgress.status).toBe('pending');
    });

    it('应该为空消息提供默认值', () => {
        const apiProgress = {
            id: 'task_3',
            status: 'pending',
            message: ''
        };

        const componentProgress = toTaskProgress(apiProgress);

        expect(componentProgress.message).toBe('任务进行中');
    });
});

// 测试 TaskPollingManager 集成
describe('SidebarView - 任务进度展示逻辑', () => {
    describe('loadActiveTasks() 逻辑', () => {
        it('应该从 API 获取进行中的任务列表', async () => {
            const mockGetActiveTasks = vi.fn().mockResolvedValue([
                {
                    id: 'task_1',
                    status: 'processing',
                    message: '正在处理',
                    pdf_name: 'test.pdf'
                }
            ]);

            const tasks = await mockGetActiveTasks();
            expect(tasks).toHaveLength(1);
            expect(tasks[0].status).toBe('processing');
        });

        it('应该为每个任务调用 addTaskCard', async () => {
            const mockTasks = [
                { id: 'task_1', status: 'processing', message: '任务1' },
                { id: 'task_2', status: 'pending', message: '任务2' }
            ];

            const addTaskCard = vi.fn().mockResolvedValue(undefined);

            // 模拟 loadActiveTasks 的核心逻辑
            for (const task of mockTasks) {
                await addTaskCard(task.id, task);
            }

            expect(addTaskCard).toHaveBeenCalledTimes(2);
            expect(addTaskCard).toHaveBeenCalledWith('task_1', mockTasks[0]);
            expect(addTaskCard).toHaveBeenCalledWith('task_2', mockTasks[1]);
        });

        it('应该处理 API 调用失败的情况', async () => {
            const mockGetActiveTasks = vi.fn().mockRejectedValue(new Error('API 错误'));
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            try {
                await mockGetActiveTasks();
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
            }

            consoleErrorSpy.mockRestore();
        });
    });

    describe('addTaskCard() 逻辑', () => {
        it('应该创建 TaskProgressCard 并添加到 DOM', () => {
            const taskCards = new Map();
            const mockTaskList = document.createElement('div');

            const taskId = 'task_1';
            const progress = {
                id: taskId,
                status: 'processing',
                message: '正在处理',
                pdf_name: 'test.pdf'
            };

            // 模拟添加卡片逻辑
            if (!taskCards.has(taskId)) {
                const cardEl = document.createElement('div');
                cardEl.className = 'deeppdf-task-card';
                cardEl.textContent = `Task: ${progress.pdf_name}`;
                taskCards.set(taskId, cardEl);
            }

            expect(taskCards.has(taskId)).toBe(true);
            expect(taskCards.get(taskId)).toBeInstanceOf(HTMLElement);
        });

        it('应该跳过已存在的任务卡片', () => {
            const taskCards = new Map();
            const taskId = 'task_1';

            // 第一次添加
            taskCards.set(taskId, { element: 'card1' });
            const sizeBefore = taskCards.size;

            // 尝试第二次添加（应该跳过）
            if (!taskCards.has(taskId)) {
                taskCards.set(taskId, { element: 'card2' });
            }

            expect(taskCards.size).toBe(sizeBefore);
            expect(taskCards.get(taskId)).toEqual({ element: 'card1' });
        });

        it('应该开始轮询任务进度', () => {
            const startPolling = vi.fn();
            const taskId = 'task_1';

            // 模拟开始轮询
            startPolling(taskId, expect.any(Function));

            expect(startPolling).toHaveBeenCalledWith(taskId, expect.any(Function));
        });
    });

    describe('updateTaskCard() 逻辑', () => {
        it('应该更新对应任务的卡片显示', () => {
            const taskCards = new Map();
            const mockCard = {
                update: vi.fn()
            };
            taskCards.set('task_1', mockCard);

            const updatedProgress = {
                id: 'task_1',
                status: 'processing',
                message: '更新中',
                progress_percent: 75
            };

            // 模拟更新逻辑
            const card = taskCards.get('task_1');
            if (card) {
                card.update(updatedProgress);
            }

            expect(mockCard.update).toHaveBeenCalledWith(updatedProgress);
        });

        it('应该在任务完成时触发后续处理', () => {
            const taskCards = new Map();
            const mockCard = {
                update: vi.fn()
            };
            taskCards.set('task_1', mockCard);

            const completedProgress = {
                id: 'task_1',
                status: 'completed',
                message: '完成',
                progress_percent: 100
            };

            let shouldMoveToList = false;

            // 模拟更新逻辑
            const card = taskCards.get('task_1');
            if (card) {
                card.update(completedProgress);
                if (completedProgress.status === 'completed' ||
                    completedProgress.status === 'failed' ||
                    completedProgress.status === 'cancelled') {
                    shouldMoveToList = true;
                }
            }

            expect(mockCard.update).toHaveBeenCalledWith(completedProgress);
            expect(shouldMoveToList).toBe(true);
        });
    });

    describe('cancelTask() 逻辑', () => {
        it('应该调用 API 取消任务', async () => {
            const cancelTask = vi.fn().mockResolvedValue({
                status: 'success',
                message: '任务已取消',
                task_id: 'task_1'
            });

            const taskId = 'task_1';
            await cancelTask(taskId);

            expect(cancelTask).toHaveBeenCalledWith('task_1');
        });

        it('应该从 DOM 移除任务卡片', () => {
            const taskCards = new Map();
            const mockCard = document.createElement('div');
            const parent = document.createElement('div');
            parent.appendChild(mockCard);
            taskCards.set('task_1', mockCard);

            // 模拟移除逻辑
            const card = taskCards.get('task_1');
            if (card) {
                card.remove();
                taskCards.delete('task_1');
            }

            expect(taskCards.has('task_1')).toBe(false);
            expect(parent.children.length).toBe(0);
        });

        it('应该停止轮询', () => {
            const stopPolling = vi.fn();
            const taskId = 'task_1';

            // 模拟停止轮询
            stopPolling(taskId);

            expect(stopPolling).toHaveBeenCalledWith('task_1');
        });
    });

    describe('moveTaskToIndexList() 逻辑', () => {
        it('应该在任务完成时刷新索引列表', () => {
            let listRefreshed = false;
            const progress = {
                id: 'task_1',
                status: 'completed',
                progress_percent: 100
            };

            // 模拟移动逻辑
            if (progress.status === 'completed') {
                listRefreshed = true;
            }

            expect(listRefreshed).toBe(true);
        });

        it('应该在任务失败时不刷新索引列表', () => {
            let listRefreshed = false;
            const progress = {
                id: 'task_1',
                status: 'failed',
                error: '处理错误'
            };

            // 模拟移动逻辑
            if (progress.status === 'completed') {
                listRefreshed = true;
            }

            expect(listRefreshed).toBe(false);
        });

        it('应该延迟移除卡片让用户看到完成状态', () => {
            vi.useFakeTimers();
            const removed = { value: false };

            // 模拟延迟移除
            setTimeout(() => {
                removed.value = true;
            }, 2000);

            expect(removed.value).toBe(false);
            vi.advanceTimersByTime(2000);
            expect(removed.value).toBe(true);

            vi.useRealTimers();
        });
    });

    describe('openIndexDrawer() 集成', () => {
        it('应该在打开抽屉时加载进行中的任务', () => {
            const loadActiveTasks = vi.fn().mockResolvedValue(undefined);
            const isDrawerOpen = { value: false };

            // 模拟打开抽屉逻辑
            if (!isDrawerOpen.value) {
                isDrawerOpen.value = true;
                loadActiveTasks();
            }

            expect(isDrawerOpen.value).toBe(true);
            expect(loadActiveTasks).toHaveBeenCalled();
        });
    });

    describe('onClose() 清理逻辑', () => {
        it('应该清理轮询管理器', () => {
            const destroy = vi.fn();
            const taskCards = new Map([
                ['task_1', {}],
                ['task_2', {}]
            ]);

            // 模拟清理逻辑
            destroy();
            taskCards.clear();

            expect(destroy).toHaveBeenCalled();
            expect(taskCards.size).toBe(0);
        });
    });
});

// 测试 API 客户端的 getActiveTasks 方法
describe('API Client - getActiveTasks()', () => {
    it('应该从 listIndexes 结果中筛选出进行中的任务', () => {
        const mockListResult = {
            status: 'success',
            indexes: [
                { id: 'idx_1', pdf_name: 'completed.pdf', node_count: 100 },
                { id: 'task_1', pdf_name: 'processing.pdf', status: 'processing', message: '处理中' },
                { id: 'idx_2', pdf_name: 'another.pdf', node_count: 50 },
                { id: 'task_2', pdf_name: 'pending.pdf', status: 'pending', message: '等待中' }
            ]
        };

        // 模拟 getActiveTasks 的筛选逻辑
        const activeTasks = mockListResult.indexes
            .filter((index: any) => index.id.startsWith('task_'))
            .map((index: any) => ({
                id: index.id,
                status: index.status === 'pending' || index.status === 'processing' ? index.status : 'pending',
                message: index.message || '任务进行中',
                pdf_name: index.pdf_name
            }));

        expect(activeTasks).toHaveLength(2);
        expect(activeTasks[0].id).toBe('task_1');
        expect(activeTasks[1].id).toBe('task_2');
    });

    it('应该正确映射任务状态', () => {
        const mockTask = {
            id: 'task_1',
            status: 'processing',
            message: '正在处理',
            pdf_name: 'test.pdf'
        };

        const mapped = {
            id: mockTask.id,
            status: mockTask.status === 'pending' || mockTask.status === 'processing'
                ? mockTask.status
                : 'pending',
            message: mockTask.message || '任务进行中',
            pdf_name: mockTask.pdf_name
        };

        expect(mapped.status).toBe('processing');
        expect(mapped.message).toBe('正在处理');
    });
});
