# S2-Pre 重构集成测试用例

## 变更概述

重构 analytical-pre-search.ts（566行→220行），拆分为 6 个新模块：
- `src/utils/text-utils.ts` — CJK_STOPWORDS 单份定义
- `src/agent/graph/utils/scoring-utils.ts` — 3 个纯评分函数
- `src/agent/graph/utils/formatters.ts` — 3 个格式化辅助函数
- `src/agent/graph/utils/keyword-search-fusion.ts` — 通用关键词搜索合并
- `src/agent/graph/nodes/pre-search-engine.ts` — 搜索引擎
- `src/agent/graph/nodes/early-stop-decider.ts` — 早停决策器

## 集成测试用例

### TC-001: CJK_STOPWORDS 单一来源一致性验证
**优先级**: P0  
**对应模块**: text-utils.ts, scoring-utils.ts, bm25.ts

**前置条件**:
- 项目中所有需要 CJK_STOPWORDS 的模块都从 `src/utils/text-utils.ts` 导入
- 无其他位置定义重复的停用词列表

**测试步骤**:
1. 在 `src/utils/text-utils.ts` 中修改 CJK_STOPWORDS（添加或删除一个停用词）
2. 运行单元测试：`npm run test:run`
3. 验证所有依赖 CJK_STOPWORDS 的模块都使用修改后的列表

**预期结果**:
- 修改后，所有使用 CJK_STOPWORDS 的模块（scoring-utils.ts, bm25.ts）都反映相同的修改
- 无硬编码的停用词列表在其他文件中
- 单元测试全部通过

**回归风险**: 高 — CJK_STOPWORDS 是搜索质量的关键组件

---

### TC-002: scoring-utils 纯函数与 CJK_STOPWORDS 交互验证
**优先级**: P0  
**对应模块**: scoring-utils.ts, text-utils.ts

**前置条件**:
- scoring-utils.ts 正确导入 CJK_STOPWORDS
- 测试环境已配置

**测试步骤**:
1. 使用包含停用词的关键词调用 `computeMaxTheoryBM25`
2. 验证停用词被正确过滤
3. 使用包含停用词的关键词调用 `computeKeywordCoverage`
4. 验证停用词不参与覆盖率计算

**预期结果**:
- `computeMaxTheoryBM25(['的', '搜索'], bm25Index)` 结果应与 `computeMaxTheoryBM25(['搜索'], bm25Index)` 相同
- `computeKeywordCoverage(['的', '搜索'], '搜索功能')` 应返回 1（仅计算'搜索'）

**回归风险**: 高 — 影响搜索置信度计算

---

### TC-003: keywordSearchFusion 并发搜索与结果合并
**优先级**: P0  
**对应模块**: keyword-search-fusion.ts, book-search-v2

**前置条件**:
- searchBookV2 可用（Mock 或真实）
- 测试环境已配置

**测试步骤**:
1. 准备 3 个关键词：`['关键词1', '关键词2', '关键词3']`
2. 调用 `keywordSearchFusion`，验证：
   - searchBookV2 被调用 3 次（每个关键词一次）
   - 结果按 nodeId 合并，保留最高分数
   - 命中次数（hitCount）正确累加
3. 验证 currentNodeId 提升（+0.2）正确应用

**预期结果**:
- 并发执行所有搜索
- 结果去重并按分数排序
- currentNodeId 对应的结果排名提升

**回归风险**: 中 — 影响搜索结果质量

---

### TC-004: preSearchEngine Scope 验证与树结构解析
**优先级**: P0  
**对应模块**: pre-search-engine.ts, tree.json

**前置条件**:
- 测试 vault 中存在 tree.json 文件
- tree.json 包含有效的节点结构

**测试步骤**:
1. 准备有效的 scopeNodeIds（存在于 tree.json 中）
2. 准备无效的 scopeNodeIds（不存在于 tree.json 中）
3. 调用 `preSearchEngine`，验证：
   - 有效 ID 被保留
   - 无效 ID 被过滤
   - nodeFileMap 正确映射

**预期结果**:
- `validatedScopeNodeIds` 只包含有效 ID
- 无效 ID 被静默过滤，不抛出异常
- nodeFileMap 正确反映节点到文件的映射

