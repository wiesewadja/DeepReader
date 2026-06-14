/**
 * Booklist Resolver — 是否升级到主题阅读（SYNTOPICAL）
 *
 * 仅当用户显式选择了书单（multi-book 模式）时才升级。
 * 不基于关键词（如"对比"）自动升级——这些词在单书讨论中常见。
 */

import { ReadingDepth } from '../graph/state.js';

/**
 * 升级到 SYNTOPICAL 当且仅当：用户选了书单 + 当前深度已 >= ANALYTICAL。
 *
 * @param hasBooklist 用户是否显式选择书单（crossBook.booklistBookIds.length > 0）
 */
export function upgradeToSyntopical(
	depth: ReadingDepth,
	hasBooklist: boolean,
): { depth: ReadingDepth; didUpgrade: boolean } {
	if (!hasBooklist) return { depth, didUpgrade: false };
	if (depth < ReadingDepth.ANALYTICAL) return { depth, didUpgrade: false };
	return { depth: ReadingDepth.SYNTOPICAL, didUpgrade: true };
}
