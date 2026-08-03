import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatTimeAgo } from '@/utils/time';

describe('formatTimeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('应返回 刚刚（不到1分钟）', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    const oneSecondAgo = new Date(now.getTime() - 1000).toISOString();
    expect(formatTimeAgo(oneSecondAgo)).toBe('刚刚');
  });

  it('应返回 N分钟前', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    const fiveMinsAgo = new Date(now.getTime() - 5 * 60000).toISOString();
    expect(formatTimeAgo(fiveMinsAgo)).toBe('5分钟前');
  });

  it('应返回 N小时前', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    const threeHoursAgo = new Date(now.getTime() - 3 * 3600000).toISOString();
    expect(formatTimeAgo(threeHoursAgo)).toBe('3小时前');
  });

  it('应返回 N天前（7天内）', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString();
    expect(formatTimeAgo(twoDaysAgo)).toBe('2天前');
  });

  it('应返回完整日期时间（超过7天）', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400000).toISOString();
    expect(formatTimeAgo(tenDaysAgo)).toBe('6月5日 12:00');
  });

  it('应正确处理零分钟差值', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    expect(formatTimeAgo(now.toISOString())).toBe('刚刚');
  });

  it('应正确处理59分钟（刚好不到1小时）', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    const fiftyNineMinsAgo = new Date(now.getTime() - 59 * 60000).toISOString();
    expect(formatTimeAgo(fiftyNineMinsAgo)).toBe('59分钟前');
  });

  it('应正确处理刚好7天（超过阈值显示日期）', () => {
    vi.useFakeTimers();
    const now = new Date('2024-06-15T12:00:00');
    vi.setSystemTime(now);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
    // 7天时 diffDays === 7，不满足 diffDays < 7，走日期分支
    expect(formatTimeAgo(sevenDaysAgo)).toBe('6月8日 12:00');
  });
});
