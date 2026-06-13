# WebdriverIO 测试评估报告

## 评估日期
2026-06-13

## 评估目的
确定哪些 WebdriverIO 测试可以迁移到轻量 E2E，哪些需要保留。

## 评估结果

### 可以迁移到轻量 E2E 的测试（已有覆盖）

| WebdriverIO 测试 | 轻量 E2E 覆盖 | 迁移建议 |
|------------------|----------------|----------|
| epub-index-export.e2e.ts | ✅ epub-index-export.spec.mjs | 可删除 |
| epub-parsing-quality.e2e.ts | ✅ epub-parsing-quality.spec.mjs | 可删除 |
| epub-user-flow.e2e.ts | ✅ epub-full-pipeline.spec.mjs | 可删除 |
| eval-agent.e2e.ts | ✅ eval-agent.spec.mjs | 可删除 |
| index-trace.e2e.ts | ✅ index-trace.spec.mjs | 可删除 |
| l2-vectorization.e2e.ts | ✅ l2-vectorization.spec.mjs | 可删除 |
| pdf-index-export.e2e.ts | ✅ pdf-index-export.spec.mjs | 可删除 |
| pdf-parsing.e2e.ts | ✅ pdf-parsing.spec.mjs | 可删除 |
| reading-mode-pagination.e2e.ts | ✅ reading-mode-pagination.spec.mjs | 可删除 |
| scope-nodefilemap.e2e.ts | ✅ scope-nodefilemap.spec.mjs | 可删除 |
| summary-description.e2e.ts | ✅ summary-description.spec.mjs | 可删除 |
| weread-api-debug.e2e.ts | ✅ weread-api-debug.spec.mjs | 可删除 |
| weread-sync.e2e.ts | ✅ weread-sync.spec.mjs | 可删除 |
| weread-ui.e2e.ts | ✅ weread-ui.spec.mjs | 可删除 |

### 需要保留的 WebdriverIO 测试

| WebdriverIO 测试 | 保留原因 |
|------------------|----------|
| langgraph-agent.e2e.ts | Agent 对话的核心流程测试，需要真实 UI 交互验证 |
| early-stop.e2e.ts | 早停机制测试，需要验证日志和 LangSmith trace |
| langsmith-trace.e2e.ts | LangSmith trace 验证，需要真实 API 调用 |
| example.e2e.ts | 示例文件，可以删除 |

### 建议删除的测试

| WebdriverIO 测试 | 删除原因 |
|------------------|----------|
| example.e2e.ts | 示例文件，无实际测试价值 |

## 迁移计划

### 阶段 1: 删除可迁移的测试
- 删除 14 个已有轻量 E2E 覆盖的 WebdriverIO 测试

### 阶段 2: 保留核心测试
- 保留 langgraph-agent.e2e.ts（Agent 对话核心流程）
- 保留 early-stop.e2e.ts（早停机制）
- 保留 langsmith-trace.e2e.ts（LangSmith trace 验证）

### 阶段 3: 清理示例文件
- 删除 example.e2e.ts

## 预期结果

- WebdriverIO 测试数量：18 → 3（减少 83%）
- 测试运行时间：~5min × 18 → ~5min × 3（减少 83%）
- 维护成本：大幅降低
