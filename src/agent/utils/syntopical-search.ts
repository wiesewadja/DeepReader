/**
 * Syntopical Search - Multi-book retrieval for S3 Syntopical Reading
 *
 * Scans Vault for all indexed books, performs parallel vector + proposition
 * search, returns top results per book for LLM fusion analysis.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { agentLog as log } from '../../utils/logger.js';
import { searchBookV2 } from '../../pageindex/book-search-v2.js';
import { searchPropositions } from '../../pageindex/proposition-search.js';
import type { BookSearchResultV2, PropositionMatch } from '../../pageindex/book-types.js';
import type { EmbeddingOptions } from '../../pageindex/vault/types.js';
import { getOrGenerateEmbedding } from '../../pageindex/vault/embedding-cache.js';

export interface SyntopicalSearchOptions {
  query: string;
  vaultPath: string;
  embedding?: EmbeddingOptions;
  maxBooks?: number;
  topKPerBook?: number;
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

async function scanIndexedBooks(vaultPath: string): Promise<{ id: string; name: string }[]> {
  const pageindexDir = path.join(vaultPath, '.pageindex');

  try {
    await fs.access(pageindexDir);
  } catch {
    log('[syntopical-search] No .pageindex directory found');
    return [];
  }

  const dirs = await fs.readdir(pageindexDir);
  const books: { id: string; name: string }[] = [];

  for (const bookId of dirs) {
    const metaPath = path.join(pageindexDir, bookId, 'book-meta.json');
    try {
      const metaContent = await fs.readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);

      if (meta.status === 'complete' && meta.bookName) {
        books.push({ id: bookId, name: meta.bookName });
      }
    } catch {
      continue;
    }
  }

  log(`[syntopical-search] Found ${books.length} indexed books`);
  return books;
}

export async function syntopicalSearch(options: SyntopicalSearchOptions): Promise<SyntopicalSearchResult> {
  const { query, vaultPath, embedding, maxBooks = 5, topKPerBook = 5 } = options;

  // 1. Scan Vault for indexed books
  const indexedBooks = await scanIndexedBooks(vaultPath);

  if (indexedBooks.length === 0) {
    return {
      books: [],
      queryEmbedding: null,
      totalResults: 0,
    };
  }

  // 2. Pre-compute query embedding (shared across all books)
  const queryEmbedding = embedding && embedding.provider !== 'local'
    ? await getOrGenerateEmbedding(query, embedding).catch(() => null)
    : null;

  // 3. Parallel search across all books
  const searchPromises = indexedBooks.map(async (book) => {
    try {
      const searchOpts: any = {
        filePath: '',
        query,
        bookId: book.id,
        vaultPath,
        topK: topKPerBook,
        embedding,
      };

      const results = await searchBookV2(searchOpts);

      // Proposition search (optional, uses precomputed embedding if available)
      let propositionMatches: PropositionMatch[] = [];
      if (embedding && embedding.provider !== 'local') {
        try {
          propositionMatches = await searchPropositions(
            query,
            book.id,
            vaultPath,
            embedding,
            topKPerBook
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