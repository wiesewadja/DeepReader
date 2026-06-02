# 测试策略：阅读进度反例回归

> 制定日期：2026-06-02 | 状态：DRAFT | 制定者：test-engineer subagent
> 关联 SPEC：`docs/specs/SPEC-remove-progress-add-archive.md`
> 关联 commit：`c0da03bc feat: 删除阅读进度 + 新增书籍软归档`
> 关联调研：本次 grep 验证（2026-06-02）

---

## 1. 任务定性

**反例回归测试** —— 验证 `c0da03bc` 完整删除了"阅读进度"功能，且未残留死代码、可执行入口、可被新功能调用的旧 API。

**不是**重实现或重构。代码不应回归。失败 = 有残留 = 需要清理 + 修正 SPEC 验收清单。

## 2. 5 项前置假设

1. **删除彻底**：6 层（核心模型 / 运行时追踪 / 单元测试 / 书库卡片 / Agent 拟人化 / 里程碑）已全部移除
2. **替代品就位**：软归档（`src/pageindex/archive.ts`）已作为替代功能上线，且 `archive.test.ts` 通过
3. **行为不变**：除"不再有进度"外，书库、Agent、Sidebar 行为不变
4. **历史数据保留**：`reading-progress.json` 残留文件不主动删除（SPEC §2.1 注）
5. **wechat 残留待清理**：`src/weread/types.ts:28` 仍有 `readingProgress?: number;` 字段 —— SPEC 验收清单未覆盖，**本策略要补**（详见 §5.2）

## 3. 风险评估

| 维度 | 评估 |
|------|------|
| 业务影响 | **中**（删除的是低使用率功能，但残留会导致编译/类型/运行时混乱）|
| 修改范围 | **跨模块**（pageindex / views / agent / weread / styles / 测试）|
| 依赖 | **混合**（mock：旧 API 断言；真实：archive.toggle 流程）|
| 残留风险 | **高**（已发现 1 处：weread/types.ts，验证不充分可能漏检）|

## 4. 选用策略

- [x] **策略 C：重构**（主）—— 验证"删除"是恒等操作，未引入回归
- [x] **策略 A：新功能**（辅）—— 验证替代品 `archive.ts` 端到端可用

不适用：B（不是 Bug 修复）、D（不是性能任务）、E（不是新集成）。

## 5. 测试层级

### 5.1 新增 3 个测试资产

| # | 层级 | 路径 | 形式 | 职责 |
|---|------|------|------|------|
| 1 | 单元 | `tests/unit/pageindex/test_reading_progress_anti_regression.test.ts` | vitest 反例 | 静态断言：旧 API/字段/文件不应再存在 |
| 2 | 冒烟 | `scripts/smoke/checks/S-RP-ANTI.check.mjs` | evalObsidian | 运行时反例：插件加载后任何 reading-progress 引用立即报错 |
| 3 | 轻量 E2E | `scripts/e2e-light/specs/archive-toggle.spec.mjs` | evalObsidian | 流程正向：archive toggle 单选 + 批量 + 还原 |

新增后总数：单元 14 → 15 / 冒烟 core 9 → 10 / 轻量 16 → 17。

### 5.2 单元测试反例清单（必含断言）

```ts
// tests/unit/pageindex/test_reading_progress_anti_regression.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../../../src');

// 零匹配兜底：grep 零匹配 exit 1
function grepSrc(pattern: string, options = ''): string {
  try {
    return execSync(`grep -rE ${options} "${pattern}" "${SRC}" --include="*.ts"`, { encoding: 'utf-8' });
  } catch (e: any) {
    if (e.status === 1) return '';
    throw e;
  }
}

// 绝对路径 → 相对 SRC 的统一表示
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
    expect(fs.existsSync(path.resolve(__dirname, './reading-progress.test.ts'))).toBe(false);
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
```

### 5.3 已知残留 + 处置（2026-06-02 修订）

`src/weread/types.ts:28` —— `readingProgress?: number;`

