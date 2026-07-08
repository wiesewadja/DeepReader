/**
 * 轻量 E2E 注册表
 *
 * 迁移自 tests/e2e-cli/ 的测试已整合到此处
 */

import readingModePagination from './reading-mode-pagination.spec.mjs';
import wereadApiDebug from './weread-api-debug.spec.mjs';
import wereadUi from './weread-ui.spec.mjs';
import wereadSync from './weread-sync.spec.mjs';
import pdfParsing from './pdf-parsing.spec.mjs';
import epubParsingQuality from './epub-parsing-quality.spec.mjs';
import summaryDescription from './summary-description.spec.mjs';
import epubIndexExport from './epub-index-export.spec.mjs';
import pdfIndexExport from './pdf-index-export.spec.mjs';
import indexTrace from './index-trace.spec.mjs';
import langgraphAgent from './langgraph-agent.spec.mjs';
import evalAgent from './eval-agent.spec.mjs';
import followupCoherence from './followup-coherence.spec.mjs';
import scopeNodefilemap from './scope-nodefilemap.spec.mjs';
import l2Vectorization from './l2-vectorization.spec.mjs';
import archiveToggle from './archive-toggle.spec.mjs';
import lastPageResume from './last-page-resume.spec.mjs';
import epubFullPipeline from './epub-full-pipeline.spec.mjs';
import securitySanitizer from './security-sanitizer.spec.mjs';
import writeNoteSecurity from './write-note-security.spec.mjs';
import voicePersistence from './voice-persistence.spec.mjs';
import selectionToolbarDelegation from './selection-toolbar-delegation.spec.mjs';
import archGuardRules from './arch-guard-rules.spec.mjs';
import bookSearch from './book-search.spec.mjs';
import indexIntegrity from './index-integrity.spec.mjs';
import selectionQuote from './selection-quote.spec.mjs';
import excalidrawVisual from './excalidraw-visual.spec.mjs';
import pushToTalk from './push-to-talk.spec.mjs';
import agentMultiturnAiEcon from './agent-multiturn-ai-econ.spec.mjs';

export const e2eLightSpecs = [
	readingModePagination,
	wereadApiDebug,
	wereadUi,
	wereadSync,
	pdfParsing,
	epubParsingQuality,
	summaryDescription,
	epubIndexExport,
	pdfIndexExport,
	indexTrace,
	langgraphAgent,
	evalAgent,
	followupCoherence,
	scopeNodefilemap,
	l2Vectorization,
	archiveToggle,
	lastPageResume,
	epubFullPipeline,
	securitySanitizer,
	writeNoteSecurity,
	voicePersistence,
	selectionToolbarDelegation,
	archGuardRules,
	bookSearch,
	indexIntegrity,
	selectionQuote,
	excalidrawVisual,
	pushToTalk,
	agentMultiturnAiEcon,
];
