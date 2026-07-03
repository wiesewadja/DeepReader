/**
 * Mapping Stats — 从 syncState 向 mapping 注入统计信息
 */

import type { WereadMapping, WereadSyncState } from '../types';
import { formatReadingTime } from '../utils/helpers';

/**
 * 将 syncState 中的同步数据注入到 mapping 条目的 stats 字段。
 * 返回新的 mapping 对象，不修改原始对象。
 */
export function enrichMappingWithStats(
	mapping: WereadMapping,
	syncState: WereadSyncState,
): WereadMapping {
	const result: WereadMapping = {
		mappings: {},
	};

	for (const [wereadBookId, entry] of Object.entries(mapping.mappings)) {
		const synced = syncState.syncedBooks[wereadBookId];

		result.mappings[wereadBookId] = synced
			? {
				...entry,
				stats: {
					noteCount: synced.noteCount,
					reviewCount: synced.reviewCount,
					progress: synced.progress ?? 0,
					readingTime: formatReadingTime(synced.readingTime ?? 0),
					lastReadDate: synced.lastSyncTime
						? new Date(synced.lastSyncTime).toISOString().split('T')[0]
						: '',
				},
			}
			: { ...entry };
	}

	return result;
}