**核验结果**（2026-06-02）：
- ✅ 0 处 `.readingProgress` 点访问
- ✅ 0 处 `readingProgress` 在测试或其他模块引用
- ⚠️ 内部已用 `WereadBook.progress: number`（line 189）规范化，是不同字段
- ⚠️ 删除会让 `WereadBookItem` 类型不再匹配 WeRead API 实际响应

**采用方案 C**：加 JSDoc `@deprecated` 注释，TypeScript-aware（IDE 显示删除线），保留 API 契约记录。

```ts
// src/weread/types.ts:28
/**
 * @deprecated 由 WeRead 网关 API 返回，但内部已统一规范化为 `WereadBook.progress` 字段（line 189）。
 * 保留仅为记录 API 契约，c0da03bc 后前端无任何消费方（见 docs/test-strategies/reading-progress-anti-regression.md §5.3）。
 * 新代码不应读取此字段；如有需要请从 `WereadBook.progress` 取值。
 */
readingProgress?: number;
```

**SPEC 验收对照**：策略的单元测试（§5.2 用例 3）将 `src/weread/types.ts` 加入 `allowed` 白名单，让"无 reading-progress 引用"的断言精确化（= 唯一允许的 1 处是带 @deprecated 的类型字段）。

### 5.4 冒烟测试内容草稿

