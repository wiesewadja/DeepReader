/**
 * IntentRouter - 意图路由器
 *
 * 基于正则匹配快速判断用户意图，动态限制 LLM 可用工具集
 */

import type { IntentRule, IntentResult, IntentRulesConfig } from './types.js';
import { agentLog } from '../../utils/logger.js';
import DEFAULT_RULES_JSON from './intent-rules.json';

export class IntentRouter {
  private rules: IntentRule[];
  private fallbackTools: string[];
  private fallbackIntent: string;

  constructor(config?: IntentRulesConfig) {
    const cfg = config || (DEFAULT_RULES_JSON as IntentRulesConfig);
    this.rules = cfg.rules;
    this.fallbackTools = cfg.fallback.tools;
    this.fallbackIntent = cfg.fallback.intent;
  }

  /**
   * 分析用户意图，返回允许的工具和系统指令
   */
  analyze(userInput: string): IntentResult {
    const detectedIntents: string[] = [];
    const allowedTools = new Set<string>();

    // 1. 遍历规则，匹配意图
    for (const rule of this.rules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(userInput)) {
          detectedIntents.push(rule.intent);
          rule.tools.forEach(t => allowedTools.add(t));
          agentLog(`[IntentRouter] 命中规则: ${rule.id} -> ${rule.intent}`);
        }
      } catch (err) {
        agentLog(`[IntentRouter] 规则正则错误: ${rule.id}`, err);
      }
    }

    // 2. 兜底：无匹配时，默认允许微观检索
    if (detectedIntents.length === 0) {
      detectedIntents.push(this.fallbackIntent);
      this.fallbackTools.forEach(t => allowedTools.add(t));
      agentLog(`[IntentRouter] 无匹配，使用兜底: ${this.fallbackIntent}`);
    }

    // 3. 生成动态系统指令
    const systemNote = this.buildSystemNote(detectedIntents, allowedTools);

    agentLog(`[IntentRouter] 检测意图: ${detectedIntents.join(', ')}`);
    agentLog(`[IntentRouter] 允许工具: ${Array.from(allowedTools).join(', ')}`);

    return {
      allowedTools: Array.from(allowedTools),
      systemNote,
      detectedIntents,
    };
  }

  /**
   * 构建动态系统指令
   */
  private buildSystemNote(intents: string[], tools: Set<string>): string {
    return `<system_note>
【Router 强制路由】
系统已判定用户意图包含：${intents.join('、')}。
你当前仅被允许使用以下工具：[${Array.from(tools).join(', ')}]。
严禁使用其他未列出的工具。
</system_note>`;
  }
}
