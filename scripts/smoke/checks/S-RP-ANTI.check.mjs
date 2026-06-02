/**
 * S-RP-ANTI: 阅读进度反例（运行时验证）
 *
 * 锚定: c0da03bc 后回归保护
 * 触发:  加载插件实例 + 全局 window，断言旧 API/模块不应暴露
 * 断言:  黑名单字段/方法在 plugin 实例上 typeof === 'undefined'
 *
 * 注意: evalObsidian 是模块级 import（参考 core/s-17.mjs:22），
 *       ctx 中没有 evalObsidian（smoke.mjs:160-167）。
 */

import { evalObsidian } from '../lib/obsidian-cli.mjs';

const BLACKLIST = [
  'readingProgress',
  'progressTracker',
  'ReadingProgressTracker',
  'milestones',
  'MilestoneRecorder',
  'readingProgressCache',
  'loadReadingProgresses',
  'initReadingProgress',
  'navigateToLastReadChapter',
  'flushProgressSave',
  'trackReadingProgress',
  'getTotalChapters',
  'generateReadingSteps',
  'ReadingProgressItem',
];

export default {
  id: 'S-RP-ANTI',
  name: '阅读进度反例（运行时验证）',
  level: 'core',
  feature: 'F-13',  // F-13 书库
  timeout: 10_000,

  async run({ log }) {
    const t0 = Date.now();

    // 1. 插件实例上不应暴露旧 API
    const refsRaw = await evalObsidian(`
      (() => {
        const p = app.plugins.plugins['deepreader-dev'];
        if (!p) throw new Error('插件未加载');
        const blacklist = ${JSON.stringify(BLACKLIST)};
        const hits = blacklist.filter(k => typeof p[k] !== 'undefined');
        return JSON.stringify({ hits, totalKeys: Object.keys(p).length });
      })()
    `);
    const refs = JSON.parse(refsRaw);
    if (refs.hits.length > 0) {
      throw new Error('插件实例暴露旧 API: ' + refs.hits.join(', '));
    }
    log.info(`扫描 ${BLACKLIST.length} 个黑名单键，0 命中（plugin keys=${refs.totalKeys}）`);

    // 2. window 上不应有 reading-progress 模块残留
    const moduleRaw = await evalObsidian(`
      (() => {
        const allKeys = Object.keys(window).filter(k => /reading[-_]?progress/i.test(k));
        return JSON.stringify({ allKeys });
      })()
    `);
    const mod = JSON.parse(moduleRaw);
    if (mod.allKeys.length > 0) {
      throw new Error('window 上有旧模块残留: ' + mod.allKeys.join(', '));
    }

    return { duration: Date.now() - t0 };
  },
};