```js
// scripts/smoke/checks/S-RP-ANTI.check.mjs
import { evalObsidian } from '../../lib/obsidian-cli.mjs';

const BLACKLIST = [
  'readingProgress', 'progressTracker', 'ReadingProgressTracker',
  'milestones', 'MilestoneRecorder', 'readingProgressCache',
  'loadReadingProgresses', 'initReadingProgress',
  'navigateToLastReadChapter', 'flushProgressSave',
  'trackReadingProgress', 'getTotalChapters',
  'generateReadingSteps', 'ReadingProgressItem',
];

export default {
  id: 'S-RP-ANTI',
  name: '阅读进度反例（运行时验证）',
  level: 'core',
  feature: 'F-13',  // F-13 书库
  timeout: 10_000,

  async run({ log }) {  // ⚠️ ctx 中没有 evalObsidian，必须模块 import
    const t0 = Date.now();

    const refsRaw = await evalObsidian(`
      (() => {
        const p = app.plugins.plugins['deepreader'];
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
```

**注册**：`scripts/smoke/checks/core/index.mjs` 追加 `sRpAnti`（位置：S-24 之后，core 9 → 10）。

### 5.5 轻量 E2E 内容草稿

**关键修正**：原草稿误用 `p.pageindex.archive.toggleArchive(target)`。真实 API 是 CJS 函数 `toggleArchive(vaultPath, bookId)`（在 `src/pageindex/archive.ts`），evalObsidian 调不到。本 spec 改为**验证 I/O 契约** —— 直接读写 `catalog.json`（实际数据来源），函数本身由 `archive.test.ts` 单测覆盖。

**catalog.json 真实路径**：`<vaultPath>/.obsidian/plugins/deepreader/pageindex/catalog.json`（由 `src/pageindex/paths.ts` 的 `getCatalogPath()` 计算，PAGEINDEX_DIR = `.obsidian/plugins/deepreader/pageindex`）。

**实际数据**：test-vault 的 catalog.json 通常含 1+ 本书（实测 2026-06-02 含 `9f77964d`），不会为空。

```js
// scripts/e2e-light/specs/archive-toggle.spec.mjs
const CATALOG_PATH = '.obsidian/plugins/deepreader/pageindex/catalog.json';

export default {
  id: 'archive-toggle',
  name: '书籍软归档切换流程（I/O 契约）',
  feature: 'F-13',
  timeout: 30_000,
  requires: {
    files: [CATALOG_PATH],
  },

  async run({ log, evalObsidian }) {
    const steps = [];
    const pass = (n, d, det) => steps.push({ name: n, status: 'pass', duration: d, detail: det });
    const fail = (n, d, e) => steps.push({ name: n, status: 'fail', duration: d, error: e.message });
    const skip = (n, d, r) => steps.push({ name: n, status: 'skip', duration: d, error: r });

    // Step 1: 读 catalog → Step 2-4 操作 → Step 5 还原
    // （完整代码见实际文件，结构同 §5.2 / §5.4 的 helper 抽取风格）
  },
};
```

## 6. 执行顺序

### Phase 0：基线核验（5 min）

- [ ] 读 SPEC §2.4 验收清单 5 条
- [ ] 跑 `npm run build`（确认 c0da03bc 后无编译错误）
- [ ] 跑 `npm run test:run`（记录当前通过数 = 基线）
- [ ] grep 全量验证（用本策略 §5.2 同样的命令）

退出：build exit 0、测试通过数 = 基线、grep 仅 1 处残留（weread/types.ts）。

### Phase 1：写复现测试（单元，10 min）

- [ ] 新建 `tests/unit/pageindex/test_reading_progress_anti_regression.test.ts`
- [ ] 跑 `npm run test:run -- test_reading_progress_anti_regression.test.ts`
- [ ] **必须全部 PASS**（如果不是 = 残留 = 立即停下来汇报）

### Phase 2：注册冒烟（5 min）

- [ ] 新建 `scripts/smoke/checks/S-RP-ANTI.check.mjs`
- [ ] 编辑 `scripts/smoke/smoke.mjs` 的 core level 列表
- [ ] 跑 `npm run smoke:core`
- [ ] S-RP-ANTI 必须通过

### Phase 3：写轻量 E2E（archive-toggle，10 min）

- [ ] 新建 `scripts/e2e-light/specs/archive-toggle.spec.mjs`
- [ ] 跑 `npm run e2e-light`
- [ ] archive-toggle 必须通过（5 步全 pass）

### Phase 4：效果评估（1 min）

- [ ] 跑 `npm run test:run` 确认无回归
- [ ] 跑 `npm run smoke:core` 确认 S-RP-ANTI 不破坏其他 9 个
- [ ] 跑 `npm run e2e-light` 确认 16 → 17 specs 全 pass
- [ ] 填 §9 评估表

## 7. 退出条件

- [ ] 单元：新增文件 5 个用例全 pass
- [ ] 冒烟：S-RP-ANTI 通过 + 其他 9 个不退化
- [ ] 轻量 E2E：archive-toggle 5 步全 pass + 其他 16 个不退化
- [ ] 覆盖率：`src/pageindex/` ≥ 80%（archive.test.ts 已 22 个用例 + 新增 5 个）
- [ ] 假阳性 = 0
- [ ] 已知残留 weread/types.ts:28 显式记录在策略中

## 8. 预估时间

| 阶段 | 时长 |
|------|------|
| Phase 0 基线 | ~5 min |
| Phase 1 单元 | ~10 min |
| Phase 2 冒烟 | ~5 min |
| Phase 3 轻量 E2E | ~10 min |
| Phase 4 评估 | ~1 min |
| 间隙（build + deploy + reload）| ~5 min |
| **总计** | **~36 min** |

（注：原估 ~26 min 是省略了 Phase 0 基线和间隙时间，修正为 ~36 min。）

## 9. 效果评估（4 问）

| 评估项 | 预期 | 不达标时调整 |
|--------|------|-------------|
| 目标达成 | 单元/冒烟/轻量各 1 项新增，3 档全 pass | 补缺失层 |
| 时间预算 | ≤ 40 min | 跳过 archive-toggle 走冒烟替代 |
| 假阳性率 | 0（反例断言为强类型检查）| 简化 grep 表达式 |
| 覆盖空白 | 6 层 + 1 处残留全部覆盖 | 加 spec 检查 weread 字段访问者 |

## 10. 关联物

- 策略元数据：`docs/test-strategies/reading-progress-anti-regression.md`（本文件）
- 调研结果：2026-06-02 grep（§5.3）
- 删除 commit：`c0da03bc`
- 规格：`docs/specs/SPEC-remove-progress-add-archive.md` §2.4
- 替代品单测：`tests/unit/pageindex/archive.test.ts`（22 用例）
