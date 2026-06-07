import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChapterNav } from '@/components/reading-mode/chapter-nav';
import type { App, TFile } from 'obsidian';

describe('ChapterNav - Pure Keyboard Navigation (No UI)', () => {
    let chapterNav: ChapterNav;
    let mockPaginator: any;
    let mockOnNavigatePrev: any;
    let mockOnNavigateNext: any;
    let container: HTMLElement;
    
    beforeEach(() => {
        container = document.createElement('div');
        container.className = 'deeppdf-reading-mode';
        document.body.appendChild(container);
        
        mockPaginator = {
            isActive: vi.fn(() => true),
            nextPage: vi.fn(() => true),
            prevPage: vi.fn(() => true),
            getCurrentPage: vi.fn(() => 2),
            getTotalPages: vi.fn(() => 5),
            isAtFirstPage: vi.fn(() => false),
            isAtLastPage: vi.fn(() => false),
        };
        
        mockOnNavigatePrev = vi.fn(async () => true);
        mockOnNavigateNext = vi.fn(async () => true);
        
        const mockApp = {} as App;
        
        chapterNav = new ChapterNav({
            app: mockApp,
            onNavigatePrev: mockOnNavigatePrev,
            onNavigateNext: mockOnNavigateNext,
            getNavigation: vi.fn(() => ({
                prev: null,
                next: null,
                currentIndex: 1,
                total: 10
            })),
            getPaginator: vi.fn(() => mockPaginator)
        });
        
        chapterNav.init();
    });
    
    afterEach(() => {
        chapterNav.destroy();
        container.remove();
    });
    
    it('should NOT create UI elements in init()', () => {
        const navElement = document.querySelector('.deeppdf-chapter-nav');
        expect(navElement).toBeNull();
    });
    
    it('should call paginator.prevPage when ArrowLeft is pressed in reading mode', () => {
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });
        
        document.dispatchEvent(event);
        
        expect(mockPaginator.isActive).toHaveBeenCalled();
        expect(mockPaginator.prevPage).toHaveBeenCalled();
        expect(mockOnNavigatePrev).not.toHaveBeenCalled();
    });
    
    it('should call paginator.nextPage when ArrowRight is pressed in reading mode', () => {
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });
        
        document.dispatchEvent(event);
        
        expect(mockPaginator.isActive).toHaveBeenCalled();
        expect(mockPaginator.nextPage).toHaveBeenCalled();
        expect(mockOnNavigateNext).not.toHaveBeenCalled();
    });
    
    it('should not respond to keyboard when not in reading mode', () => {
        container.classList.remove('deeppdf-reading-mode');
        
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });
        
        document.dispatchEvent(event);
        
        expect(mockPaginator.prevPage).not.toHaveBeenCalled();
        expect(mockOnNavigatePrev).not.toHaveBeenCalled();
    });
    
    it('should prevent default scroll behavior on ArrowLeft', () => {
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true,
            cancelable: true
        });
        
        document.dispatchEvent(event);
        
        expect(event.defaultPrevented).toBe(true);
    });
    
    it('should prevent default scroll behavior on ArrowRight', () => {
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true,
            cancelable: true
        });
        
        document.dispatchEvent(event);
        
        expect(event.defaultPrevented).toBe(true);
    });
    
    it('should clean up keyboard listener on destroy()', () => {
        chapterNav.destroy();
        
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });
        
        document.dispatchEvent(event);
        
        expect(mockPaginator.nextPage).not.toHaveBeenCalled();
    });
    
    it('should rely on chapter file internal navigation links instead of UI buttons', () => {
        // ChapterNav should not create UI buttons
        const buttons = document.querySelectorAll('.deeppdf-nav-btn');
        expect(buttons.length).toBe(0);

        // Keyboard navigation should still work
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });

        document.dispatchEvent(event);

        expect(mockPaginator.nextPage).toHaveBeenCalled();
    });

    // ========================================================================
    // 新增：基于 isAtFirstPage / isAtLastPage 的边界路由
    // 修复 bug：smooth scroll 滞后导致 _currentPage 与真实滚动位置发散，
    // 章节末页按 → 会被 nextPage() 内部判定继续翻页（实际触发跨章 + 回退）
    // ========================================================================

    it('At last page, ArrowRight calls onNavigateNext (not nextPage)', () => {
        mockPaginator.isAtLastPage.mockReturnValue(true);
        mockPaginator.isAtFirstPage.mockReturnValue(false);

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: false, metaKey: false, shiftKey: false,
            bubbles: true,
        }));

        expect(mockOnNavigateNext).toHaveBeenCalled();
        expect(mockPaginator.nextPage).not.toHaveBeenCalled();
    });

    it('At first page, ArrowLeft calls onNavigatePrev (not prevPage)', () => {
        mockPaginator.isAtFirstPage.mockReturnValue(true);
        mockPaginator.isAtLastPage.mockReturnValue(false);

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false, metaKey: false, shiftKey: false,
            bubbles: true,
        }));

        expect(mockOnNavigatePrev).toHaveBeenCalled();
        expect(mockPaginator.prevPage).not.toHaveBeenCalled();
    });

    it('Stale _currentPage should NOT cause wrong routing (key regression)', () => {
        // 关键回归：核心 bug 重现
        // 真实场景：DOM 仍在末页，但 _currentPage 缓存还停在 N-1
        // 修复后：路由只看 isAtFirstPage / isAtLastPage，不应再读 getCurrentPage/getTotalPages
        const localPaginator: any = {
            isActive: vi.fn(() => true),
            nextPage: vi.fn(() => true),
            prevPage: vi.fn(() => true),
            isAtFirstPage: vi.fn(() => false),
            isAtLastPage: vi.fn(() => false),   // 不在末页 → 应翻页
        };
        chapterNav.destroy();
        chapterNav = new ChapterNav({
            app: {} as App,
            onNavigatePrev: mockOnNavigatePrev,
            onNavigateNext: mockOnNavigateNext,
            getNavigation: vi.fn(() => ({ prev: null, next: null, currentIndex: 1, total: 10 })),
            getPaginator: vi.fn(() => localPaginator),
        });
        chapterNav.init();

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: false, metaKey: false, shiftKey: false,
            bubbles: true,
        }));

        // 不暴露 getCurrentPage/getTotalPages 也应走 nextPage 分支
        expect(localPaginator.nextPage).toHaveBeenCalled();
        expect(mockOnNavigateNext).not.toHaveBeenCalled();
    });

    it('isAtLastPage false but isAtFirstPage true: ArrowRight calls nextPage, ArrowLeft calls onNavigatePrev', () => {
        mockPaginator.isAtFirstPage.mockReturnValue(true);
        mockPaginator.isAtLastPage.mockReturnValue(false);

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            ctrlKey: false, metaKey: false, shiftKey: false,
            bubbles: true,
        }));
        expect(mockPaginator.nextPage).toHaveBeenCalled();
        expect(mockOnNavigateNext).not.toHaveBeenCalled();

        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false, metaKey: false, shiftKey: false,
            bubbles: true,
        }));
        expect(mockOnNavigatePrev).toHaveBeenCalled();
        expect(mockPaginator.prevPage).not.toHaveBeenCalled();
    });
});