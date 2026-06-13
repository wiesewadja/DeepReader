/**
 * E2E 测试 DSL
 *
 * 声明式测试生成器，减少重复的测试模板代码
 */

import { PluginHelper } from './plugin.helper';
import { SidebarHelper } from './sidebar.helper';
import { ChatHelper } from './chat.helper';

const PLUGIN_ID = 'deepreader-dev';

interface TestScenario {
  name: string;
  bookId?: string;
  question: string;
  timeout?: number;
  assertions: {
    minLength?: number;
    maxLength?: number;
    mustContain?: string[];
    mustNotContain?: string[];
    traceValidation?: {
      hasRouter?: boolean;
      hasInspectional?: boolean;
      hasAnalytical?: boolean;
      hasFormatter?: boolean;
      minToolCalls?: number;
      maxToolCalls?: number;
    };
  };
}

interface TestSuiteConfig {
  suiteName: string;
  bookId: string;
  bookName: string;
  scenarios: TestScenario[];
  beforeEach?: () => Promise<void>;
  langsmith?: boolean;
}

/**
 * 生成 Agent 对话测试套件
 */
export function createAgentTestSuite(config: TestSuiteConfig): void {
  const { suiteName, bookId, bookName, scenarios, langsmith = false } = config;

  describe(suiteName, function () {
    this.timeout(600000);

    before(async function () {
      await PluginHelper.assertLoaded();
    });

    beforeEach(async function () {
      await new Promise(r => setTimeout(r, 3000));
      if (config.beforeEach) {
        await config.beforeEach();
      }
    });

    for (const scenario of scenarios) {
      it(scenario.name, async function () {
        const testStartTime = Date.now();
        const timeout = scenario.timeout || 120_000;

        // 打开 sidebar 并选择书籍
        await SidebarHelper.openWithBook(scenario.bookId || bookId);

        // 清空聊天历史
        await SidebarHelper.clearChatHistory();

        // 发送消息并等待响应
        const response = await ChatHelper.sendAndWait(scenario.question, timeout);
        console.log(`[E2E] Response: ${response.substring(0, 200)}`);

        // 基础断言
        expect(response).toBeTruthy();

        if (scenario.assertions.minLength) {
          expect(response.length).toBeGreaterThan(scenario.assertions.minLength);
        }

        if (scenario.assertions.maxLength) {
          expect(response.length).toBeLessThan(scenario.assertions.maxLength);
        }

        if (scenario.assertions.mustContain) {
          for (const text of scenario.assertions.mustContain) {
            expect(response).toContain(text);
          }
        }

        if (scenario.assertions.mustNotContain) {
          for (const text of scenario.assertions.mustNotContain) {
            expect(response).not.toContain(text);
          }
        }

        // LangSmith Trace 验证（可选）
        if (langsmith && scenario.assertions.traceValidation) {
          const { LangSmithHelper } = await import('./langsmith.helper');
          const langsmithHelper = new LangSmithHelper();

          if (langsmithHelper.isAvailable()) {
            const trace = await langsmithHelper.getAnalysis(Date.now() - testStartTime + 5000);
            if (trace.totalRuns > 0) {
              const tv = scenario.assertions.traceValidation;
              if (tv.hasRouter !== undefined) expect(trace.hasRouter).toBe(tv.hasRouter);
              if (tv.hasInspectional !== undefined) expect(trace.hasInspectional).toBe(tv.hasInspectional);
              if (tv.hasAnalytical !== undefined) expect(trace.hasAnalytical).toBe(tv.hasAnalytical);
              if (tv.hasFormatter !== undefined) expect(trace.hasFormatter).toBe(tv.hasFormatter);
              if (tv.minToolCalls !== undefined) expect(trace.toolCalls.length).toBeGreaterThanOrEqual(tv.minToolCalls);
              if (tv.maxToolCalls !== undefined) expect(trace.toolCalls.length).toBeLessThanOrEqual(tv.maxToolCalls);
            }
          }
        }
      });
    }
  });
}

/**
 * 生成简单的存在性测试
 */
export function createExistenceTest(testName: string, checkFn: () => Promise<boolean>): void {
  it(testName, async function () {
    const exists = await checkFn();
    expect(exists).toBe(true);
  });
}

/**
 * 生成 API 调用测试（不涉及 UI 交互）
 */
export function createApiTest(
  testName: string,
  apiFn: () => Promise<any>,
  assertions: (result: any) => void
): void {
  it(testName, async function () {
    const result = await apiFn();
    assertions(result);
  });
}
