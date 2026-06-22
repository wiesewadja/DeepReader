import { describe, it, expect } from 'vitest';
import { App } from 'obsidian';
import { isViewportFullyExpanded } from '@/components/reading-mode/viewport-state';

describe('isViewportFullyExpanded', () => {
	it('should return true when rootSplit has 1 child and both sidebars are collapsed', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}] },
				leftSplit: { collapsed: true },
				rightSplit: { collapsed: true },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(true);
	});

	it('should return false when rootSplit has multiple children', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}, {}] },
				leftSplit: { collapsed: true },
				rightSplit: { collapsed: true },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});

	it('should return false when left sidebar is not collapsed', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}] },
				leftSplit: { collapsed: false },
				rightSplit: { collapsed: true },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});

	it('should return false when right sidebar is not collapsed', () => {
		const mockApp = {
			workspace: {
				rootSplit: { children: [{}] },
				leftSplit: { collapsed: true },
				rightSplit: { collapsed: false },
			},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});

	it('should return false if workspace or split objects are missing', () => {
		const mockApp = {
			workspace: {},
		} as unknown as App;

		expect(isViewportFullyExpanded(mockApp)).toBe(false);
	});
});
