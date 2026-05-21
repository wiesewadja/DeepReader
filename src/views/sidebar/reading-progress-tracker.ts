/**
 * 阅读进度追踪器
 *
 * 管理章节阅读进度追踪、持久化和 MOC 同步。
 */

import { TFile } from 'obsidian';
import {
	createEmptyProgress,
	markChapterVisited,
	updateLastRead,
	getProgressPercent,
	loadProgress,
	saveProgress,
} from '../../pageindex/reading-progress.js';
import type { ReadingProgress } from '../../pageindex/reading-progress.js';
import { uiLog as log, error as logError } from '../../utils/logger.js';

export interface ReadingProgressTrackerHost {
	get app(): import('obsidian').App;
	get plugin(): any;
	get readingTopbar(): import('../../components/reading-topbar/index.js').ReadingTopbar | null;
	get proactiveEngine(): import('../../agent/proactive/engine.js').ProactiveEngine | null;
	get agentChatHistory(): import('../../agent/types.js').ChatMessage[];
	get indexes(): import('../../types/index.js').IndexListItem[];
	getCurrentIndexId(): string | null;
	getCurrentPdfName(): string | null;
	getCurrentChapterId(): string | null;
	setCurrentChapterId(id: string | null): void;
	setReadingProgress(progress: ReadingProgress | null): void;
	getReadingProgress(): ReadingProgress | null;
}

export class ReadingProgressTracker {
	private host: ReadingProgressTrackerHost;
	private progressDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly PROGRESS_DEBOUNCE_MS = 3000;

	constructor(host: ReadingProgressTrackerHost) {
		this.host = host;
	}

	getProgress(): ReadingProgress | null {
		return this.host.getReadingProgress();
	}

	async initReadingProgress(indexId: string): Promise<void> {
		const progress = this.host.getReadingProgress();
		if (progress?.bookId === indexId) return;

		try {
			const vaultPath = (this.host.app.vault.adapter as any).basePath;
			const loaded = await loadProgress(vaultPath, indexId);
			this.host.setReadingProgress(loaded || createEmptyProgress(indexId));
			const rp = this.host.getReadingProgress()!;
			log(`[DeepPDF] 阅读进度已初始化: ${indexId}, 已访问 ${Object.keys(rp.chapters).filter(k => rp.chapters[k].visited).length} 章`);

			this.updateProgressUI();

			const hasHistory = this.host.agentChatHistory.filter(m => m.role === 'user').length > 0;
			const totalChapters = this.getTotalChapters();
			const progressPercent = getProgressPercent(rp, totalChapters);
			await this.host.proactiveEngine?.onBookOpen(indexId, hasHistory, progressPercent);
		} catch (e) {
			logError('[DeepPDF] 初始化阅读进度失败:', e);
			this.host.setReadingProgress(createEmptyProgress(indexId));
		}
	}

	async trackReadingProgress(): Promise<void> {
		const rp = this.host.getReadingProgress();
		const pdfName = this.host.getCurrentPdfName();
		if (!rp || !pdfName) return;

		const bookPath = `DeepReader/${pdfName}/`;

		// Proactive: 检测离开整本书
		const currentChapterId = this.host.getCurrentChapterId();
		if (currentChapterId && rp) {
			const activeFile = this.host.app.workspace.getActiveFile();
			if (!activeFile || !activeFile.path.startsWith(bookPath)) {
				this.host.proactiveEngine?.onChapterLeave(rp.bookId, currentChapterId);
				this.host.setCurrentChapterId(null);
			}
		}

		const activeFile = this.host.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== 'md') return;

		const rms = this.host.plugin.readingModeService;
		if (rms) {
			const activeLeaf = this.host.app.workspace.activeLeaf;
			const activatedContainer = rms.getActiveContainerEl();
			if (activatedContainer && activeLeaf?.view?.containerEl !== activatedContainer) {
				return;
			}
		}

		if (!activeFile.path.startsWith(bookPath)) return;
		if (activeFile.path === `${bookPath}${pdfName}.md`) return;

		const cache = this.host.app.metadataCache.getFileCache(activeFile);
		const rawNodeId = cache?.frontmatter?.node_id;
		const chapterId = rawNodeId ? String(rawNodeId) : activeFile.basename;
		if (!chapterId) return;

		// Proactive: 章节内切换
		const prevChapterId = this.host.getCurrentChapterId();
		this.host.setCurrentChapterId(chapterId);
		if (prevChapterId && prevChapterId !== chapterId) {
			this.host.proactiveEngine?.onChapterLeave(rp.bookId, prevChapterId);
		}
		this.host.proactiveEngine?.onChapterEnter(rp.bookId, chapterId);

		const wasVisited = rp.chapters[chapterId]?.visited;
		let updated = markChapterVisited(rp, chapterId);
		updated = updateLastRead(updated, chapterId);
		this.host.setReadingProgress(updated);

		if (!wasVisited) {
			log(`[DeepPDF] 章节已标记为已读: ${chapterId} (${activeFile.basename})`);
		}