**回归风险**: 高 — 影响搜索范围

---

### TC-005: preSearchEngine 动态 TopK 计算
**优先级**: P1  
**对应模块**: pre-search-engine.ts

**前置条件**:
- searchBookV2 可用

**测试步骤**:
1. 使用短查询（<8 字符）调用 `preSearchEngine`
2. 验证 topK = 5
3. 使用中等查询（8-30 字符）调用
4. 验证 topK = 10
5. 使用长查询（>30 字符）调用
6. 验证 topK = 15

**预期结果**:
- 根据查询长度动态调整 topK
- 不同长度的查询返回不同数量的结果

**回归风险**: 中 — 影响搜索结果数量

---

### TC-006: preSearchEngine BM25 置信度计算
**优先级**: P0  
**对应模块**: pre-search-engine.ts, scoring-utils.ts

**前置条件**:
- bm25.json 文件存在且有效
- searchBookV2 返回高分结果

**测试步骤**:
1. 准备 bm25.json 包含有效的索引数据
2. 调用 `preSearchEngine`，返回高分结果
3. 验证：
   - `computeMaxTheoryBM25` 被正确调用
   - 置信度 = top1.score / maxTheory
   - 覆盖率 = 关键词在 top1 内容中的匹配比例

**预期结果**:
- 置信度计算正确
- 覆盖率计算正确
- 早停候选标志（earlyStopCandidate）根据阈值正确设置

**回归风险**: 高 — 影响早停决策

---

### TC-007: preSearchEngine 字面即时杀伤检测
**优先级**: P0  
**对应模块**: pre-search-engine.ts, scoring-utils.ts

**前置条件**:
- searchBookV2 返回高置信度、高覆盖率的结果
- 结果包含实质性内容（有 block_id，内容长度 > 20）

**测试步骤**:
1. 准备搜索结果：
   - confidence >= 0.7
   - coverage >= 0.8
   - substantiveScore >= 40
2. 调用 `preSearchEngine`
3. 验证 `earlyStopCandidate = true`

**预期结果**:
- 当三个条件都满足时，`earlyStopCandidate` 为 true
- 日志记录早停触发

**回归风险**: 高 — 影响分析流程

---

### TC-008: preSearchEngine 向量搜索升级
**优先级**: P1  
**对应模块**: pre-search-engine.ts, role-adapters.ts

**前置条件**:
- BM25 置信度 >= 0.25（中等置信度）
- embeddingRole 可用
- embedding-cache 模块可访问

**测试步骤**:
1. 准备中等置信度的搜索结果
2. 配置有效的 embeddingRole
3. 调用 `preSearchEngine`
4. 验证：
   - 生成查询向量（queryVector）
   - 执行混合搜索（BM25 + 向量）
   - 返回合并后的结果

**预期结果**:
- queryVector 非空
- finalHits 包含混合搜索结果
- 置信度 < 0.25 时不执行向量搜索

**回归风险**: 中 — 影响搜索质量

---

### TC-009: earlyStopDecider wScore 计算与阈值判断
**优先级**: P0  
**对应模块**: early-stop-decider.ts

**前置条件**:
- 至少 2 个搜索结果
- mainModel 可用（Mock）

**测试步骤**:
1. 准备 3 个结果：score 分别为 1.0, 0.5, 0.0
2. 调用 `earlyStopDecider`，threshold = 0.6
3. 验证：
   - wScore = 1.0*0.6 + 0.5*0.3 + 0.0*0.1 = 0.75
   - wScore >= threshold (0.75 >= 0.6)
   - 决策为 'early_stop'

**预期结果**:
- wScore 计算正确
- 阈值判断正确
- 当 wScore >= threshold 且 substantiveScore >= 40 时触发早停

**回归风险**: 高 — 影响分析流程

---

### TC-010: earlyStopDecider 实质性质量分数验证
**优先级**: P0  
**对应模块**: early-stop-decider.ts, scoring-utils.ts

**前置条件**:
- 搜索结果包含 block_id 和内容

