/**
 * 轻量 E2E 注册表
 */

import readingModePagination from './reading-mode-pagination.spec.mjs';
import piDetection from './pi-detection.spec.mjs';
import wereadApiDebug from './weread-api-debug.spec.mjs';

export const e2eLightSpecs = [
	readingModePagination,
	piDetection,
	wereadApiDebug,
];
