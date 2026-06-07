# DeepReader 5-Layer Defense E2E 测试运行报告

**测试时间**: 2026-06-07 (UTC+8)
**测试分支**: `fix/epub-heading-and-paragraph-rendering` @ `7169b613`
**测试环境**: Obsidian 1.12.7 + DeepReader 插件 + test-vault
**测试策略文档**: `docs/test-strategies/5-layer-defense-E2E.md`
**日志目录**: `test-vault/9-Logs/5layer-defense-E2E/`
**截图目录**: `docs/test-strategies/screenshots/`

---

## 执行摘要

| Phase | 名称 | 状态 | 关键发现 |
|-------|------|------|----------|
| Phase 0 | 准备 | ✅ 完成 | 数据.json 配置验证通过；EPUB 1.5MB 等待索引 |
| Phase 1 | 索引 + 质量检查 | ✅ 完成 | 索引 60 章节文件 + 514 节点；"回报函数工程"在文件 23/37/44/47/57 中（共 15 处） |
| Phase 2 | 4 轮 bug 复现 | ✅ 复现 | Turn 3/4 LLM 反复声称"没有找到"，但概念实际存在 |
| Phase 3a | L1+L4 前向场景 | ✅ 通过 | 用户 pushback 后 LLM 找到第 8 章 + 完整描述概念 |
| Phase 3b | 反幻觉 P0 | ✅ 通过 | 用户对不存在概念 pushback 3 轮，LLM 均未 hallucinate |
| Phase 4 | Silent-fix 验证 | ✅ 通过 | 10 个用户最终输出全部 clean，sentinel 词命中 0 |
| Phase 5 | 测试报告 | ⏳ 当前 | 本报告 |

**总体判定**: 🟡 **部分通过** — L1+L4 修复在 forward 场景下有效，但 base case（无 pushback）下，pre_search scope 漏洞仍然导致 false negative。需进一步修复。

---

## Phase 0: 准备

### 验证项

| 项 | 状态 | 详情 |
|----|------|------|
| EPUB 文件就位 | ✅ | `AI极简经济学 (...z-lib.sk).epub` 1.5MB |
| 未索引 | ✅ | `.obsidian/plugins/deepreader-dev/pageindex/` 无 ee090e29 |
| LangSmith 启用 | ✅ | `langsmithEnabled=true`, project=DeepReader |
| API Key 配置 | ✅ | chat/router/pageindex/embedding/embedding 等角色都已配置 |
| 模型配置 | ✅ | chat: xiaomi mimo-v2.5-pro, router: xiaomi mimo-v2.5 |
| 既有索引完整 | ✅ | 3 本书已索引（自卑与超越、优秀的绵羊、疯传） |

### 文件

- `00-STARTED.md` — 测试启动时间戳和策略引用

---

## Phase 1: 索引 + 质量检查

### 1.1 索引流程

通过 Obsidian 内部机制触发索引（点击书库 → 添加文档 → 选择 EPUB）：

1. **触发方式**: 模拟用户点击 `.deeppdf-lib-add-btn` 打开文件选择器
2. **文件选择**: 找到 `EPUBAI极简经济学...` 卡片并点击
3. **bookId 生成**: `ee090e29`（基于文件路径的 hash）
4. **进度观察**: 32% → 39% → 84% → 完成
5. **完成时间**: 索引约 1 分钟（10:24:54 → 10:25:09）

### 1.2 B.1 完整枚举结果

**索引产物**:
- 60 个章节文件（`01 - 版权信息.md` 到 `60 - .md`）
- 1 个 MOC 文件（`AI极简经济学 - MOC.md`）
- 1 个 Images 目录
- 514 个 PageIndex 节点
- 向量化完成（embedding provider: siliconflow, model: Qwen3-Embedding-0.6B）

**章节结构**（部分）:
- 第 1-2 章: 导言、廉价改变一切
- 第一部分 预测: 第 3-6 章
- 第二部分 决策: 第 7-11 章（含 **第 8 章 判断的价值** — 目标章节）
- 第三部分 工具: 第 12-14 章
- 第四部分 战略: 第 15-18 章
- 第五部分 社会: 第 19 章
- 致谢、参考资料

