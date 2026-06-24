/**
 * Syntopical Search - Multi-book retrieval for S3 Syntopical Reading
 *
 * Scans Vault for all indexed books, performs parallel vector + proposition
 * search, returns top results per book for LLM fusion analysis.
 */

import { nodeFs } from '../../utils/node-fs.js';
import type { App } from 'obsidian';
import type { BookSearchResultV2, PropositionMatch } from '../../pageindex/book-types.js';
import { PAGEINDEX_DIR, getPageindexDir } from '../../pageindex/paths.js';
import type { EmbeddingOptions } from '../../pageindex/vault/types.js';
import { agentLog as log } from '../../utils/logger.js';
import { vaultRead, vaultExists, vaultList, joinPath } from '../../utils/mobile-fs.js';

export interface SyntopicalSearchOptions {
  query: string;
  vaultPath: string;
  embedding?: EmbeddingOptions;
  reranker?: { provider: 'openai'; model: string; apiKey: string; baseUrl: string; weight: number };
  maxBooks?: number;
  topKPerBook?: number;
  /** Only search these book IDs; omit to search all indexed books */
  bookIds?: string[];
  /** Pre-resolved list of indexed books (skips filesystem scan when provided) */
  knownBooks?: { id: string; name: string }[];
  /** Obsidian App instance for mobile-compatible file access */
  app?: App;
}

export interface SyntopicalBookResult {
  bookId: string;
  bookName: string;
  results: BookSearchResultV2[];
  propositionMatches: PropositionMatch[];
}

export interface SyntopicalSearchResult {
  books: SyntopicalBookResult[];
  queryEmbedding: number[] | null;
  totalResults: number;
}

const SYNTOPICAL_KEYWORDS = [
  '对比', '比较', '异同', '其他书', '联系起来', '另一本',
  '跨书', '主题阅读', '共识', '分歧', '相同', '差异',
  '看法不同', '观点不同', '有什么不同', '有何不同'
];

export function hasSyntopicalKeywords(query: string): boolean {
  const lowerQuery = query.toLowerCase();
  return SYNTOPICAL_KEYWORDS.some(kw => lowerQuery.includes(kw));
}

