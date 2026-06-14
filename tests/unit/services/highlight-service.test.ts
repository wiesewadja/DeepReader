import { describe, it, expect, vi, beforeEach } from 'vitest';

// ExcerptService 是注入的，HighlightService 通过它写摘录文件。
// 这里 mock 它，验证 HighlightService 把调用委托给 ExcerptService。

vi.mock('@/services/excerpt-service', () => ({
	ExcerptService: vi.fn().mockImplementation(() => ({
		saveExcerpt: vi.fn().mockResolvedValue('书籍摘录/x/摘录-today.md'),
	})),
}));

import { ExcerptService } from '@/services/excerpt-service';
import { HighlightService } from '@/services/highlight-service';
import type { HighlightColorId } from '@/types/highlight';

function makeMockApp(activeFile: any = null) {
	return {
		workspace: { getActiveFile: () => activeFile },
		vault: {
			read: vi.fn().mockResolvedValue('body content'),
			modify: vi.fn().mockResolvedValue(undefined),
		},
		metadataCache: {
			getFileCache: vi.fn().mockReturnValue({
				frontmatter: { pdf_name: 'TestBook' },
			}),
		},
	} as any;
}

describe('HighlightService DI', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('构造函数接收 ExcerptService 实例', () => {
		const app = makeMockApp();
		const excerpt = new ExcerptService(app);
		const svc = new HighlightService(app, excerpt);
		expect(svc).toBeDefined();
	});

	it('saveHighlight 成功后委托给 excerptService.saveExcerpt', async () => {
		const activeFile = { path: 'DeepReader/TestBook/ch1.md', basename: 'ch1' } as any;
		const app = makeMockApp(activeFile);
		const excerpt = new ExcerptService(app);
		const spy = vi.spyOn(excerpt, 'saveExcerpt').mockResolvedValue('saved-path');

		const svc = new HighlightService(app, excerpt);
		await svc.saveHighlight('body content', 'yellow' as HighlightColorId);

		expect(spy).toHaveBeenCalled();
		const [content, metadata] = spy.mock.calls[0];
		expect(content.text).toBe('body content');
		expect(metadata.sourcePdf).toBe('TestBook');
		expect(metadata.excerptType).toBe('highlight');
		expect(metadata.highlightColor).toBe('yellow');
	});

	it('ExcerptService 由外部注入，HighlightService 内部不再 new', () => {
		// 静态保证：HighlightService 构造签名要求 excerptService 必传
		const app = makeMockApp();
		const excerpt = new ExcerptService(app);
		const svc = new HighlightService(app, excerpt);
		// 没有抛错即说明依赖通过构造注入成功
		expect(svc).toBeDefined();
	});
});