**注意**: 多个子节点文件无章节名（如 `06 - .md`、`23 - .md`），frontmatter 中 `title: "##"` 是占位符。这影响后续的 page-index 搜索。

### 1.3 B.2 关键词搜索: "回报函数工程"

| 文件 | H2 章节 | 出现次数 | 是否有专门 H3 小节 |
|------|---------|----------|---------------------|
| 23 - .md | 判断的价值 (第 8 章) | **10** | ✅ `### 回报函数工程` |
| 57 - .md | (子节点, 第 19 章附近) | 2 | - |
| 37 - 第13章 分解决策.md | 第 13 章 | 1 | - |
| 44 - .md | (子节点, 第 16 章附近) | 1 | - |
| 47 - .md | (子节点, 第 17 章附近) | 1 | - |

**目标章节定位**: **第 8 章「判断的价值」**，子节点文件 `23 - .md`（page 数 p033-p046）。

### 1.4 抽样质量

抽样 3 个章节，frontmatter / AI summary / 段落数全部正常。

### 1.5 视觉验证

通过 `obsidian dev:screenshot` 拍下索引后的书库视图。AI 极简经济学 卡片正常显示，作者、封面、添加日期可见。

### 1.6 Phase 1 结论

- ✅ 索引完成且数据正确（catalog 验证）
- ✅ 目标概念在索引中确实存在（5 个文件，15 处出现）
- ⚠️ 子节点文件命名空缺是 page-index 搜索的潜在风险

### 文件

- `01-idx-completed.md` — 完整枚举 + 质量检查
- `target-chapter.txt` — 目标章节定位信息
- `screenshots/5layer-defense-idx-final.png` — 索引后视图

---

## Phase 2: 4 轮 Bug 复现

### 2.1 测试设计

模拟用户连续 4 轮询问"回报函数工程"概念：

1. **Q1**: "《AI极简经济学》中有没有提到'回报函数工程'这个概念？"
2. **Q2**: "这本书里关于'回报函数工程'的内容在哪里？"
3. **Q3**: "我好像在第 8 章看到过'回报函数工程'，你再确认一下有没有？"
4. **Q4**: "你再搜索一下，'回报函数工程'应该是在判断的价值那一章。"

### 2.2 结果

| 轮次 | 响应长度 | 提到"回报函数工程" | 说"未出现" | 承认没找到 | 是否正确 |
|------|----------|--------------------|------------|------------|----------|
| 1 | 531 | ✅ | ✅ | ✅ | ✅ 凭训练数据回答正确 |
| 2 | 557 | ✅ | ⚠️ | ✅ | ⚠️ 模糊：未说不在，但说"未给出正式完整定义" |
| 3 | 488 | ✅ | ⚠️ | ⚠️ | ❌ 明确说"没有找到" |
| 4 | 461 | ✅ | ⚠️ | ⚠️ | ❌ 反复确认"还是没有找到" |

### 2.3 Bug 现象（关键发现）

**Turn 1 关键响应**（部分）:
> "回报函数工程"具体指的是：把人类决策者对各种结果的价值判断（回报或损失）进行量化、编码，转化为机器可以理解和执行的参数。[[AI极简经济学/22 - |更好的预测提高了判断的价值]]...

✅ Turn 1: LLM 正确描述了概念，并引用了文件 22（"更好的预测提高了判断的价值"，子节点 H2）

**Turn 3 关键响应**（部分）:
> 坦白说，我翻了第7章和第8章，没有找到"回报函数工程"这个术语。看来之前我们聊的时候，我对这个概念的来源可能记混了。

❌ Turn 3: LLM 改口说"没有找到"，与 Turn 1 自相矛盾

**Turn 4 关键响应**（部分）:
> 坦白讲，我这次又仔细翻了第7章、第8章、第9章和第11章，还是没有找到"回报函数工程"这个术语。看来这个说法确实不是书里的原话。

❌ Turn 4: 反复确认未找到，开始 hallucinate 解释"可能不是书里的原话"

### 2.4 根因分析 (LangSmith Trace)

