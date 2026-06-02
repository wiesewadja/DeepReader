/**
 * 轻量 E2E 注册表
 */

import readingModePagination from './reading-mode-pagination.spec.mjs';
import piDetection from './pi-detection.spec.mjs';
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
import scopeNodefilemap from './scope-nodefilemap.spec.mjs';
import l2Vectorization from './l2-vectorization.spec.mjs';
import archiveToggle from './archive-toggle.spec.mjs';
import lastPageResume from './last-page-resume.spec.mjs';

export const e2eLightSpecs = [
	readingModePagination,
	piDetection,
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
	scopeNodefilemap,
	l2Vectorization,
	archiveToggle,
	lastPageResume,
];
