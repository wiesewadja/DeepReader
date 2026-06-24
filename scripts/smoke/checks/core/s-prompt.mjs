/**
 * S-PROMPT: Prompt 注册完整性检查
 *
 * 验证 registerAllPrompts() 成功执行后，promptRegistry 中注册了全部模块。
 * 捕获 "注册静默缺失" 场景（插件加载正常但 prompt 模块未注册）。
 *
 * 锚定: feat/prompt-management 代码审查修复
 */

import { evalObsidian } from '../../lib/obsidian-cli.mjs';

const EXPECTED_MODULE_COUNT = 15;
const EXPECTED_MODULE_PREFIXES = [
  'inspectional',
  'pre-search',
  'analytical',
  'syntopical',
  'formatter',
  'advisor',
  'diagram',
  'memory.consolidation',
  'memory.compression',
  'profile.extract',
  'profile.weread-extract',
  'profile.synthesize',
  'tts.oral-rewrite',
  'tts.voice-reply',
  'tts.system',
];

export default {
  id: 'S-PROMPT',
  name: 'Prompt 注册完整性',
  level: 'core',
  feature: null,
  timeout: 10_000,

  async run({ log }) {
    const result = await evalObsidian(`
      (() => {
        const plugin = app.plugins.plugins['deepreader-dev'];
        if (!plugin) return { ok: false, error: '插件未加载' };

        const registry = plugin.api?.promptRegistry;
        if (!registry) return { ok: false, error: 'promptRegistry 未暴露在 api 上' };

        const all = registry.list();
        const ids = all.map(function(m) { return m.id; }).sort();
        const missing = [];

        return {
          ok: true,
          count: all.length,
          ids: ids,
        };
      })()
    `);

    if (!result.ok) {
      throw new Error(result.error || 'prompt 注册检查失败');
    }

    if (result.count < EXPECTED_MODULE_COUNT) {
      throw new Error(
        `prompt 模块数不足: ${result.count}/${EXPECTED_MODULE_COUNT}` +
        `\n  └ 已注册: ${(result.ids || []).join(', ')}`
      );
    }

    const registered = new Set(result.ids || []);

    // 前缀匹配：忽略版本后缀（.s0, .s2, .s2-pre 等）
    const prefixMatch = function(prefix) {
      for (const id of registered) {
        if (id === prefix || id.startsWith(prefix + '.')) return true;
      }
      return false;
    };

    const missingModules = EXPECTED_MODULE_PREFIXES.filter(function(prefix) { return !prefixMatch(prefix); });
    if (missingModules.length > 0) {
      throw new Error(
        `缺失预期的 prompt 模块: ${missingModules.join(', ')}` +
        `\n  └ 已注册: ${(result.ids || []).join(', ')}`
      );
    }

    log?.info?.(`count=${result.count}, ids=${(result.ids || []).join(',')}`);
    return { ok: true };
  },
};