async function scanIndexedBooks(vaultPath: string, app?: App): Promise<{ id: string; name: string }[]> {
  const books: { id: string; name: string }[] = [];

  if (app) {
    // Mobile: vault-relative paths
    if (!(await vaultExists(app, getPageindexDir()))) {
      log('[syntopical-search] No pageindex directory found');
      return [];
    }
    const { folders } = await vaultList(app, getPageindexDir());
    for (const folder of folders) {
      const bookId = folder.split('/').pop() || folder;
      const metaRel = joinPath(PAGEINDEX_DIR, bookId, 'book-meta.json');
      try {
        const metaContent = await vaultRead(app, metaRel);
        const meta = JSON.parse(metaContent);
        if (meta.title) books.push({ id: bookId, name: meta.title });
      } catch { continue; }
    }
  } else {
    // Desktop: absolute paths
    const pageindexDir = require('path').join(vaultPath, getPageindexDir());
    try {
      await nodeFs().access(pageindexDir);
    } catch {
      log('[syntopical-search] No pageindex directory found');
      return [];
    }
    const dirs = await nodeFs().readdir(pageindexDir);
    for (const bookId of dirs) {
      const metaPath = require('path').join(pageindexDir, bookId, 'book-meta.json');
      try {
        const metaContent = await nodeFs().readFile(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        if (meta.title) books.push({ id: bookId, name: meta.title });
      } catch { continue; }
    }
  }

  log(`[syntopical-search] Found ${books.length} indexed books`);
  return books;
}

export async function syntopicalSearch(options: SyntopicalSearchOptions): Promise<SyntopicalSearchResult> {
  const { query, vaultPath, embedding, reranker, maxBooks = 5, topKPerBook = 5 } = options;
  const app = options.app;

  // 1. Use provided book list or fall back to filesystem scan
  let indexedBooks = options.knownBooks?.length ? options.knownBooks : await scanIndexedBooks(vaultPath, app);

  // Filter to specific books when booklist is active
  if (options.bookIds?.length) {
    const idSet = new Set(options.bookIds);
    // Resolve WeRead bookIds to local index IDs via mapping.json
    const unresolved = options.bookIds.filter(id => !indexedBooks.some(b => b.id === id));
    if (unresolved.length > 0) {
      try {
        const mappingRel = joinPath(PAGEINDEX_DIR, 'weread', 'mapping.json');
        const mappingRaw = app
          ? await vaultRead(app, mappingRel)
          : await nodeFs().readFile(require('path').join(vaultPath, getPageindexDir(), 'weread', 'mapping.json'), 'utf-8');
        const parsed = JSON.parse(mappingRaw);
        const mapping = parsed.mappings || parsed; // support both {mappings:{...}} and flat {...}
        for (const wereadId of unresolved) {
          const info = mapping[wereadId];
          if (info?.deepReaderBookId) idSet.add(info.deepReaderBookId);
        }
      } catch { /* mapping.json not found */ }
    }
    indexedBooks = indexedBooks.filter(b => idSet.has(b.id));
  }

  if (indexedBooks.length === 0) {
    return {
      books: [],
      queryEmbedding: null,
      totalResults: 0,
    };
  }

  // 2. Pre-compute query embedding (shared across all books)
  let queryEmbedding = null;
  if (embedding && embedding.provider !== 'local') {
    const { getOrGenerateEmbedding } = require('../../pageindex/vault/embedding-cache.js');
    queryEmbedding = await getOrGenerateEmbedding(query, embedding).catch(() => null);
  }

  // 3. Parallel search across all books
  const searchPromises = indexedBooks.map(async (book) => {
    try {
      const searchOpts: any = {
        filePath: '',
        query,
        bookId: book.id,
        vaultPath: app ? undefined : vaultPath,
        topK: topKPerBook,
        embedding,
        reranker,
        ...(app ? { app } : {}),
      };

      const { searchBookV2 } = require('../../pageindex/book-search-v2.js');
      const results = (await searchBookV2(searchOpts)) as BookSearchResultV2[];

      // Proposition search (optional, uses precomputed embedding if available)
      let propositionMatches: PropositionMatch[] = [];
      if (embedding && embedding.provider !== 'local') {
        try {
          const { searchPropositions } = require('../../pageindex/proposition-search.js');
          propositionMatches = await searchPropositions(
            query,
            book.id,
            vaultPath,
            embedding,
            topKPerBook,
            app
          );
        } catch {
          // Proposition search optional, ignore failures
        }
      }

      return {
        bookId: book.id,
        bookName: book.name,
        results,
        propositionMatches,
      };
    } catch (err) {
      log(`[syntopical-search] Search failed for ${book.name}:`, err);
      return {
        bookId: book.id,
        bookName: book.name,
        results: [],
        propositionMatches: [],
      };
    }
  });

  const allResults = await Promise.all(searchPromises);

  // 4. Sort by total score (sum of all result scores)
  const sortedResults = allResults
    .filter(r => r.results.length > 0)
    .sort((a, b) => {
      const scoreA = a.results.reduce((sum, r) => sum + r.score, 0);
      const scoreB = b.results.reduce((sum, r) => sum + r.score, 0);
      return scoreB - scoreA;
    })
    .slice(0, maxBooks);

  const totalResults = sortedResults.reduce((sum, r) => sum + r.results.length, 0);

  log(`[syntopical-search] Selected ${sortedResults.length} books, ${totalResults} total results`);

  return {
    books: sortedResults,
    queryEmbedding,
    totalResults,
  };
}

export function formatSyntopicalContext(results: SyntopicalSearchResult): string {
  if (results.books.length === 0) {
    return '';
  }

  const blocks: string[] = [];

  for (const book of results.books) {
    blocks.push(`\n=== 《${book.bookName}》 ===\n`);

    // Format search results
    for (const r of book.results.slice(0, 3)) {
      for (const block of r.matchedBlocks.slice(0, 2)) {
        blocks.push(`【${r.title}】${block.content.slice(0, 400)}\n`);
      }
    }

    // Format propositions
    if (book.propositionMatches.length > 0) {
      blocks.push('\n原子事实卡片:\n');
      for (const match of book.propositionMatches.slice(0, 2)) {
        if (match.card) {
          blocks.push(`【${match.card.type}】${match.card.answer} ^${match.card.id}\n`);
        }
      }
    }
  }

  return blocks.join('\n');
}