**测试步骤**:
1. 准备结果：
   - 有 block_id，内容长度 > 20 → substantiveScore >= 35
   - 无 block_id → substantiveScore = 0
2. 调用 `earlyStopDecider`
3. 验证：
   - 有 block_id 时 substantiveScore >= 40（满足早停条件）
   - 无 block_id 时 substantiveScore = 0（阻止早停）

**预期结果**:
- substantiveScore 正确反映内容质量
- 当 substantiveScore < 40 时，即使 wScore >= threshold 也不触发早停

**回归风险**: 高 — 影响早停质量

---

### TC-011: earlyStopDecider L5 强制分析覆盖
**优先级**: P0  
**对应模块**: early-stop-decider.ts

**前置条件**:
- 搜索结果满足早停条件
- l5ForcesAnalytical = true

**测试步骤**:
1. 准备高分结果（wScore >= threshold, substantiveScore >= 40）
2. 设置 `l5ForcesAnalytical = true`
3. 调用 `earlyStopDecider`
4. 验证决策为 'continue'（不触发早停）

**预期结果**:
- 即使所有早停条件满足，L5 强制分析时仍返回 'continue'
- 日志记录 "Skipped: L5 forces analytical"

**回归风险**: 高 — 影响分析流程控制

---

### TC-012: earlyStopDecider LLM 调用与内容验证
**优先级**: P0  
**对应模块**: early-stop-decider.ts, self-verification.ts

**前置条件**:
- 触发早停条件
- mainModel 可用
- verifyAndCleanContent 可用

**测试步骤**:
1. 触发早停路径
2. 验证：
   - buildEarlyStopPrompt 被正确调用
   - mainModel.invoke 被调用
   - verifyAndCleanContent 被调用
   - 返回清理后的内容

**预期结果**:
- LLM 被正确调用
- 内容经过验证和清理
- 返回有效的 early_stop 决策和内容

**回归风险**: 高 — 影响最终输出质量

---

### TC-013: preSearchEngine 与 earlyStopDecider 端到端流程
**优先级**: P0  
**对应模块**: pre-search-engine.ts, early-stop-decider.ts

**前置条件**:
- 完整的搜索环境（tree.json, bm25.json, searchBookV2）
- mainModel 可用

**测试步骤**:
1. 模拟完整的 pre-search 流程：
   - 传入 scopeNodeIds, keywords, bookId
2. 执行 preSearchEngine，获取结果
3. 将结果传递给 earlyStopDecider
4. 验证：
   - 模块间数据传递正确
   - 决策逻辑一致
   - 最终输出符合预期

**预期结果**:
- 端到端流程正常工作
- 数据在模块间正确传递
- 早停决策与搜索质量匹配

**回归风险**: 高 — 核心功能验证

---

### TC-014: 异常处理与降级验证
**优先级**: P0  
**对应模块**: 全部模块

**前置条件**:
- 模拟各种异常场景

**测试步骤**:
1. **tree.json 读取失败**：验证 scopeNodeIds 降级为原始输入
2. **bm25.json 读取失败**：验证置信度使用默认值 10.0
3. **searchBookV2 失败**：验证 keywordSearchFusion 优雅处理
4. **embedding 生成失败**：验证降级为纯 BM25 搜索

**预期结果**:
- 所有异常都被捕获和处理
- 系统降级为合理状态
- 不抛出未处理异常

**回归风险**: 高 — 系统稳定性

---

### TC-015: formatters 格式化输出验证
**优先级**: P1  
**对应模块**: formatters.ts

**前置条件**:
- 格式化函数可访问

**测试步骤**:
1. 调用 `emptyPreSearchResult()`，验证默认结构
2. 调用 `formatBlockLines`，验证 Obsidian 风格输出
3. 调用 `formatVerifiedFullBookBlock`，验证 L5 复核格式

**预期结果**:
- 输出格式符合预期
- 内容截断正确（200 字符限制）
- 限制正确（3 hits × 2 blocks）

**回归风险**: 中 — 影响 LLM 输入质量

---

### TC-016: 跨模块导入路径验证
**优先级**: P1  
**对应模块**: 全部模块

**前置条件**:
- TypeScript 编译环境