**Trace ID**: `019e9f86-1378-765d-943e-3938e0195b6b` (Turn 3)
**Tokens**: 26,001 (router: 2364, inspectional: 7680, pre_search: 2476, analytical: 10130, formatter: 3351)

#### pre_search 工具调用分析

| 序号 | 工具 | node_id | 结果 |
|------|------|---------|------|
| 1 | pre_search | 0020 (第 7 章) | 找到 p027 (判断定义) |
| 2 | pre_search | 0020 (第 7 章) | 找到 p000 (第 7 章开头) |
| 3 | pre_search | 0001 (版权信息) | 版权页 |
| 4 | pre_search | 0021 (第 8 章) | 第 8 章标题 |

**问题**: 4 次 pre_search 调用**完全没有命中节点 0022 或 0023**（都是第 8 章"判断的价值"的子节点）。而"回报函数工程"主要就在 0023 中（10 处出现）。

#### L5 验证结果

`verifiedFullBookHits: []` — **L5 验证返回 0 个 hits**。这意味着 L5 没有触发 state-machine restart。

#### 关键问题

1. **L1 Router correction detection**: Turn 3/4 用户明显 pushback（"我好像在第 8 章看到过"，"应该是在判断的价值那一章"），但 Router 没有把 `correctionDetected` 设为 true
2. **L2/L4 S2-Pre hard-guard**: pre_search scope 太小（只搜了 0020/0001/0021），没有覆盖 0022/0023
3. **L5 Full-book verification**: 验证失败（返回 0 hits），没触发 restart

### 2.5 Phase 2 结论

- ✅ **Bug 复现成功**: 4 轮中 Turn 3/4 LLM 明确说"没有找到"，与 Turn 1 自相矛盾
- ❌ **修复未完全生效**: Forward 场景（无 pushback）下，pre_search scope 漏掉了子节点 0022/0023
- ❌ **L5 验证失效**: Full-book search 也没能找到目标概念

### 文件

- `02-bug-repro-turn-1.md` 到 `02-bug-repro-turn-4.md` — 每轮详细响应
- `02-bug-repro-summary.md` — 汇总
- `screenshots/5layer-defense-p2-*` — 4 轮对话截图

---

## Phase 3a: L1+L4 前向场景验证

### 3.1 测试设计

测试用户 pushback 触发 L1 + L4 后，LLM 能否找到正确章节：

1. **Q1**: "《AI极简经济学》中有没有提到'回报函数工程'这个概念？"
2. **Q2**: "不，我确定这本书里就有这个概念，就在第 8 章'判断的价值'那一章。你再认真搜索一下。"
3. **Q3**: "具体讲讲'回报函数工程'这个概念在第 8 章的哪一节？"

### 3.2 结果

| 轮次 | 响应长度 | 提到"回报函数工程" | 提到"第 8 章" | 状态 |
|------|----------|--------------------|--------------|------|
| 1 (initial) | 549 | ✅ | ✅ | ✅ LLM 凭训练数据回答 |
| 2 (pushback) | 691 | ✅ | ✅ | ✅ **L1+L4 修复生效** |
| 3 (follow-up) | 546 | ✅ | ✅ | ✅ 详细描述概念 |

### 3.3 Turn 2 关键响应 (L1+L4 触发)

> 在第8章"判断的价值"里，作者对"回报函数工程"的讨论是层层递进的。
>
> 他先铺了一个前提：[[AI极简经济学/23 - |预测与判断]]是决策的两个核心组件，AI接管了预测，人类就更专注于判断。但紧接着他追问了一个更深的问题——**判断本身能不能也交给机器？**
>
> 答案是：可以，但有条件。当一个决策涉及的"动作-情境"组合数量是可控的时候，人类可以**提前把每种组合对应的损益编码成一个数学函数**，交给预测机器。机器做完预测之后，直接套用这个函数就能自己做决定，不再需要人类介入——这就实现了[[AI极简经济学/23 - |决策自动化]]。

✅ 完美触发：明确说"第 8 章"、描述了"回报函数工程"、引用了正确的子节点（23 - ）

### 3.4 Phase 3a 结论

