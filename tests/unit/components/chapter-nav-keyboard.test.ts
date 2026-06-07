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
});