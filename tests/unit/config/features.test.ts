import { describe, it, expect } from 'vitest';
import { ZLIBRARY_ENABLED, INDEX_TRACE_ENABLED } from '@/config/features';

describe('features.ts', () => {
	it('ZLIBRARY_ENABLED should be boolean', () => {
		expect(typeof ZLIBRARY_ENABLED).toBe('boolean');
	});

	it('INDEX_TRACE_ENABLED should be boolean', () => {
		expect(typeof INDEX_TRACE_ENABLED).toBe('boolean');
	});

	it('ZLIBRARY_ENABLED should be true in dev', () => {
		expect(ZLIBRARY_ENABLED).toBe(true);
	});

	it('INDEX_TRACE_ENABLED should be true in dev', () => {
		expect(INDEX_TRACE_ENABLED).toBe(true);
	});
});
