/**
 * IntentRouter - 意图路由器
 *
 * 基于正则匹配快速判断用户意图，动态限制 LLM 可用工具集
 */

import type { IntentRule, IntentResult, IntentRulesConfig } from './types.js';
import { agentLog } from '../../utils/logger.js';
import DEFAULT_RULES_JSON from './intent-rules.json';

// 默认最大迭代次数（当规则未指定时使用）
const DEFAULT_MAX_ITERATIONS = 4;

export class IntentRouter {
  private rules: IntentRule[];
  private fallbackTools: string[];
  private fallbackIntent: string;
  private fallbackMaxIterations: number;

  constructor(config?: IntentRulesConfig) {
    const cfg = config || (DEFAULT_RULES_JSON as IntentRulesConfig);
    this.rules = cfg.rules;
    this.fallbackTools = cfg.fallback.tools;
    this.fallbackIntent = cfg.fallback.intent;
    this.fallbackMaxIterations = cfg.fallback.maxIterations || DEFAULT_MAX_ITERATIONS;
  }

  /**
   * 分析用户意图，返回允许的工具、系统指令和最大迭代次数
   */
  analyze(userInput: string): IntentResult {
    const detectedIntents: string[] = [];
    const allowedTools = new Set<string>();
    let maxIterations: number | null = null; // 初始为 null，表示未设置

    // 1. 遍历规则，匹配意图
    for (const rule of this.rules) {
      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(userInput)) {
          detectedIntents.push(rule.intent);
          rule.tools.forEach(t => allowedTools.add(t));
          // 取所有匹配规则中最大的 maxIterations
          const ruleMax = rule.maxIterations || DEFAULT_MAX_ITERATIONS;
          if (maxIterations === null || ruleMax > maxIterations) {
            maxIterations = ruleMax;
          }
          agentLog(`[IntentRouter] 命中规则: ${rule.id} -> ${rule.intent}, maxIterations: ${rule.maxIterations || 'default'}`);
        }
      } catch (err) {
        agentLog(`[IntentRouter] 规则正则错误: ${rule.id}`, err);
      }
    }

    // 2. 兜底：无匹配时，使用 fallback 配置
    if (detectedIntents.length === 0) {
      detectedIntents.push(this.fallbackIntent);
      this.fallbackTools.forEach(t => allowedTools.add(t));
      maxIterations = this.fallbackMaxIterations;
      agentLog(`[IntentRouter] 无匹配，使用兜底: ${this.fallbackIntent}, maxIterations: ${maxIterations}`);
    }

    // 3. 如果 maxIterations 仍未设置（理论上不会发生），使用默认值
    if (maxIterations === null) {
      maxIterations = DEFAULT_MAX_ITERATIONS;
    }

    // 4. 生成动态系统指令
    const systemNote = this.buildSystemNote(detectedIntents, allowedTools);

    agentLog(`[IntentRouter] 检测意图: ${detectedIntents.join(', ')}`);
    agentLog(`[IntentRouter] 允许工具: ${Array.from(allowedTools).join(', ')}`);
    agentLog(`[IntentRouter] 动态迭代上限: ${maxIterations}`);

    return {
      allowedTools: Array.from(allowedTools),
      systemNote,
      detectedIntents,
      maxIterations,
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
