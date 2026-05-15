/**
 * S3: Syntopical Reading Node — LangGraph node for multi-book analysis
 *
 * Flow:
 * 1. Scan Vault for all indexed books
 * 2. Parallel search across books (vector + proposition)
 * 3. Inject results into LLM context
 * 4. LLM fusion analysis (consensus vocabulary + issues + positions)
 * 5. Output coherent text with cross-book wiki links
 */

import type { RunnableConfig } from '@langchain/core/runnables';
import { RunnableLambda } from '@langchain/core/runnables';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { CognitiveEngineState } from '../state';
import { interrupt } from '@langchain/langgraph';
import { agentLog as log } from '../../../utils/logger.js';
import { syntopicalSearch, formatSyntopicalContext } from '../../utils/syntopical-search.js';
import { SYNTOPICAL_MAX_BOOKS, SYNTOPICAL_TOP_K_PER_BOOK, SYNTOPICAL_SNAPSHOT_LIMIT } from '../../config/agent-constants.js';
import type { SyntopicalInput } from '../node-io.js';
import { resolveRoleConfig } from '../../../config/providers.js';
import { toEmbeddingOptions } from '../../../config/role-adapters.js';
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

/**
 * S3 Syntopical node: multi-book fusion analysis.
 */
export async function syntopicalNode(
  state: CognitiveEngineState,
  config: RunnableConfig,
): Promise<Partial<CognitiveEngineState>> {
  const { rewrittenQuery }: SyntopicalInput = state;
  const ctx = config.configurable?.sharedContext;
  const mainModel = config.configurable?.mainModel;
  const toolContext = config.configurable?.toolContext;

  if (!mainModel || !toolContext?.app) {
    console.warn('[S3 Syntopical] Missing required config, returning empty result.');
    return {
      analysisResult: '',
      toolResultsSnapshot: [],
    };
  }

  const vaultPath = (toolContext.app.vault.adapter as { basePath: string }).basePath || '';
  const query = rewrittenQuery || ctx?.rawUserQuery || '';
  const settings = toolContext.plugin?.settings;
  const embeddingRole = settings ? resolveRoleConfig('embedding', settings) : null;
  const embedding = embeddingRole ? toEmbeddingOptions(embeddingRole) : undefined;

  log(`[S3 Syntopical] Starting multi-book search for: "${query.slice(0, 50)}"`);

  // 1. Multi-book search
  const searchRunnable = RunnableLambda.from(
    async () => syntopicalSearch({
      query,
      vaultPath,
      embedding,
      maxBooks: SYNTOPICAL_MAX_BOOKS,
      topKPerBook: SYNTOPICAL_TOP_K_PER_BOOK,
    })
  ).withConfig({ runName: 'syntopical_search' });

  const searchResult = await searchRunnable.invoke({}, { callbacks: config.callbacks });

  // 2. Handle edge cases
  if (searchResult.books.length === 0) {
    log('[S3 Syntopical] No indexed books found');
    return {
      analysisResult: 'Vault 中没有已索引的书籍。请先在 Library 中添加书籍并完成索引。',
      toolResultsSnapshot: [{
        toolName: 'syntopical_search',
        args: { query },
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

  // 3. Build context and call LLM
  const systemPrompt = buildSyntopicalSystemPrompt();
  const userMessage = buildSyntopicalUserMessage(query, searchResult.books);

  log(`[S3 Syntopical] Calling LLM with ${searchResult.books.length} books context`);

  const response = await mainModel.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userMessage),
  ], config);

  let content = typeof response.content === 'string'
    ? response.content
    : JSON.stringify(response.content);

  // 4. Self-verification (wiki link validation)
  const toolResults: SyntopicalToolResult[] = searchResult.books.flatMap(book =>
    book.results.flatMap(r =>
      r.matchedBlocks.map(block => ({
        toolName: 'syntopical_search',
        args: { bookId: book.bookId, nodeId: r.nodeId },
        result: block.content,
        originalResultLength: block.content.length,
      }))
    )
  );

  const verificationResult = await verifyAndCleanContent(content, toolResults);
  content = verificationResult.content;

  log(`[S3 Syntopical] Analysis complete, ${verificationResult.totalRefs} refs, ${verificationResult.ghostRefs} ghost`);

  // 5. HITL interrupt (optional)
  // Keep toolResultsSnapshot limited but include all referenced results
  const snapshotLimit = SYNTOPICAL_SNAPSHOT_LIMIT;
  const stateUpdate: Partial<CognitiveEngineState> = {
    analysisResult: content,
    toolResultsSnapshot: toolResults.slice(0, Math.min(snapshotLimit, toolResults.length)),
  };

  const enableHumanReview = config.configurable?.enableHumanReview as boolean | undefined;
  if (enableHumanReview) {
    const resumeValue = interrupt({
      nodeId: 'syntopical',
      question: 'S3 主题阅读完成，是否满意当前分析？',
      content,
    }) as { approved: boolean; feedback: string } | undefined;

    if (resumeValue?.approved === false && resumeValue.feedback) {
      const refinedResponse = await mainModel.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
        new HumanMessage(`用户反馈：${resumeValue.feedback}\n\n请根据反馈补充或修正分析。`),
      ], config);

      const refinedContent = typeof refinedResponse.content === 'string'
        ? refinedResponse.content
        : JSON.stringify(refinedResponse.content);

      stateUpdate.analysisResult = refinedContent;
    }
  }

  return stateUpdate;
}