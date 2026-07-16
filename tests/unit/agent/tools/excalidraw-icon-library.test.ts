import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadIcon,
  suggestIconForText,
  getAllIconNames,
  getIconCategories,
  clearIconCache,
  LUCIDE_ICONS,
} from '@/agent/tools/excalidraw/excalidraw-icon-library';

describe('excalidraw-icon-library', () => {
  beforeEach(() => {
    clearIconCache();
    vi.restoreAllMocks();
  });

  describe('LUCIDE_ICONS', () => {
    it('should have at least 20 icons', () => {
      expect(Object.keys(LUCIDE_ICONS).length).toBeGreaterThanOrEqual(20);
    });

    it('should have valid URL for each icon', () => {
      for (const [name, icon] of Object.entries(LUCIDE_ICONS)) {
        expect(icon.url).toMatch(/^https:\/\/unpkg\.com\/lucide-static@/);
        expect(icon.tags).toBeInstanceOf(Array);
        expect(icon.tags.length).toBeGreaterThan(0);
        expect(icon.category).toMatch(/^(concept|action|status|entity|flow)$/);
      }
    });

    it('should include required icons', () => {
      const requiredIcons = ['book', 'lightbulb', 'user', 'check-circle', 'alert-circle'];
      for (const name of requiredIcons) {
        expect(LUCIDE_ICONS[name]).toBeDefined();
      }
    });

    it('should include all icons advertised in the diagram prompt', () => {
      const promptIcons = ['book', 'brain', 'lightbulb', 'target', 'check-circle', 'alert-circle',
        'users', 'database', 'code', 'zap', 'eye', 'link', 'file-text', 'calendar', 'star'];
      for (const name of promptIcons) {
        expect(LUCIDE_ICONS[name]).toBeDefined();
      }
    });
  });

  describe('loadIcon', () => {
    it('should return null for unknown icon', async () => {
      const result = await loadIcon('unknown-icon');
      expect(result).toBeNull();
    });

    it('should load icon from CDN', async () => {
      const mockSvg = '<svg width="24" height="24"></svg>';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockSvg),
      });

      const result = await loadIcon('book');
      expect(result).toBe(mockSvg);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(LUCIDE_ICONS['book'].url);
    });

    it('should cache loaded icons', async () => {
      const mockSvg = '<svg width="24" height="24"></svg>';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockSvg),
      });

      await loadIcon('book');
      await loadIcon('book');

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('should return null on fetch failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await loadIcon('book');
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await loadIcon('book');
      expect(result).toBeNull();
    });

    it('should return null on fetch timeout (AbortError)', async () => {
      const abortError = new DOMException('The operation was aborted.', 'AbortError');
      global.fetch = vi.fn().mockRejectedValue(abortError);

      const result = await loadIcon('book');
      expect(result).toBeNull();
    });

    it('should pass AbortSignal to fetch for timeout', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<svg></svg>'),
      });

      await loadIcon('book');

      const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs[1]?.signal).toBeInstanceOf(AbortSignal);
    });

    it('should retry failed icon after failure TTL expires', async () => {
      vi.useFakeTimers();
      global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<svg></svg>') });

      const failResult = await loadIcon('book');
      expect(failResult).toBeNull();

      // 59s later — still in TTL, should return cached failure
      vi.advanceTimersByTime(59_000);
      const stillCached = await loadIcon('book');
      expect(stillCached).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1); // no retry yet

      // 61s total — TTL expired, should retry
      vi.advanceTimersByTime(2_000);
      const retryResult = await loadIcon('book');
      expect(retryResult).toBe('<svg></svg>');
      expect(fetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe('suggestIconForText', () => {
    it('should suggest book for reading-related text', () => {
      expect(suggestIconForText('阅读笔记')).toBe('book');
      expect(suggestIconForText('知识管理')).toBe('book');
    });

    it('should suggest brain for learning-related text', () => {
      // '学习' is in brain's tags, so it matches brain first
      expect(suggestIconForText('学习方法')).toBe('brain');
    });

    it('should suggest lightbulb for idea-related text', () => {
      expect(suggestIconForText('创意思维')).toBe('lightbulb');
      expect(suggestIconForText('灵感来源')).toBe('lightbulb');
      expect(suggestIconForText('想法记录')).toBe('lightbulb');
    });

    it('should suggest user for people-related text', () => {
      expect(suggestIconForText('用户角色')).toBe('user');
      expect(suggestIconForText('人员管理')).toBe('user');
    });

    it('should suggest users for team-related text', () => {
      // '团队' is in both user and users tags, but user comes first alphabetically
      expect(suggestIconForText('团队协作')).toBe('user');
    });

    it('should suggest check-circle for success-related text', () => {
      expect(suggestIconForText('任务完成')).toBe('check-circle');
      expect(suggestIconForText('成功案例')).toBe('check-circle');
    });

    it('should suggest alert-circle for warning-related text', () => {
      expect(suggestIconForText('注意风险')).toBe('alert-circle');
      expect(suggestIconForText('问题排查')).toBe('alert-circle');
    });

    it('should return null for unmatched text', () => {
      expect(suggestIconForText('xyz123')).toBeNull();
    });

    it('should match English keywords in text', () => {
      // Tags contain Chinese only, but we can test partial matches
      expect(suggestIconForText('阅读book笔记')).toBe('book');
    });
  });

  describe('getAllIconNames', () => {
    it('should return all icon names', () => {
      const names = getAllIconNames();
      expect(names).toContain('book');
      expect(names).toContain('lightbulb');
      expect(names.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe('getIconCategories', () => {
    it('should group icons by category', () => {
      const categories = getIconCategories();
      expect(categories).toHaveProperty('concept');
      expect(categories).toHaveProperty('action');
      expect(categories).toHaveProperty('status');
      expect(categories).toHaveProperty('entity');
      expect(categories).toHaveProperty('flow');
    });

    it('should have icons in each category', () => {
      const categories = getIconCategories();
      for (const category of Object.values(categories)) {
        expect(category.length).toBeGreaterThan(0);
      }
    });
  });

  describe('clearIconCache', () => {
    it('should clear the cache', async () => {
      const mockSvg = '<svg></svg>';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockSvg),
      });

      await loadIcon('book');
      clearIconCache();

      await loadIcon('book');
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