**测试步骤**:
1. 运行 TypeScript 编译：`npx tsc --noEmit`
2. 验证所有导入路径正确
3. 验证无循环依赖

**预期结果**:
- 编译无错误
- 导入路径正确
- 无循环依赖

**回归风险**: 中 — 代码结构验证

---

### TC-017: 性能回归验证
**优先级**: P1  
**对应模块**: pre-search-engine.ts, keyword-search-fusion.ts

**前置条件**:
- 性能测试环境

**测试步骤**:
1. 使用大型搜索索引（1000+ 节点）
2. 执行 10 次搜索
3. 记录平均执行时间
4. 与重构前性能对比

**预期结果**:
- 执行时间无显著增加（< 10%）
- 内存使用无显著增加
- 并发搜索性能良好

**回归风险**: 中 — 用户体验

---

### TC-018: 移动端兼容性验证
**优先级**: P1  
**对应模块**: keyword-search-fusion.ts

**前置条件**:
- 移动端环境模拟

**测试步骤**:
1. 验证 `keywordSearchFusion` 使用惰性导入
2. 验证无顶层静态 Node.js 模块导入
3. 运行 `node scripts/smoke/lib/mobile-load-trace.mjs`

**预期结果**:
- 加载阶段零 Node 触达
- 移动端兼容性良好

**回归风险**: 高 — 移动端可用性

---

### TC-019: 日志输出一致性验证
**优先级**: P2  
**对应模块**: 全部模块

**前置条件**:
- 日志系统可用

**测试步骤**:
1. 执行各种操作（搜索、决策、异常）
2. 验证日志格式一致
3. 验证关键操作有日志记录

**预期结果**:
- 日志格式符合项目规范
- 关键决策点有日志
- 异常情况有错误日志

**回归风险**: 低 — 调试和监控

---

### TC-020: 单元测试覆盖率验证
**优先级**: P1  
**对应模块**: 全部模块

**前置条件**:
- 测试覆盖率工具配置

**测试步骤**:
1. 运行单元测试：`npm run test:run`
2. 生成覆盖率报告
3. 验证新模块覆盖率 >= 80%

**预期结果**:
- 所有 63 个单元测试通过
- 新模块覆盖率 >= 80%
- 无未覆盖的关键路径

**回归风险**: 中 — 代码质量

---

## 测试执行优先级

### P0 测试（必须通过）
- TC-001, TC-002, TC-003, TC-004, TC-006, TC-007, TC-009, TC-010, TC-011, TC-012, TC-013, TC-014

### P1 测试（应该通过）
- TC-005, TC-008, TC-015, TC-016, TC-017, TC-018, TC-020

### P2 测试（建议通过）
- TC-019

## 测试环境要求

1. **单元测试环境**：vitest + mock
2. **集成测试环境**：真实或模拟的 Obsidian 环境
3. **性能测试环境**：大型索引数据
4. **移动端测试环境**：Android 模拟器或真实设备

## 测试数据准备

1. **tree.json**：包含有效节点结构的测试数据
2. **bm25.json**：包含测试索引数据
3. **测试关键词**：中英文混合，包含停用词
4. **测试结果**：各种分数和内容长度的模拟数据

## 回归测试建议

1. **关键路径**：preSearchEngine → earlyStopDecider 完整流程
2. **边界条件**：空输入、异常、高负载
3. **性能基准**：执行时间、内存使用
4. **兼容性**：桌面端、移动端

## 测试报告模板

```markdown
## 测试报告

### 执行摘要
- 测试用例总数：20
- 通过：X
- 失败：X
- 跳过：X
- 执行时间：X 分钟

### 失败用例详情
1. TC-XXX：[失败原因]
   - 预期结果：[描述]
   - 实际结果：[描述]
   - 建议修复：[建议]

### 性能指标
- 平均搜索时间：X ms
- 内存使用峰值：X MB
- 移动端加载时间：X ms

### 建议
1. [改进建议]
2. [风险提示]
```

## 注意事项

1. 测试过程中如发现新问题，请及时记录
2. 性能测试需在相同环境下对比
3. 移动端测试需在真实设备上验证
4. 所有测试完成后需更新测试覆盖率报告
