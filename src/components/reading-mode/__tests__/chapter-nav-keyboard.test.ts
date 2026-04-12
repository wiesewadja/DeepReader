import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChapterNav } from '../chapter-nav.js';
import type { App, TFile } from 'obsidian';

describe('ChapterNav Keyboard Navigation', () => {
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
            prevPage: vi.fn(() => true)
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
    
    it('should not respond to ArrowLeft when paginator is not active', () => {
        mockPaginator.isActive.mockReturnValue(false);
        
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });
        
        document.dispatchEvent(event);
        
        expect(mockOnNavigatePrev).toHaveBeenCalled();
        expect(mockPaginator.prevPage).not.toHaveBeenCalled();
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
    
    it('should not respond when modal is open', () => {
        const modal = document.createElement('div');
        modal.className = 'modal-container';
        document.body.appendChild(modal);
        
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });
        
        document.dispatchEvent(event);
        
        expect(mockPaginator.prevPage).not.toHaveBeenCalled();
        
        modal.remove();
    });
    
    it('should not respond when focus is on input element', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        
        const event = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            bubbles: true
        });
        
        document.dispatchEvent(event);
        
        expect(mockPaginator.prevPage).not.toHaveBeenCalled();
        
        input.remove();
    });
    
    it('should not respond to ArrowLeft with modifier keys', () => {
        const eventCtrl = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            ctrlKey: true,
            bubbles: true
        });
        
        const eventMeta = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            metaKey: true,
            bubbles: true
        });
        
        const eventShift = new KeyboardEvent('keydown', {
            key: 'ArrowLeft',
            shiftKey: true,
            bubbles: true
        });
        
        document.dispatchEvent(eventCtrl);
        document.dispatchEvent(eventMeta);
        document.dispatchEvent(eventShift);
        
        expect(mockPaginator.prevPage).not.toHaveBeenCalled();
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
});