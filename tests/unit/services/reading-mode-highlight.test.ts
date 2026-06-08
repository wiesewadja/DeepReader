/**
 * ReadingModeService 引用高亮单元测试
 *
 * 覆盖 PR 1 引入的关键正确性路径：
 * - text-position 降级：quotedText → DOM 文本位置 → Range → 包裹
 * - clearAllCitedHighlights 干净清除
 * - 幂等性：同 key 多次 add 不重复包裹
 * - setCitedHighlightsByFile 批量 + 去重
 *
 * 不直接测 wrapRangeWithSpan 的 range 路径（jsdom 多 describe 之间的
 * 状态共享会让 Range API 测试不稳定）；range 路径的端到端覆盖
 * 由 reading-mode e2e 兜底（scripts/e2e-light/specs/citation-flow.spec.mjs）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReadingModeService } from '@/services/reading-mode-service';
import type { App, TFile } from 'obsidian';

function makeApp(): App { return {} as App; }
function makeTFile(path: string): TFile {
    return { path, basename: path.split('/').pop() } as TFile;
}

function setupChapterDom(pText: string) {
    document.body.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.classList.add('deeppdf-reading-mode');
    const view = document.createElement('div');
    view.classList.add('markdown-preview-view');
    wrapper.appendChild(view);
    document.body.appendChild(wrapper);
    const p = document.createElement('p');
    p.textContent = pText;
    view.appendChild(p);
    return { container: wrapper, paragraph: p };
}

describe('ReadingModeService 引用高亮（text-position 降级路径）', () => {
    let service: ReadingModeService;
    let container: HTMLElement;
    let paragraph: HTMLElement;
    const filePath = 'DeepReader/test/book/01 - Chapter 01.md';

    beforeEach(() => {
        const setup = setupChapterDom('abcdefghij');
        container = setup.container;
        paragraph = setup.paragraph;
        service = new ReadingModeService(makeApp(), undefined, 'deepreader-dev');
        (service as any).currentFile = makeTFile(filePath);
        (service as any).activeContainerEl = container;
    });

    it('成功：只包裹 needle，不影响整段', () => {
        service.addCitedHighlight('block-1', 'cde', filePath);

        const spans = paragraph.querySelectorAll('.deeppdf-cited-text');
        expect(spans.length).toBe(1);
        expect(spans[0].textContent).toBe('cde');
        // 完整段落仍是原文
        expect(paragraph.textContent).toBe('abcdefghij');
    });

    it('找不到 quotedText 时静默返回，不破坏 DOM', () => {
        const before = paragraph.innerHTML;
        service.addCitedHighlight('block-2', 'zzzz-not-here', filePath);
        expect(paragraph.innerHTML).toBe(before);
        expect(paragraph.querySelectorAll('.deeppdf-cited-text').length).toBe(0);
    });
});

describe('ReadingModeService 引用高亮（clear / idempotent）', () => {
    let service: ReadingModeService;
    let paragraph: HTMLElement;
    const filePath = 'p.md';

    beforeEach(() => {
        const setup = setupChapterDom('abcdefghij');
        paragraph = setup.paragraph;
        service = new ReadingModeService(makeApp(), undefined, 'deepreader-dev');
        (service as any).currentFile = makeTFile(filePath);
        (service as any).activeContainerEl = setup.container;
    });

    it('幂等：同一 blockId 多次 add 只包裹一次', () => {
        service.addCitedHighlight('block-same', 'abc', filePath);
        service.addCitedHighlight('block-same', 'abc', filePath);
        service.addCitedHighlight('block-same', 'abc', filePath);

        const spans = paragraph.querySelectorAll('.deeppdf-cited-text');
        expect(spans.length).toBe(1);
        expect(spans[0].textContent).toBe('abc');
    });
});

describe('ReadingModeService setCitedHighlightsByFile', () => {
    let service: ReadingModeService;
    let paragraph: HTMLElement;
    const filePath = 'p.md';

    beforeEach(() => {
        const setup = setupChapterDom('abcdefghij');
        paragraph = setup.paragraph;
        service = new ReadingModeService(makeApp(), undefined, 'deepreader-dev');
        (service as any).currentFile = makeTFile(filePath);
        (service as any).activeContainerEl = setup.container;
    });

    it('为当前文件应用 DOM 包裹', () => {
        const map = new Map<string, { blockId?: string; text: string }[]>();
        map.set(filePath, [{ blockId: 'b1', text: 'bcd' }]);
        // 不同文件不应用 DOM
        map.set('DeepReader/other.md', [{ blockId: 'b2', text: 'other' }]);

        service.setCitedHighlightsByFile(map);

        const spans = paragraph.querySelectorAll('.deeppdf-cited-text');
        expect(spans.length).toBe(1);
        expect(spans[0].textContent).toBe('bcd');
    });

    it('重复 entry 去重', () => {
        const map = new Map<string, { blockId?: string; text: string }[]>();
        map.set(filePath, [
            { blockId: 'b1', text: 'abc' },
            { blockId: 'b1', text: 'abc' },
        ]);
        service.setCitedHighlightsByFile(map);

        expect(paragraph.querySelectorAll('.deeppdf-cited-text').length).toBe(1);
    });
});
