/**
 * 时间格式化工具函数
 */

/**
 * 格式化时间为相对时间或完整时间
 * - 7天内显示相对时间（如"2分钟前"）
 * - 超过7天显示完整时间（如"1月15日"）
 *
 * @param dateString - ISO 8601 格式的时间字符串
 * @returns 格式化后的时间字符串
 */
export function formatTimeAgo(dateString: string): string {
	const date = new Date(dateString);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) {
		return '刚刚';
	} else if (diffMins < 60) {
		return `${diffMins}分钟前`;
	} else if (diffHours < 24) {
		return `${diffHours}小时前`;
	} else if (diffDays < 7) {
		return `${diffDays}天前`;
	} else {
		// 超过7天显示完整日期和时间
		const month = date.getMonth() + 1;
		const day = date.getDate();
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		return `${month}月${day}日 ${hours}:${minutes}`;
	}
}
