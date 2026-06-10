# 奚童问答质量评估 -- 实施复盘

> 日期：2026-06-10
> 状态：基础设施已建立，待首次完整运行

## 1. 已完成工作

### Phase 1: 基础设施
- [x] `tests/golden/qa-quality/dataset.json` -- 20 个核心用例
  - 闲聊(3) + 检视阅读(3) + 分析阅读基础(4) + 分析阅读深度(3) + 反幻觉(2) + 纠正检测(1) + 多轮上下文(2) + 安全性(2)
- [x] `scripts/smoke/agent-live-test.mjs` -- 快速质量评分脚本
  - 支持 --only 指定用例、--report Markdown 输出
  - 结果自动保存到 results/ 目录
- [x] `tests/e2e-cli/specs/agent/` -- 3 个基础 Agent Spec
  - casual-chat.mjs (depth=0)
  - inspectional.mjs (depth=1)
  - analytical.mjs (depth=2)

### Phase 2: 场景覆盖
- [x] `tests/e2e-cli/specs/agent/` -- 4 个特殊场景 Spec
  - anti-hallucination.mjs (反幻觉)
  - correction.mjs (纠正检测)
  - multi-turn.mjs (多轮上下文)
  - security.mjs (安全性)

### Phase 3: 评分自动化
- [x] `tests/golden/qa-quality/scorer.mjs` -- 评分引擎模块
  - 六维评分: ACC(30) + REL(20) + COM(15) + REF(15) + SAF(10) + STY(10) = 100分
  - 等级: 良好(>=80) / 及格(60-79) / 不及格(40-59) / 严重(<40)
  - 支持评分覆盖、幻觉检测、sentinel 扫描
- [x] `tests/golden/qa-quality/results/` -- 结果持久化目录

### Phase 4: 回归集成
- [x] eval-agent.spec.mjs 集成六维评分
- [x] 最低分阈值: 总分 >= 60, ACC >= 15, SAF >= 8

## 2. 文件清单

| 文件 | 类型 | 行数(约) | 用途 |
|------|------|---------|------|
| tests/golden/qa-quality/dataset.json | 数据 | ~200 | 20 个测试用例 |
| tests/golden/qa-quality/scorer.mjs | 模块 | ~350 | 评分引擎 |
| scripts/smoke/agent-live-test.mjs | 脚本 | ~350 | 快速评分入口 |
| tests/e2e-cli/specs/agent/casual-chat.mjs | spec | ~120 | 闲聊测试 |
| tests/e2e-cli/specs/agent/inspectional.mjs | spec | ~120 | 检视阅读测试 |
| tests/e2e-cli/specs/agent/analytical.mjs | spec | ~140 | 分析阅读测试 |
| tests/e2e-cli/specs/agent/anti-hallucination.mjs | spec | ~130 | 反幻觉测试 |
| tests/e2e-cli/specs/agent/correction.mjs | spec | ~140 | 纠正检测测试 |
| tests/e2e-cli/specs/agent/multi-turn.mjs | spec | ~160 | 多轮上下文测试 |
| tests/e2e-cli/specs/agent/security.mjs | spec | ~150 | 安全性测试 |

## 3. 使用指南

### 快速评估（3 条用例）
```bash
node scripts/smoke/agent-live-test.mjs --only=qa-001,qa-007,qa-014
```

### 完整评估（20 条用例）
```bash
node scripts/smoke/agent-live-test.mjs
```

### 指定场景测试
```bash
node tests/e2e-cli/specs/agent/analytical.mjs
```

### Markdown 报告
```bash
node scripts/smoke/agent-live-test.mjs --report > report.md
```

## 4. 首次运行检查清单

- [ ] Obsidian 已打开 test-vault
- [ ] 插件已加载（`app.plugins.plugins['deepreader-dev']` 存在）
- [ ] LLM API Key 已配置
- [ ] 纳瓦尔宝典已索引（tree.json + chunks.jsonl + vectors.jsonl 存在）
- [ ] 金钱心理学已索引（部分用例需要）

## 5. 评分阈值

| 维度 | 满分 | 最低要求 | 说明 |
|------|------|---------|------|
| ACC（准确性） | 30 | 15 | 错误信息会误导用户 |
| REL（相关性） | 20 | 10 | 跑题回答无价值 |
| COM（完整性） | 15 | 5 | 允许简短但必须有内容 |
| REF（引用质量） | 15 | 10 | 深度问题无引用=无证据 |
| SAF（安全性） | 10 | 8 | 安全问题零容忍 |
| STY（风格） | 10 | 5 | 风格是锦上添花 |
| **总分** | **100** | **60** | **及格线** |

## 6. 已知限制

1. **LLM 随机性**: 同一查询得分波动 +-10 分
2. **关键词匹配局限**: 无法检测语义正确但用词不同的回复
3. **API 成本**: 每次评估约 20 x 3 轮 x 平均 2000 token
4. **CI 不适用**: 需要运行中的 Obsidian + 网络 + API Key
5. **人工评估缺失**: 当前全部自动化，缺少人工校准

## 7. 后续改进方向

- [ ] 语义相似度评分替代关键词匹配（使用 embedding）
- [ ] 人工标注 golden answer 对比评分
- [ ] LangSmith trace 集成（token 用量 + 耗时分析）
- [ ] 多次运行取平均分（消除 LLM 随机性）
- [ ] CI 集成（GitHub Actions + 自托管 Obsidian）
- [ ] 评分趋势追踪（每次评估结果对比）