		this.updateProgressUI();
		this.debouncedSaveProgress();
	}

	updateProgressUI(): void {
		const rp = this.host.getReadingProgress();
		if (!rp || !this.host.getCurrentPdfName()) return;

		const totalChapters = this.getTotalChapters();
		const percent = getProgressPercent(rp, totalChapters);
		log(`[DeepPDF] 进度更新: ${percent}% (${Object.values(rp.chapters).filter(c => c.visited).length}/${totalChapters})`);
	}

	getTotalChapters(): number {
		const pdfName = this.host.getCurrentPdfName();
		if (!pdfName) return 0;

		const index = this.host.indexes.find(i => i.id === this.host.getCurrentIndexId());
		if (index && index.node_count > 0) return index.node_count;

		try {
			const bookFolder = this.host.app.vault.getAbstractFileByPath(`DeepReader/${pdfName}`);
			if (bookFolder && 'children' in bookFolder) {
				const children = (bookFolder as any).children as any[];
				return children.filter((f: any) =>
					f instanceof TFile && f.extension === 'md' &&
					f.path !== `DeepReader/${pdfName}/${pdfName}.md`
				).length;
			}
		} catch {
			// ignore
		}
		return 0;
	}

	navigateToLastReadChapter(): void {
		const pdfName = this.host.getCurrentPdfName();
		if (!pdfName) return;

		const bookPath = `DeepReader/${pdfName}/`;
		const rp = this.host.getReadingProgress();
		const indexId = this.host.getCurrentIndexId();

		const activeFile = this.host.app.workspace.getActiveFile();
		if (activeFile && activeFile.path.startsWith(bookPath)) {
			const cache = this.host.app.metadataCache.getFileCache(activeFile);
			const isMoc = cache?.frontmatter?.type === 'pdf-moc' || cache?.frontmatter?.type === 'epub-moc';
			if (!isMoc) {
				if (this.host.plugin.readingModeService?.getAutoEnable()) {
					this.host.plugin.readingModeService.activate(activeFile);
				}
				return;
			}
		}

		if (rp?.lastReadChapterId) {
			const chapterId = rp.lastReadChapterId;

			if (activeFile && activeFile.path.startsWith(bookPath)) {
				const cache = this.host.app.metadataCache.getFileCache(activeFile);
				const currentNodeId = cache?.frontmatter?.node_id;
				if (String(currentNodeId) === chapterId || activeFile.basename === chapterId) {
					if (this.host.plugin.readingModeService?.getAutoEnable()) {
						this.host.plugin.readingModeService.activate(activeFile);
					}
					return;
				}
			}

			const files = this.host.app.vault.getMarkdownFiles();
			let targetFile: TFile | null = null;

			for (const f of files) {
				if (!f.path.startsWith(bookPath)) continue;
				if (f.path === `${bookPath}${pdfName}.md`) continue;
				const cache = this.host.app.metadataCache.getFileCache(f);
				if (cache?.frontmatter?.node_id !== undefined && String(cache.frontmatter.node_id) === chapterId) {
					targetFile = f;
					break;
				}
			}

			if (!targetFile) {
				const matchPath = `${bookPath}${chapterId}.md`;
				const file = this.host.app.vault.getAbstractFileByPath(matchPath);
				if (file instanceof TFile) targetFile = file;
			}

			if (targetFile) {
				log(`[DeepPDF] 自动跳转到上次阅读章节: ${targetFile.path}`);
				this.host.app.workspace.getLeaf(false).openFile(targetFile);

				setTimeout(() => {
					const rms = this.host.plugin.readingModeService;
					if (rms?.getAutoEnable() && !rms.getCurrentFile()) {
						const file = this.host.app.workspace.getActiveFile();
						if (file && rms.isChapterFile(file)) {
							rms.activate(file);
						}
					}
				}, 300);
				return;
			}
		}

		// 无阅读记录，打开 MOC
		const files = this.host.app.vault.getMarkdownFiles();
		const mocFile = files.find(f => {
			if (!f.path.startsWith(bookPath)) return false;
			if (!f.path.includes('MOC')) return false;
			const cache = this.host.app.metadataCache.getFileCache(f);
			return cache?.frontmatter?.index_id === rp?.bookId
				|| cache?.frontmatter?.pdf_index_id === indexId;
		});

		if (mocFile) {
			log(`[DeepPDF] 无阅读记录，打开 MOC: ${mocFile.path}`);
			this.host.app.workspace.getLeaf(false).openFile(mocFile);
		}
	}

	debouncedSaveProgress(): void {
		if (this.progressDebounceTimer) clearTimeout(this.progressDebounceTimer);
		this.progressDebounceTimer = setTimeout(() => {
			this.flushProgressSave();
		}, this.PROGRESS_DEBOUNCE_MS);
	}

	async flushProgressSave(): Promise<void> {
		if (this.progressDebounceTimer) {
			clearTimeout(this.progressDebounceTimer);
			this.progressDebounceTimer = null;
		}

		const rp = this.host.getReadingProgress();
		if (!rp) return;

		try {
			const vaultPath = (this.host.app.vault.adapter as any).basePath;
			await saveProgress(vaultPath, rp);
			await this.syncProgressToMoc();
		} catch (e) {
			logError('[DeepPDF] 保存阅读进度失败:', e);
		}
	}

	private async syncProgressToMoc(): Promise<void> {
		const rp = this.host.getReadingProgress();
		const indexId = this.host.getCurrentIndexId();
		if (!rp || !indexId) return;

		try {
			const totalChapters = this.getTotalChapters();
			const percent = getProgressPercent(rp, totalChapters);

			const files = this.host.app.vault.getMarkdownFiles();
			const mocFile = files.find(f => {
				if (!f.path.includes('DeepReader/')) return false;
				if (!f.path.includes('MOC')) return false;
				const cache = this.host.app.metadataCache.getFileCache(f);
				return cache?.frontmatter?.index_id === rp.bookId;
			});

			if (!mocFile) return;

			await this.host.app.fileManager.processFrontMatter(mocFile, (fm) => {
				fm.progress = percent;
			});

			log(`[DeepPDF] MOC 进度已同步: ${percent}%`);
		} catch (e) {
			logError('[DeepPDF] MOC 进度同步失败:', e);
		}
	}

	destroy(): void {
		if (this.progressDebounceTimer) {
			clearTimeout(this.progressDebounceTimer);
			this.progressDebounceTimer = null;
		}
	}
}