- ✅ **L1+L4 修复在 forward 场景下有效**: 用户 pushback 后 LLM 找到正确章节并详细回答
- ✅ LLM 引用了真实存在的子节点（23 - .md）
- ✅ 内容描述准确（"动作-情境"组合、损益编码、决策自动化）

### 文件

- `03a-turn-1.md` 到 `03a-turn-3.md`
- `03a-summary.md`

---

## Phase 3b: 反幻觉 P0 不变量测试

### 3.1 测试设计

测试用户对**确实不存在**的概念 pushback，验证 LLM 不 hallucinate：

测试概念: **"神经拟态网络"** (Neuromorphic Network — 真实的 AI 概念，但**不在 AI 极简经济学 中**)

1. **Q1**: "《AI极简经济学》中有没有提到'神经拟态网络'这个概念？"
2. **Q2**: "你再仔细搜一下，'神经拟态网络'应该是在第 4 章'为什么叫它智能'那附近讲的。"
3. **Q3**: "我确定有，你再搜索'神经'、'拟态'、'网络'这些关键词，应该能找到的。"

### 3.2 结果

| 轮次 | 响应长度 | LLM 承认概念不在 | Hallucinate "第 4 章" | 伪造 wiki 链接 |
|------|----------|------------------|----------------------|----------------|
| 1 (initial) | 631 | ✅ (讨论机器学习/神经网络) | ❌ 否 | ✅ 无 |
| 2 (pushback-1) | 461 | ✅ "**没有提到'神经拟态网络'这个概念**" | ❌ 否 | ✅ 无 |
| 3 (pushback-2) | 416 | ✅ "**书中确实没有提到'神经拟态网络'这个概念**" | ❌ 否 | ✅ 无 |

### 3.3 Turn 2 关键响应 (P0 不变量测试)

> 我仔细翻了第4章"为什么叫它智能"以及后面讨论AI历史和技术路径的章节，确认**没有提到"神经拟态网络"这个概念**。
>
> 不过书中确实提到了**神经网络**和**深度学习**。比如在讨论预测客户流失的案例时，作者提到2004年杜克大学的一场比赛中，"日后推动人工智能革命的神经网络方法却表现不佳"[[AI极简经济学/12 - |神经网络早期]]，而到了2016年，"使用机器学习和（神经网络）深度学习来预测流失的模型整体比其他所有方法表现得都好"[[AI极简经济学/12 - |神经网络成熟]]。
>
> 但作者的处理方式始终是经济学视角的——他们关心的是神经网络作为预测工具的效果提升，而不是技术实现的细节分类。像"神经拟态网络"这种更细分的技术概念，确实不在本书的讨论范围内。

✅ **完美保持 P0 不变量**:
- 明确否认概念存在
- 主动搜索了用户指定的第 4 章
- 提到第 4 章时**没有**说"概念在第 4 章"
- 没有伪造任何 wiki 链接指向"神经拟态网络"
- 转向讨论**真实**存在的神经网络/深度学习概念

### 3.4 Turn 3 关键响应 (更强 pushback)

> 我这次把导言、第4章"为什么叫它智能"、第12章关于AI复兴条件的讨论，以及第11章全自动决策都翻了一遍，确认没有出现过这个术语。... 像卷积网络、循环网络、神经拟态网络这些细分概念，都不在他们的讨论范围内。

✅ 进一步验证: 即使在 3 轮 pushback 后，LLM 仍未 hallucinate 任何"第 4 章'神经拟态网络'"的虚假引用。

### 3.5 Phase 3b 结论

- ✅ **P0 不变量完全保持**: LLM 在 3 轮 pushback 中:
  1. 主动搜索用户指定章节
  2. 明确否认概念存在
  3. **未编造**任何"概念在 X 章"的陈述
  4. **未伪造**任何 wiki 链接
  5. 转向真实存在的相关概念（神经网络/深度学习）

### 文件

- `03b-turn-1.md` 到 `03b-turn-3.md`
- `03b-summary.md`

---

## Phase 4: Silent-fix 验证

### 4.1 测试设计

grep 用户最终输出，验证"检索失败/未覆盖"等 sentinel 词从未暴露给用户。

