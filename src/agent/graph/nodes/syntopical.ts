/**
 * S3: Syntopical Reading Node — LangGraph node for multi-book analysis
 *
 * Flow:
 * 1. Parallel vector + proposition search across books
 * 2. LLM fusion analysis (consensus vocabulary + issues + positions)
 * 3. Wiki link self-verification
 * 4. Optional HITL review
 */

import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import type { RunnableConfig } from '@langchain/core/runnables';
import { interrupt } from '@langchain/langgraph';
import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions, toRerankerOptions } from '../../../config/role-adapters.js';
import { agentLog as log } from '../../../utils/logger.js';
import { getVaultPath } from '../../../utils/mobile-fs.js';
import { SYNTOPICAL_MAX_BOOKS, SYNTOPICAL_TOP_K_PER_BOOK, SYNTOPICAL_SNAPSHOT_LIMIT } from '../../config/agent-constants.js';
import { syntopicalSearch, type SyntopicalBookResult, type SyntopicalSearchResult } from '../../utils/syntopical-search.js';
import type { SyntopicalInput } from '../node-io.js';
import { syntopicalPrompt } from '../../prompts/core/syntopical.js';
import { buildSyntopicalUserMessage } from '../../prompts/utils/index.js';
import type { SharedContext } from '../shared-context.js';
import type { CognitiveEngineState } from '../state';
import { verifyAndCleanContent } from '../utils/self-verification.js';
import { getGraphConfigurable } from '../configurable.js';

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
  const cfg = getGraphConfigurable(config);
  const ctx = cfg.sharedContext;
  const mainModel = cfg.mainModel;
  const toolContext = ctx.toolContext;

  if (!mainModel || !toolContext?.vault?.app) {
    log('[S3 Syntopical] Missing required config, returning empty result.');
    return { analysisResult: '', toolResultsSnapshot: [] };
  }

  // 桌面端用实际 basePath，移动端为空但会走 app 分支
  const vaultPath = getVaultPath(toolContext.vault.app) || '';
  const query = rewrittenQuery || ctx.rawUserQuery || '';
  const settings = toolContext.vault.plugin?.settings;
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
      bookIds: ctx?.toolContext?.crossBook?.booklistBookIds,
      knownBooks: ctx?.toolContext?.crossBook?.indexedBooks,
      app: toolContext.vault.app,
    })
  ).withConfig({ runName: 'syntopical_search' }).invoke({}, { callbacks: config.callbacks });

  // 2. Edge cases
  const fallback = handleInsufficientResults(searchResult);
  if (fallback) return fallback;

  // 3. LLM synthesis
  const systemPrompt = syntopicalPrompt.locales.zh.systemPrompt;
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

  const enableHumanReview = cfg.enableHumanReview;
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
