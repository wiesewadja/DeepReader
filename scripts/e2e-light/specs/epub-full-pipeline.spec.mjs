/**
 * 轻量 E2E: EPUB 完整索引流水线
 *
 * 以《自卑与超越》为测试书籍，覆盖完整索引链路：
 *   1. 清理旧索引
 *   2. parseEpub 元数据验证
 *   3. indexBook（需 LLM）
 *   4. book-meta.json 验证
 *   5. tree.json 结构验证
 *   6. trace JSON 日志验证
 *   7. 章节导出文件验证
 *   8. MOC 文件验证
 *   9. bm25.json 验证
 *
 * 需要: LLM API Key (roles.pageindex)
 */

import { evalObsidian } from '../../smoke/lib/obsidian-cli.mjs';

const TEST_BOOK = {
	title: '自卑与超越',
	author: '阿尔弗雷德·阿德勒',
	filePattern: '自卑与超越',
	legacyBookId: '9f77964d',
};

export default {
	id: 'epub-full-pipeline',
	name: 'EPUB 完整索引流水线',
	feature: 'F-01/02/04/05',
	timeout: 600_000, // 10 分钟（含 LLM 调用）

	async run({ log }) {
		const steps = [];

		function pass(name, duration, detail) {
			steps.push({ name, status: 'pass', duration, detail });
			log?.info?.(`  ✓ ${name} (${duration}ms)${detail ? '  ' + detail : ''}`);
		}

		function fail(name, duration, error) {
			steps.push({ name, status: 'fail', duration, error: error.message || String(error) });
		}

		// ===== Step 0: 环境准备 — 查找 EPUB 文件路径 =====
		let fullPath;
		let basePath;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const basePath = adapter.basePath;
						const assetsExists = await adapter.exists('DeepReader/assets');
						if (!assetsExists) return { error: 'DeepReader/assets 不存在' };
						const listing = await adapter.list('DeepReader/assets');
						const epubFile = (listing.files || []).find(f =>
							f.includes(${JSON.stringify(TEST_BOOK.filePattern)}) && f.endsWith('.epub')
						);
						if (!epubFile) return { error: '未找到 EPUB: ' + ${JSON.stringify(TEST_BOOK.filePattern)} };
						return { basePath, epubPath: epubFile };
					})();
				})()`, { timeout: 15_000 });

				if (result?.error) throw new Error(result.error);
				basePath = result.basePath;
				fullPath = result.basePath + '/' + result.epubPath;
				pass('环境准备', Date.now() - t0, `file=${result.epubPath.slice(0, 40)}...`);
			} catch (e) {
				fail('环境准备', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 1: 清理旧索引 =====
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const piBase = '.obsidian/plugins/deepreader-dev/pageindex';
						const possibleIds = [${JSON.stringify(TEST_BOOK.legacyBookId)}];

						for (const id of possibleIds) {
							const bookDir = piBase + '/' + id;
							const exists = await adapter.exists(bookDir);
							if (exists) {
								try { await adapter.rmdir(bookDir, true); } catch {}
							}
						}

						for (const id of possibleIds) {
							const tracePath = piBase + '/traces/' + id + '.json';
							const exists = await adapter.exists(tracePath);
							if (exists) {
								try { await adapter.trashLocal(tracePath); } catch {}
							}
						}

						return { cleaned: true };
					})();
				})()`, { timeout: 15_000 });
				pass('清理旧索引', Date.now() - t0);
			} catch (e) {
				fail('清理旧索引', Date.now() - t0, e);
			}
		}

		// ===== Step 2: parseEpub 元数据 =====
		let chapters;
		let epubTitle;
		let epubAuthor;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader-dev"];
					return plugin.api.parseEpub(${JSON.stringify(fullPath)});
				})()`, { timeout: 30_000 });

				if (!result?.title) throw new Error(`title 为空: ${JSON.stringify(result)?.slice(0, 100)}`);
				if (!result?.chapters?.length) throw new Error(`无章节: chapters=${JSON.stringify(result?.chapters?.length)}`);

				epubTitle = result.title;
				epubAuthor = result.author || '';
				chapters = result.chapters;
				const totalTokens = chapters.reduce((sum, c) => sum + (c.tokenCount || 0), 0);
				pass('parseEpub 元数据', Date.now() - t0,
					`title="${epubTitle?.slice(0, 20)}", author="${epubAuthor?.slice(0, 10)}", topChapters=${chapters.length}, totalTokens=${totalTokens}`);
			} catch (e) {
				fail('parseEpub 元数据', Date.now() - t0, e);
			}
		}

		// ===== Step 3: indexBook（完整 LLM 索引） =====
		let bookId;
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const plugin = app.plugins.plugins["deepreader-dev"];
					const s = plugin.settings;

					// 内置服务商默认 baseUrl（与 src/config/providers.ts 保持同步）
					const BUILTIN = {
						deepseek: "https://api.deepseek.com/v1",
						kimi: "https://api.moonshot.cn/v1",
						zhipu: "https://open.bigmodel.cn/api/paas/v4",
						siliconflow: "https://api.siliconflow.cn/v1",
						xiaomi: "https://token-plan-cn.xiaomimimo.com/v1",
						openai: "https://api.openai.com/v1",
						sensenova: "https://token.sensenova.cn/v1",
					};

					function resolveConfig(role) {
						const r = s?.roles?.[role];
						if (!r) return null;
						const acc = s?.providers?.[r.provider];
						if (!acc?.apiKey) return null;
						return { apiKey: acc.apiKey, baseUrl: acc.baseUrl || BUILTIN[r.provider] || "", model: r.model };
					}

					const pi = resolveConfig("pageindex");
					if (!pi) return { error: "未配置 LLM API Key (roles.pageindex)" };

					const emb = resolveConfig("embedding");

					return plugin.api.indexBook({
						filePath: ${JSON.stringify(fullPath)},
						fileType: "epub",
						outputDir: ${JSON.stringify(basePath)},
						model: pi.model,
						apiKey: pi.apiKey,
						baseUrl: pi.baseUrl,
						addNodeSummary: false,
						embedding: emb ? { provider: s.roles.embedding.provider, model: emb.model, apiKey: emb.apiKey, baseUrl: emb.baseUrl } : undefined,
					});
				})()`, { timeout: 540_000 });

				if (result?.error) throw new Error(result.error);
				if (!result?.bookId) throw new Error(`indexBook 无 bookId: ${JSON.stringify(result)?.slice(0, 200)}`);

				bookId = result.bookId;
				pass('indexBook', Date.now() - t0,
					`bookId=${bookId}, ch=${result.chaptersCount}, title="${result.title?.slice(0, 20)}"`);
			} catch (e) {
				fail('indexBook', Date.now() - t0, e);
				return { steps };
			}
		}

		// ===== Step 4: book-meta.json 验证 =====
		{
			const t0 = Date.now();
			try {
				const meta = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const piBase = '.obsidian/plugins/deepreader-dev/pageindex';
						const metaPath = piBase + '/' + ${JSON.stringify(bookId)} + '/book-meta.json';
						const exists = await adapter.exists(metaPath);
						if (!exists) return { exists: false };

						const raw = await adapter.read(metaPath);
						const meta = JSON.parse(raw);
						return {
							exists: true,
							title: meta.title,
							author: meta.author,
							fileType: meta.fileType,
							version: meta.version,
							hasEmbedding: !!meta.embedding,
							embeddingModel: meta.embedding?.model,
							// V3: chapters 始终为空数组，章节信息在 tree.json 中
							chaptersCount: meta.chapters?.length || 0,
						};
					})();
				})()`, { timeout: 10_000 });

				if (!meta?.exists) throw new Error('book-meta.json 不存在');
				if (meta.fileType !== 'epub') throw new Error(`fileType=${meta.fileType}, expected epub`);
				if (!meta.version) throw new Error('缺少 version 字段');

				pass('book-meta.json', Date.now() - t0,
					`title="${meta.title?.slice(0, 20)}", v${meta.version}, embedding=${meta.embeddingModel || 'none'}`);
			} catch (e) {
				fail('book-meta.json', Date.now() - t0, e);
			}
		}

		// ===== Step 5: tree.json 结构验证 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const piBase = '.obsidian/plugins/deepreader-dev/pageindex';
						const treePath = piBase + '/' + ${JSON.stringify(bookId)} + '/tree.json';
						const exists = await adapter.exists(treePath);
						if (!exists) return { exists: false };

						const raw = await adapter.read(treePath);
						const tree = JSON.parse(raw);

						// tree.json 有两种格式：扁平 nodes[] 或嵌套 structure[]
						let totalNodes = 0;
						let maxDepth = 0;

						if (Array.isArray(tree.nodes)) {
							totalNodes = tree.nodes.length;
							maxDepth = Math.max(...tree.nodes.map(n => n.level || 0), 0);
						} else if (Array.isArray(tree.structure)) {
							const walk = (nodes, depth) => {
								for (const n of nodes) {
									totalNodes++;
									if (depth > maxDepth) maxDepth = depth;
									if (n.nodes?.length) walk(n.nodes, depth + 1);
								}
							};
							walk(tree.structure, 1);
						}

						// 向量存储在 vectors.jsonl 而非 tree.json 节点中
						const vectorPath = piBase + '/' + ${JSON.stringify(bookId)} + '/vectors.jsonl';
						const hasVectors = await adapter.exists(vectorPath);

						const rootNodes = tree.structure?.length || tree.nodes?.filter(n => !n.parentId).length || 0;
						return {
							exists: true,
							totalNodes,
							rootNodes,
							maxDepth,
							hasVectors,
							hasDocDescription: !!tree.docDescription,
							hasNodeFileMap: !!tree.nodeFileMap,
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('tree.json 不存在');
				if (result.totalNodes < 3) throw new Error(`节点数过少: ${result.totalNodes}`);
				if (result.rootNodes < 1) throw new Error('无根节点');

				pass('tree.json', Date.now() - t0,
					`nodes=${result.totalNodes}, roots=${result.rootNodes}, depth=${result.maxDepth}, vectors=${result.hasVectors}`);
			} catch (e) {
				fail('tree.json', Date.now() - t0, e);
			}
		}

		// ===== Step 6: trace JSON 日志验证 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const piBase = '.obsidian/plugins/deepreader-dev/pageindex';
						const tracePath = piBase + '/traces/' + ${JSON.stringify(bookId)} + '.json';
						const exists = await adapter.exists(tracePath);
						if (!exists) return { exists: false };

						const raw = await adapter.read(tracePath);
						const trace = JSON.parse(raw);
						return {
							exists: true,
							success: trace.success,
							bookId: trace.bookId,
							title: trace.title?.slice(0, 30),
							phasesCount: trace.phases?.length || 0,
							phaseNames: (trace.phases || []).map(p => p.name),
							hasLlmSummary: !!trace.llmSummary,
							totalCalls: trace.llmSummary?.totalCalls || 0,
							totalTokens: trace.llmSummary?.totalTokens || 0,
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('trace JSON 不存在');
				if (result.success === false) throw new Error('trace 标记为失败');
				if (result.bookId !== bookId) throw new Error(`bookId 不匹配: ${result.bookId} vs ${bookId}`);

				pass('trace JSON', Date.now() - t0,
					`phases=[${result.phaseNames?.join(',')}], llmCalls=${result.totalCalls}, tokens=${result.totalTokens}`);
			} catch (e) {
				fail('trace JSON', Date.now() - t0, e);
			}
		}

		// ===== Step 7: 章节导出文件验证 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const listing = await adapter.list('DeepReader');
						const bookDirs = (listing.folders || []).filter(f =>
							f.includes(${JSON.stringify(TEST_BOOK.filePattern)})
						);
						if (bookDirs.length === 0) return { exported: false, reason: '无导出目录' };

						let totalMd = 0;
						let totalWithFrontmatter = 0;

						for (const dir of bookDirs) {
							const sub = await adapter.list(dir);
							const mdFiles = (sub.files || []).filter(f => f.endsWith('.md') && !f.endsWith('MOC.md'));
							totalMd += mdFiles.length;

							for (const f of mdFiles.slice(0, 3)) {
								try {
									const content = await adapter.read(f);
									if (content.startsWith('---')) totalWithFrontmatter++;
								} catch {}
							}
						}

						return { exported: totalMd > 0, totalMd, totalWithFrontmatter, bookDirs: bookDirs.length };
					})();
				})()`, { timeout: 20_000 });

				if (!result?.exported) throw new Error(result?.reason || 'DeepReader 目录下无导出章节');
				if (result.totalMd < 5) throw new Error(`章节文件过少: ${result.totalMd}`);

				pass('章节导出', Date.now() - t0,
					`dirs=${result.bookDirs}, md=${result.totalMd}, frontmatter=${result.totalWithFrontmatter}`);
			} catch (e) {
				fail('章节导出', Date.now() - t0, e);
			}
		}

		// ===== Step 8: MOC 文件验证 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const listing = await adapter.list('DeepReader');
						const bookDirs = (listing.folders || []).filter(f =>
							f.includes(${JSON.stringify(TEST_BOOK.filePattern)})
						);
						if (bookDirs.length === 0) return { exists: false };

						for (const dir of bookDirs) {
							const sub = await adapter.list(dir);
							const mocFile = (sub.files || []).find(f => f.includes('MOC'));
							if (!mocFile) continue;

							const content = await adapter.read(mocFile);
							const hasFrontmatter = content.startsWith('---');
							const hasIndexId = content.includes('index_id');
							const hasLinks = content.includes('[[');
							const lines = content.split('\\n').length;

							const idMatch = content.match(/index_id:\\s*(\\S+)/);
							const mocBookId = idMatch?.[1] || '';

							return {
								exists: true,
								path: mocFile,
								lines,
								hasFrontmatter,
								hasIndexId,
								hasLinks,
								mocBookId,
							};
						}
						return { exists: false };
					})();
				})()`, { timeout: 15_000 });

				if (!result?.exists) throw new Error('MOC 文件不存在');
				if (!result.hasFrontmatter) throw new Error('MOC 缺少 frontmatter');
				if (!result.hasLinks) throw new Error('MOC 无 wiki links');

				pass('MOC 文件', Date.now() - t0,
					`lines=${result.lines}, index_id=${result.mocBookId}, links=${result.hasLinks}`);
			} catch (e) {
				fail('MOC 文件', Date.now() - t0, e);
			}
		}

		// ===== Step 9: bm25.json 验证 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const piBase = '.obsidian/plugins/deepreader-dev/pageindex';
						const bm25Path = piBase + '/' + ${JSON.stringify(bookId)} + '/bm25.json';
						const exists = await adapter.exists(bm25Path);
						if (!exists) return { exists: false };

						const raw = await adapter.read(bm25Path);
						const bm25 = JSON.parse(raw);
						const terms = Object.keys(bm25.terms || bm25.invertedIndex || {});
						return {
							exists: true,
							hasTerms: terms.length > 0,
							termsCount: terms.length,
							sampleTerms: terms.slice(0, 5),
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('bm25.json 不存在');
				if (!result.hasTerms) throw new Error('bm25 无词条');

				pass('bm25.json', Date.now() - t0,
					`terms=${result.termsCount}, sample=${result.sampleTerms?.join('/')}`);
			} catch (e) {
				fail('bm25.json', Date.now() - t0, e);
			}
		}

		// ===== Step 10: vectors.jsonl 向量数据验证 =====
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`(() => {
					const adapter = app.vault.adapter;
					return (async () => {
						const piBase = '.obsidian/plugins/deepreader-dev/pageindex';
						const vectorPath = piBase + '/' + ${JSON.stringify(bookId)} + '/vectors.jsonl';
						const exists = await adapter.exists(vectorPath);
						if (!exists) return { exists: false };

						const raw = await adapter.read(vectorPath);
						const lines = raw.trim().split('\\n');
						// 抽样第一行：验证有 vector 字段且维度 > 0
						const first = JSON.parse(lines[0]);
						const vectorLen = first.vector?.length || 0;
						return {
							exists: true,
							vectorCount: lines.length,
							dimensions: vectorLen,
							hasChunkId: !!first.chunkId,
							levels: [...new Set(lines.slice(0, 20).map(l => { try { return JSON.parse(l).level; } catch { return '?'; } }))],
						};
					})();
				})()`, { timeout: 10_000 });

				if (!result?.exists) throw new Error('vectors.jsonl 不存在');
				if (result.vectorCount < 10) throw new Error(`向量数过少: ${result.vectorCount}`);
				if (result.dimensions < 100) throw new Error(`向量维度异常: ${result.dimensions}`);

				pass('vectors.jsonl', Date.now() - t0,
					`count=${result.vectorCount}, dim=${result.dimensions}, levels=${result.levels?.join('/')}`);
			} catch (e) {
				fail('vectors.jsonl', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