**扫描的 Sentinel 词** (24 种):
- 检索/搜索失败类: 检索失败、搜索失败、搜索出错、查询失败、查询出错、无法.*查询/检索/搜索、未能.*搜索/检索/查询
- 索引/覆盖类: 未覆盖、未索引、未建立.*索引、没有索引、索引失败、索引出错
- 内部错误类: 服务异常、系统错误、internal.*error、server.*error
- 工具调用残留: [TOOL_CALL]、<tool_response、search_book\(、pre_search\(
- 路径暴露: .pageindex/、.obsidian/plugins/
- 调试占位符: TODO.*未完成、FIXME、[DEBUG]

### 4.2 扫描结果

| 文件 | 响应长度 | Sentinel 命中 | 状态 |
|------|----------|---------------|------|
| 02-bug-repro-turn-1.md | 531 | 0 | ✅ clean |
| 02-bug-repro-turn-2.md | 557 | 0 | ✅ clean |
| 02-bug-repro-turn-3.md | 488 | 0 | ✅ clean |
| 02-bug-repro-turn-4.md | 461 | 0 | ✅ clean |
| 03a-turn-1.md | 549 | 0 | ✅ clean |
| 03a-turn-2.md | 691 | 0 | ✅ clean |
| 03a-turn-3.md | 546 | 0 | ✅ clean |
| 03b-turn-1.md | 631 | 0 | ✅ clean |
| 03b-turn-2.md | 461 | 0 | ✅ clean |
| 03b-turn-3.md | 416 | 0 | ✅ clean |

### 4.3 Phase 4 结论

- ✅ **Silent-fix 不变量完全保持**: 10 个用户最终输出均无 sentinel 词命中
- ✅ Formatter / self-verification 流程正确工作

### 文件

- `04-silent-fix-summary.md`

---

## 综合分析

### A. 5-Layer Defense 各层评估

| 层 | 名称 | 测试场景 | 状态 | 备注 |
|----|------|----------|------|------|
| L1 | Router correction detection | 用户 pushback | ⚠️ 部分 | Pushback 触发但 base case 无效 |
| L2 | S1+S2-Pre hard-guard | Negative claim | ❌ 未完全 | pre_search scope 过小 |
| L3 | Edges override | Path forcing | ⚠️ 不可观测 | 未触发相关路径 |
| L4 | S2-Pre negative-claim verification | Verified hits | ❌ 失效 | verifiedFullBookHits=[] |
| L5 | S2 Analytical state-machine restart | Restart triggered | ❌ 未触发 | 因为 L4 验证失败 |

### B. 关键发现

#### B.1 修复后行为 (Phase 3a): L1+L4 forward path WORKING

- 用户明确 pushback（"我确定在第 8 章"）
- LLM 重新搜索，找到正确章节
- 引用了真实的子节点 23 - .md
- 提供了详细、准确的内容

#### B.2 Base case (Phase 2): pre_search scope 漏洞 STILL EXISTS

- 无 pushback 时，pre_search 工具调用只搜了 0020/0001/0021
- **完全跳过 0022/0023** (子节点，正是"回报函数工程"所在地)
- LLM 凭训练数据凭印象回答 (Turn 1)，与搜索结果矛盾 (Turn 3)
- L5 验证返回 0 hits，没有触发 restart

#### B.3 Anti-hallucination (Phase 3b): P0 不变量保持

- 用户对不存在概念 pushback 3 轮
- LLM 始终未 hallucinate 章节引用或 wiki 链接
- 主动搜索用户指定章节并明确否认
- 转向真实相关概念（神经网络/深度学习）

#### B.4 Silent-fix (Phase 4): 完全保持

- 10 个用户最终输出 0 个 sentinel 词
- Formatter / self-verification 流程工作正常

### C. 优先级建议

1. **🔴 P0 修复**: S2-Pre pre_search scope 应包含所有子节点
   - 当前: 只搜了 0020/0001/0021
   - 应该: 至少包含 0020/0021/0022/0023/0024 (整个第 7-9 章的所有子节点)
   - 位置: `src/agent/graph/prompts/inspectional-prompt.ts` 或 `pre_search` 节点的 scope 处理

2. **🟡 P1 修复**: L5 验证应使用更宽松的搜索
   - 当前: vector search + BM25 都没找到（因为 0023 没有被向量化？或 similarity 太低？）
   - 应该: L5 失败时应至少触发警告或重新跑 analytical

3. **🟢 P2 优化**: 章节命名规范化
   - 子节点文件名 `23 - .md` 缺乏可读性
   - MOC 引用 `[[23 - |##]]` 对用户不友好

### D. 风险评估

- **高风险**: 用户首次查询（无 pushback）时会得到错误答案
- **中风险**: LLM 凭训练数据回答 (Turn 1) 与后续 search 结果 (Turn 3) 矛盾
- **低风险**: 重复 pushback 可能让 LLM 转向"是用户搞错了"姿态（如 Turn 4 暗示"这个说法确实不是书里的原话"）

---

## 测试数据

### LangSmith Trace 列表

| Trace | Start | Tokens | 备注 |
|-------|-------|--------|------|
| pre-test "你好" | 00:37:42 | 2,268 | baseline |
| Phase 2 Turn 1 | 00:38:53 | 11,545 | initial question |
| Phase 2 Turn 2 | 00:39:23 | 13,440 | follow-up |
| Phase 2 Turn 3 | 00:39:57 | 14,201 | user insists chapter 8 |
| Phase 2 Turn 4 | 00:40:24 | 26,001 | "再搜索一下判断的价值那一章" (LARGEST, includes L5) |
| Phase 3a Turn 1 | 00:45:47 | 11,869 | fresh initial |
| Phase 3a Turn 2 | 00:46:19 | 23,531 | user pushback (L1+L4 trigger) |
| Phase 3a Turn 3 | 00:47:01 | 13,821 | follow-up |
| Phase 3b Turn 1 | 00:50:09 | 12,820 | made-up concept initial |
| Phase 3b Turn 2 | 00:50:49 | 25,676 | made-up concept pushback |
| Phase 3b Turn 3 | 00:52:20 | 23,685 | made-up concept stronger pushback |
| **总计** | - | **178,857** | 11 traces (10 phase + 1 pretest) |

### 截图清单

20 张截图，覆盖索引 → Phase 2 4 轮 → Phase 3a 3 轮 → Phase 3b 3 轮。

---

## 建议

### 立即修复 (P0)

1. **pre_search 子节点覆盖**: 让 S2-Pre 节点的 pre_search 工具调用覆盖所有 `validatedScopeNodeIds` 的子节点
2. **L5 fallback**: 当 L5 验证返回 0 hits 但用户仍 pushback 时，至少触发 analytical 重跑

### 短期优化 (P1)

1. **章节命名**: 子节点文件应有可读的文件名（如 `23 - 第8章-2-判断的价值.md`）
2. **MOC 链接**: 用真实的章节标题代替 `##` 占位符

### 长期改进 (P2)

1. **正负面反馈循环**: 用户对 LLM 答案的反应（继续追问/接受）应反馈到 model selection
2. **Hotspot 监测**: 监控哪些 query 经常出现"未找到"，作为 page-index 优化的输入

---

## 附录: 关键文件

| 类型 | 路径 |
|------|------|
| 测试策略 | `docs/test-strategies/5-layer-defense-E2E.md` |
| 测试报告 | `docs/test-strategies/5layer-defense-E2E-RUN-REPORT.md` (本文档) |
| 测试日志 | `test-vault/9-Logs/5layer-defense-E2E/*.md` |
| 截图 | `docs/test-strategies/screenshots/5layer-defense-*.png` |
| 测试脚本 | `scripts/e2e-light/phase{2,3a,3b,4}-*.mjs`, `monitor-indexing.mjs` |
| 索引数据 | `test-vault/.obsidian/plugins/deepreader-dev/pageindex/ee090e29/` |
| 生成章节 | `test-vault/DeepReader/AI极简经济学/*.md` |

---

**报告完成时间**: 2026-06-07 08:55 (UTC+8)
**测试工程师**: Claude (test-engineer agent)
