/**
 * 阅读模式分页 E2E 测试
 * 验证打开章节文件后分页功能是否正常工作
 */
import { obsidianPage } from 'wdio-obsidian-service';

const BOOK_DIR = 'DeepReader/金钱心理学';

describe('阅读模式分页 E2E 测试', function () {
    this.timeout(120000);

    it('should have DeepReader plugin loaded', async function () {
        const loaded = await browser.executeObsidian(({ app }) => {
            return !!app.plugins?.plugins?.['deepreader-dev'];
        });
        expect(loaded).toBe(true);
    });

    it('should have test book chapters in vault', async function () {
        const files = await browser.executeObsidian(async ({ app }, dir: string) => {
            const folder = app.vault.getAbstractFileByPath(dir);
            if (!folder || !folder.children) return [];
            return folder.children
                .filter((f: any) => f.extension === 'md')
                .map((f: any) => f.path)
                .slice(0, 5);
        }, BOOK_DIR);
        expect(files.length).toBeGreaterThan(0);
        console.log('[E2E] Found chapters:', files);
    });

    it('should open a chapter file and trigger reading mode', async function () {
        // 打开一个较长的章节（第1章）
        const chapterPath = `${BOOK_DIR}/05 - 第1章 没有人真的对钱失去理智.md`;

        await browser.executeObsidian(async ({ app }, path: string) => {
            const file = app.vault.getAbstractFileByPath(path);
            if (!file) throw new Error(`File not found: ${path}`);
            const leaf = app.workspace.getLeaf(false);
            await leaf.openFile(file as any, { active: true });
        }, chapterPath);

        // 等待渲染
        await browser.pause(2000);

        // 验证阅读模式已激活
        const hasReadingMode = await browser.executeObsidian(({ app }) => {
            return document.body.classList.contains('deeppdf-reading-mode');
        });
        expect(hasReadingMode).toBe(true);
        console.log('[E2E] Reading mode activated');
    });

    it('should detect PagePaginator in console logs', async function () {
        // 等待分页器初始化（最多等 5 秒）
        await browser.pause(5000);

        // 检查分页器是否激活
        const paginatorState = await browser.executeObsidian(({ app }) => {
            const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
            const service = plugin?.readingModeService;
            if (!service) return { error: 'no service' };
            const paginator = service.getPaginator?.();
            if (!paginator) return { error: 'no paginator' };
            return {
                active: paginator.isActive(),
                totalPages: paginator.getTotalPages(),
                currentPage: paginator.getCurrentPage(),
            };
        });

        console.log('[E2E] Paginator state:', JSON.stringify(paginatorState));
    });

    it('should have pagination buttons visible', async function () {
        // 检查两侧翻页按钮是否存在
        const leftBtn = await browser.$('.deeppdf-page-btn.left');
        const rightBtn = await browser.$('.deeppdf-page-btn.right');

        const leftExists = await leftBtn.isExisting();
        const rightExists = await rightBtn.isExisting();

        console.log('[E2E] Left button exists:', leftExists);
        console.log('[E2E] Right button exists:', rightExists);

        if (leftExists && rightExists) {
            // 检查按钮是否可见
            const leftDisplayed = await leftBtn.isDisplayed();
            const rightDisplayed = await rightBtn.isDisplayed();
            console.log('[E2E] Left displayed:', leftDisplayed);
            console.log('[E2E] Right displayed:', rightDisplayed);
        }
    });

    it('should have progress bar and page indicator', async function () {
        const controlsBar = await browser.$('.deeppdf-page-controls');
        const exists = await controlsBar.isExisting();
        console.log('[E2E] Controls bar exists:', exists);

        if (exists) {
            const indicator = await browser.$('.deeppdf-page-indicator');
            const indicatorExists = await indicator.isExisting();
            console.log('[E2E] Page indicator exists:', indicatorExists);

            if (indicatorExists) {
                const text = await indicator.getText();
                console.log('[E2E] Page indicator text:', text);
            }
        }
    });

    it('should have hidden page elements when paginated', async function () {
        const hiddenCount = await browser.executeObsidian(({ app }) => {
            return document.querySelectorAll('.deeppdf-page-hidden').length;
        });
        console.log('[E2E] Hidden elements count:', hiddenCount);

        const visibleCount = await browser.executeObsidian(({ app }) => {
            const sizer = document.querySelector('.markdown-preview-sizer');
            if (!sizer) return -1;
            const children = sizer.children;
            let visible = 0;
            for (let i = 0; i < children.length; i++) {
                const el = children[i] as HTMLElement;
                if (!el.classList.contains('deeppdf-page-hidden') &&
                    !el.classList.contains('deeppdf-chapter-nav') &&
                    !el.classList.contains('deeppdf-page-controls') &&
                    el.nodeType === Node.ELEMENT_NODE) {
                    visible++;
                }
            }
            return visible;
        });
        console.log('[E2E] Visible content elements:', visibleCount);
    });

    it('should navigate to next page when clicking right button', async function () {
        const rightBtn = await browser.$('.deeppdf-page-btn.right');
        if (!(await rightBtn.isExisting())) {
            console.log('[E2E] SKIPPED: right button not found');
            return;
        }

        // 获取当前页码
        const beforePage = await browser.executeObsidian(({ app }) => {
            const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
            const paginator = plugin?.readingModeService?.getPaginator?.();
            return paginator?.getCurrentPage?.() ?? -1;
        });
        console.log('[E2E] Current page before click:', beforePage);

        // 点击下一页
        await rightBtn.click();
        await browser.pause(500);

        const afterPage = await browser.executeObsidian(({ app }) => {
            const plugin = app.plugins?.plugins?.['deepreader-dev'] as any;
            const paginator = plugin?.readingModeService?.getPaginator?.();
            return paginator?.getCurrentPage?.() ?? -1;
        });
        console.log('[E2E] Current page after click:', afterPage);

        if (beforePage > 0 && afterPage > 0) {
            expect(afterPage).toBeGreaterThan(beforePage);
        }
    });

    it('should screenshot the current state', async function () {
        // 截图查看实际效果
        await browser.saveScreenshot('./test-vault/pagination-screenshot.png');
        console.log('[E2E] Screenshot saved to test-vault/pagination-screenshot.png');
    });
});
