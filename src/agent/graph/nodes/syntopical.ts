/**
 * S3: Syntopical Reading Node — LangGraph node for multi-book analysis
 *
 * Flow:
 * 1. Parallel vector + proposition search across books
 * 2. LLM fusion analysis (consensus vocabulary + issues + positions)
 * 3. Wiki link self-verification
 * 4. Optional HITL review
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { RunnableLambda } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { interrupt } from '@langchain/langgraph';
import { agentLog as log } from '../../../utils/logger.js';
import { syntopicalSearch, type SyntopicalBookResult, type SyntopicalSearchResult } from '../../utils/syntopical-search.js';
import { SYNTOPICAL_MAX_BOOKS, SYNTOPICAL_TOP_K_PER_BOOK, SYNTOPICAL_SNAPSHOT_LIMIT } from '../../config/agent-constants.js';
import type { SyntopicalInput } from '../node-io.js';
import type { SharedContext } from '../shared-context.js';
import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions, toRerankerOptions } from '../../../config/role-adapters.js';
import {
  buildSyntopicalSystemPrompt,
  buildSyntopicalUserMessage,
} from '../prompts/syntopical-prompt.js';
import { verifyAndCleanContent } from '../utils/self-verification.js';

export interface SyntopicalToolResult {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  originalResultLength: number;
}

// ── Helpers ──

function extractToolResults(books: SyntopicalBookResult[]): SyntopicalToolResult[] {
  return books.flatMap(book =>
    book.results.flatMap(r =>
      r.matchedBlocks.map(block => ({
        toolName: 'syntopical_search',
        args: { bookId: book.bookId, nodeId: r.nodeId },
        result: block.content,
        originalResultLength: block.content.length,
      }))
    )
  );
}

/** Edge-case responses when search results are insufficient */
function handleInsufficientResults(searchResult: SyntopicalSearchResult): Partial<CognitiveEngineState> | null {
  if (searchResult.books.length === 0) {
    log('[S3 Syntopical] No indexed books found');
    return {
      analysisResult: 'Vault 中没有已索引的书籍。请先在 Library 中添加书籍并完成索引。',
      toolResultsSnapshot: [{
        toolName: 'syntopical_search',
        args: { query: '' },
        result: 'No indexed books found',
        originalResultLength: 0,
      }],
    };
  }

  if (searchResult.books.length === 1) {
    log('[S3 Syntopical] Only 1 book found, returning fallback message');
    const singleBook = searchResult.books[0];
    return {
      analysisResult: `只找到 1 本已索引书籍《${singleBook.bookName}》，无法进行多书籍主题阅读。\n\n建议：\n1. 在 Library 中添加更多相关书籍并完成索引\n2. 或使用普通检索模式查询这本书\n\n找到的相关章节：\n${singleBook.results.slice(0, 3).map(r => `- ${r.title}`).join('\n')}`,
      toolResultsSnapshot: [],
    };
  }

  return null;
}

// ── Node ──

export async function syntopicalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const { rewrittenQuery }: SyntopicalInput = state;
  const ctx = config.configurable?.sharedContext as SharedContext | undefined;
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;

  if (!mainModel || !toolContext?.app) {
    log('[S3 Syntopical] Missing required config, returning empty result.');
    return { analysisResult: '', toolResultsSnapshot: [] };
  }

  const vaultPath = (toolContext.app.vault.adapter as { basePath: string }).basePath || '';
  const query = rewrittenQuery || ctx?.rawUserQuery || '';
  const settings = toolContext.plugin?.settings;
  const embeddingRole = settings ? resolveRoleConfig('embedding', settings) : null;
  const rerankerRole = settings ? resolveRoleConfig('reranker', settings) : null;
  const embedding = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;
  const reranker = rerankerRole ? toRerankerOptions(rerankerRole, settings?.rerankerWeight ?? 0.7) : undefined;

  log(`[S3 Syntopical] Starting multi-book search for: "${query.slice(0, 50)}"`);

  // 1. Multi-book search
  const searchResult = await RunnableLambda.from(
    async () => syntopicalSearch({
      query,
      vaultPath,
      embedding,
      reranker,
      maxBooks: SYNTOPICAL_MAX_BOOKS,
      topKPerBook: SYNTOPICAL_TOP_K_PER_BOOK,
      bookIds: ctx?.booklistBookIds,
      knownBooks: ctx?.indexedBooks,
    })
  ).withConfig({ runName: 'syntopical_search' }).invoke({}, { callbacks: config.callbacks });

  // 2. Edge cases
  const fallback = handleInsufficientResults(searchResult);
  if (fallback) return fallback;

  // 3. LLM synthesis
  const systemPrompt = buildSyntopicalSystemPrompt();
  const userMessage = buildSyntopicalUserMessage(query, searchResult.books);

  log(`[S3 Syntopical] Calling LLM with ${searchResult.books.length} books context`);

  const response = await mainModel.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ], config);

  let content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  // 4. Self-verification (wiki link validation)
  const toolResults = extractToolResults(searchResult.books);
  const verification = await verifyAndCleanContent(content, toolResults);
  content = verification.content;

  log(`[S3 Syntopical] Analysis complete, ${verification.totalRefs} refs, ${verification.ghostRefs} ghost`);

  // 5. Build state update (with optional HITL)
  const stateUpdate: Partial<CognitiveEngineState> = {
    analysisResult: content,
    toolResultsSnapshot: toolResults.slice(0, Math.min(SYNTOPICAL_SNAPSHOT_LIMIT, toolResults.length)),
  };

  const enableHumanReview = config.configurable?.enableHumanReview as boolean | undefined;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'syntopical',
      question: 'S3 主题阅读完成，是否满意当前分析？',
      content,
    }) as { approved: boolean; feedback: string } | undefined;

    if (resumeValue?.approved === false && resumeValue.feedback) {
      const refined = await mainModel.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
        new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈补充或修正分析。`),
      ], config);

      stateUpdate.analysisResult = typeof refined.content === 'string'
        ? refined.content
        : JSON.stringify(refined.content);
    }
  }

  return stateUpdate;
}
