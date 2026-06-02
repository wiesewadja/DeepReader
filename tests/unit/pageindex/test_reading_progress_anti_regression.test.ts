import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../../src');

function grepSrc(pattern: string, options = ''): string {
  try {
    return execSync(
      `grep -rE ${options} "${pattern}" "${SRC}" --include="*.ts"`,
      { encoding: 'utf-8' }
    );
  } catch (e: any) {
    // grep 零匹配返回 exit 1，期望的"空"场景
    if (e.status === 1) return '';
    throw e;
  }
}

function toRelative(absolutePath: string): string {
  return path.relative(SRC, absolutePath).split(path.sep).join('/');
}

describe('阅读进度反例回归（c0da03bc 后状态）', () => {
  it('核心数据文件已删除', () => {
    expect(fs.existsSync(path.join(SRC, 'pageindex/reading-progress.ts'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'views/sidebar/reading-progress-tracker.ts'))).toBe(false);
    expect(fs.existsSync(path.join(SRC, 'agent/memory/milestones.ts'))).toBe(false);
  });

  it('旧测试文件已删除', () => {
    expect(fs.existsSync(
      path.resolve(__dirname, './reading-progress.test.ts')
    )).toBe(false);
  });

  it('src/ 无 reading-progress 引用（白名单 1 处: weread/types.ts）', () => {
    const result = grepSrc('reading[-_]progress|readingProgress', '-l');
    const files = result.trim().split('\n').filter(Boolean).map(toRelative);
    // 唯一允许的残留：weread/types.ts（已加 @deprecated 注释，2026-06-02）
    // 注意：toRelative 会剥掉 src/ 前缀
    const allowed = new Set(['weread/types.ts']);
    const violations = files.filter(f => !allowed.has(f));
    expect(violations).toEqual([]);
  });

  it('无 progressTracker / ReadingProgressTracker / MilestoneRecorder 引用', () => {
    const result = grepSrc('progressTracker|ReadingProgressTracker|MilestoneRecorder', '-l');
    expect(result.trim()).toBe('');
  });

  it('无 generateReadingSteps / ReadingProgressItem 引用', () => {
    const result = grepSrc('generateReadingSteps|ReadingProgressItem', '-l');
    expect(result.trim()).toBe('');
  });
});
