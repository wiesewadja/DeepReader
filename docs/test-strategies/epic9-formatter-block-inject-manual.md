# Epic #9 手测用例：Formatter Block Prompt 注入

> **目标**：在 Obsidian 真实环境手动验证 Epic #9 的核心赌注——mimo-v2.5-pro 在看到 `<retrieved_blocks>` / 对齐后的 `【书/文件#^blockId】` 段落后，能否原生生成 block 级 `[[书/文件#^blockId|2-6字别名]]`，而非依赖事后补链的 injector。
>
> **已部署版本**：deepreader-dev 1101（feat/wiki-link-inject 分支）
> **基线**：normal 路径 formatter raw 输出 block 链接 = 0；早停路径 raw = 0
> **模型**：xiaomi mimo-v2.5-pro（可在设置中查看/切换）
> **LangSmith session**：DeepReader（UUID `0834cabd-5422-4651-8f8b-5236a106aa63`）

---

## 0. 测试前准备（每次会话开始时做一次）

| 步骤 | 操作 | 期望 |
|------|------|------|
| 0.1 | Obsidian 打开 test-vault，确认 DeepReader sidebar 可见 | sidebar 正常 |
| 0.2 | 设置 → DeepReader → 确认 LangSmith 已启用、`langsmithApiKey` 已填、project=`DeepReader` | 启用勾选、key 非空 |
| 0.3 | 确认模型为 mimo-v2.5-pro（或你想测的模型）| 记录模型名，作为本次会话判据基准 |
| 0.4 | 打开浏览器访问 https://smith.langchain.com → 进入 DeepReader project | 能看到实时 trace 列表 |
| 0.5 | 在书库选一本已索引书（见下方"可用书目"）作为当前书 | sidebar 顶部显示书名 |

**可用已索引书目**（catalog.json 实际存在）：

| bookId 前缀 | 书名 | 备注 |
|------------|------|------|
| `d2b30962` | 疯传:让你的产品、思想、行为像病毒一样入侵 | 454 节点，章节丰富，适合测概念 |
| `ee090e29` | AI极简经济学 | 514 节点，含"预测机器"等清晰概念 |
| `0e0e129c` | 高效能人士的七个习惯（30周年纪念版）| 547 节点 |
| — | 优秀的绵羊 | 已索引（catalog 未列但 vault 有目录）|
| — | 自卑与超越 | 已索引 |

---

## 1. Normal 路径：Block 链接原生生成（核心赌注）

**测的是什么**：深度问句走 `router → inspectional → pre_search → analytical → formatter`，formatter LLM 看到 `<retrieved_blocks>` 后**自己**写出 `[[书/文件#^blockId|别名]]`（基线 0，这是 Epic #9 头号 KPI）。

### TC-1.1 《疯传》社交货币概念深问

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 疯传（bookId `d2b30962`）|
| **操作** | 在 sidebar 输入：「**什么是社交货币？它为什么能让事物疯传？结合书里讲的内在吸引力和杠杆原理展开说说**」然后发送 |
| **预期** | 回复中**至少 1 个**形如 `[[疯传/XX#^xxxxxx\|别名]]` 的 block 级链接（基线 0 → 目标 ≥1）|
| **判据** | ① 回复可见区出现可点的 wiki 链接；② 复制回复全文，正则 `\[\[[^\]]*#\^[^|\]]+\|[^\]]{2,6}\]\]` 命中 ≥1 次；③ 链接里的文件名应是「10 - 第一章 社交货币 Social Currency」「12 - 内在吸引力」「13 - 杠杆原理」之类真实章节 |
| **确认路径** | LangSmith 最新 trace：节点含 `analytical` + `search_book` + `formatter`；展开 formatter 的 LLM 子节点，看 `outputs.generations[0][0].message.kwargs.content`（raw LLM 输出，injector 前）—— 这是判断"是不是 LLM 自己写的"的关键 |
| **失败排查** | ① trace 无 `analytical` → 路由错或早停了，看 router 输出 depth；② trace 有 analytical 但 formatter raw 仍 0 链接 → mimo 不遵循新 prompt，看 formatter 的 `inputs` 里 `<retrieved_blocks>` 段是否真有内容、block_id 是否带 `^`；③ raw 有链接但最终回复无 → injector 误删，看 injector 日志 |

### TC-1.2 《AI极简经济学》预测机器概念深问

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = AI极简经济学（bookId `ee090e29`）|
| **操作** | 输入：「**书里说的"预测机器"到底是什么意思？为什么作者认为预测变得便宜会改变一切？**」 |
| **预期** | ≥1 个 block 级 `[[AI极简经济学/XX#^xxxxxx\|别名]]` |
| **判据** | 同 TC-1.1；链接文件名应指向「09 - 第3章 预测机器的魔力」「05 - 第2章 廉价改变一切」之类 |
| **确认路径** | 同 TC-1.1，trace 必含 analytical + formatter |
| **备注** | 这题更"概念定义"风，可能擦边触发早停；若 trace 显示走了早停（无 analytical 节点），归到 TC-2.x 重测，并换一个更"分析"的问法（如「预测机器如何改变决策？请结合书里的论证」）再跑一次确认 normal 路径 |

### TC-1.3 《高效能人士的七个习惯》习惯展开

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 高效能人士的七个习惯（bookId `0e0e129c`）|
| **操作** | 输入：「**"以终为始"这个习惯具体怎么做？书里讲了哪些原则和步骤？**」 |
| **预期** | ≥1 个 block 级链接 |
| **判据** | 同 TC-1.1 |
| **确认路径** | trace 必含 analytical + formatter |

### TC-1.4 多轮追问（验证上下文继承不破坏链接）

| 字段 | 内容 |
|------|------|
| **前置** | 紧接 TC-1.1，不切书、不清历史 |
| **操作** | 第二轮输入：「**你刚才提到的杠杆原理，能再展开讲讲吗？**」 |
| **预期** | 第二轮回复仍含 ≥1 个 block 级链接（指向杠杆原理章节）|
| **判据** | 链接真实可点；trace 第二轮仍走 analytical（depth 继承）|
| **意义** | 验证历史消息累积不破坏 formatter 的 block 注入 |

---

## 2. 早停路径：Block 链接原生生成

**测的是什么**：简单定义类问题走 `router → inspectional → pre_search`（早停）→ `formatter`，跳过 analytical。pre-search 的 `formatBlockLines` 已对齐 syntopical 样式 `【书/文件#^blockId】`，LLM 应照搬成 `[[书/文件#^blockId|别名]]`。

**怎么稳走早停**（代码 `analytical-pre-search.ts:451-454`）：问"X 是什么/定义/意思"这种**概念解释型**、书中**有明确专门段落**的问题，命中 ≥2 段 + 实质性分 ≥40。

### TC-2.1 《疯传》STEPPS 六原则定义

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 疯传 |
| **操作** | 输入：「**STEPPS 六个原则分别是什么？**」（短、定义型）|
| **预期** | 走早停；回复含 ≥1 个 block 级 `[[疯传/XX#^xxxxxx\|别名]]` |
| **确认早停** | ① Obsidian 日志（开 DevTools Console，过滤 `[S2-Pre]`）应见 `早停: ... 跳过 ReAct`；② LangSmith trace 节点列表**无 `analytical`**，但有 `pre_search` 工具调用 |
| **判据** | 链接正则命中 ≥1；block_id 真实（见 TC-3.x）|
| **失败排查** | ① trace 有 analytical → 没早停，问题太"分析"了，换成更纯粹的"是什么"问法（如「社交货币是什么意思？」）；② 早停了但 raw 无链接 → 看 pre_search 工具的 result 文本是否为 `【疯传/XX#^xxx】\n原文` 格式（旧格式是 `【title】(file_name:...)`），若仍是旧格式说明部署的不是 1101；③ formatter 没把 `【...】` 照搬 → mimo 不遵循，看 formatter prompt 里 buildEarlyStopPrompt 的 instruction 是否要求照搬 |

### TC-2.2 《AI极简经济学》单一概念定义

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = AI极简经济学 |
| **操作** | 输入：「**什么是预测机器？**」（极简、定义型）|
| **预期** | 走早停；≥1 个 block 级链接 |
| **确认早停** | 日志见 `[S2-Pre] 早停`；trace 无 analytical |
| **判据** | 链接真实可点 |

### TC-2.3 《自卑与超越》概念定义（不同书验证泛化）

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 自卑与超越 |
| **操作** | 输入：「**阿德勒说的"自卑感"是什么意思？**」 |
| **预期** | 走早停；≥1 个 block 级链接 |
| **确认/判据** | 同 TC-2.1 |

### TC-2.4 早停稳定性（同一问句跑 3 次）

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 疯传 |
| **操作** | 清历史，重复问「**社交货币是什么意思？**」3 次（每次清历史）|
| **预期** | ≥2 次走早停、≥2 次回复含 block 链接（允许 1 次 LLM 抽风）|
| **意义** | 早停触发是概率性的（依赖 LLM 打分），但格式对齐后链接生成应稳定 |

---

## 3. 链接质量验证（死链 / 别名 / 跳转）

**测的是什么**：LLM 生成的 block_id 真实（不死链）、别名自然嵌入正文（不孤立突兀）、点击能跳到原文。

### TC-3.1 死链检查（block_id 真实性）

| 字段 | 内容 |
|------|------|
| **前置** | 任一 TC-1.x / TC-2.x 已生成 block 链接的回复 |
| **操作** | 把回复里每个 `[[书/文件#^blockId\|别名]]` 中的 blockId 提取出来，去对应书的 .md 文件里 grep `^blockId:` 或 `^blockId` |
| **判据** | 100% 真实存在。出现 1 个死链 = 失败 |
| **快捷做法** | 直接在 Obsidian 里**点击链接**：能跳到对应 .md 并定位 block = 真实；跳不到/报错 = 死链 |
| **失败排查** | ① 全死链 → formatter 在编造，检查 `<retrieved_blocks>` 是否真的喂进 prompt（看 formatter LLM 子节点的 inputs）；② 偶发死链 → mimo 偶尔幻觉 block_id，属 LLM 遵循度问题，记录频率 |

### TC-3.2 别名自然嵌入

| 字段 | 内容 |
|------|------|
| **前置** | 任一已生成 block 链接的回复 |
| **操作** | 通读回复，检查每个 `[[...\|别名]]` 的别名（2-6 字）是否**融入句子语义**，不是孤立悬空 |
| **判据** | 例：`内在吸引力是[[疯传/12 - 内在吸引力#^abc123\|关键]]` ✅；` ... [[疯传/XX#^abc\|社交货币]] ... ` 出现在无关上下文里 ❌ |
| **失败排查** | 别名突兀 → formatter prompt 的"2-6 字别名"约束被忽略，或 injector 主题词内嵌位置选错 |

### TC-3.3 跳转可用性（端到端）

| 字段 | 内容 |
|------|------|
| **操作** | 在回复里依次点击每个 block 链接 |
| **判据** | Obsidian 打开对应 .md 文件，光标/滚动到对应 block（`^blockId` 锚点）|
| **备注** | 跨书链接（如 syntopical）路径应为 `书名/文件.md#^blockId`；单书为 `文件.md#^blockId`（带不带书名前缀取决于 pdfName 注入）|

---

## 4. Injector 不重复（Step2 条件跳过）

**测的是什么**：`wiki-link-injector.ts:154` 的 Epic #9 改动——LLM 已为某文件生成 `#^block` 链接时，injector Step2 不再对该文件做主题词内嵌，避免同一文件出现重复链接。

### TC-4.1 单文件不重复

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 疯传 |
| **操作** | 问一个明确指向单一章节的问题（如「**内在吸引力是什么？**」），让 LLM 大概率只为「12 - 内在吸引力」生成链接 |
| **预期** | 回复里「12 - 内在吸引力」这个文件**至多 1 个** block 链接（LLM 生成的或 injector 内嵌的，二选一）|
| **判据** | ① 复制回复全文，grep `内在吸引力#^`，计数 ≤ 该文件不同 block 数；② 不应出现「LLM 链接 + injector 紧跟着又内嵌一个」的紧邻重复 |
| **确认 injector 行为** | LangSmith trace 找 `[WikiLinkInjector]` 日志行：应为 `修正/升级 X 条` 而**无** `主题词内嵌 X 条`（或主题词内嵌为 0 对该文件）；或开 Obsidian DevTools Console 看日志 |
| **失败排查** | 出现重复 → 检查 injector 的 `new RegExp(escapeRegex('[[${prefix}${realFile}#^'))` 正则是否匹配到 LLM 生成的链接（prefix 可能不对，pdfName 注入问题）|

### TC-4.2 多文件混合（部分 LLM 生成 + 部分 injector 补）

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 疯传 |
| **操作** | 问一个跨章节问题（如「**社交货币和杠杆原理有什么关系？**」）|
| **预期** | LLM 可能为某文件生成链接、injector 为另一些文件内嵌——**同一文件内不重复**，但不同文件可以有各自链接 |
| **判据** | 按文件分组统计，每个文件的 `#^` 链接数合理（1-3 个），无同文件紧邻重复 |

---

## 5. 回归边界（不破坏其他路径）

### TC-5.1 跨书主题阅读（syntopical，depth=3）不受影响

| 字段 | 内容 |
|------|------|
| **前置** | sidebar 切到"书库/多书"模式（如有），或选一个能触发主题阅读的问题 |
| **操作** | 输入一个明确要求对比的问题，如「**对比一下《疯传》和《AI极简经济学》对"传播/预测"的不同论述**」（若 UI 支持多选书则选这两本）|
| **预期** | 走 syntopical 路径（trace 含 `syntopical` 节点，无 analytical）；回复正常，**不报错** |
| **判据** | ① 不抛异常；② injector 跨书模式跳过 Step2（`wiki-link-injector.ts:150` 的 `if (ctx.crossBookMode) return`），日志无 `主题词内嵌` 行；③ 若有链接，路径含书名前缀 |
| **失败排查** | 报错 → crossBookMode 判断错；出现死链 → 跨书路径 file 名拼接错 |

### TC-5.2 CASUAL 闲聊不硬塞链接

| 字段 | 内容 |
|------|------|
| **前置** | 当前书任选（或无书）|
| **操作** | 输入：「**你好，今天天气怎么样？**」或「**谢谢你**」 |
| **预期** | 走 depth=0（router → formatter，无检索）；回复**无 wiki 链接**（不应硬塞）|
| **判据** | ① 回复自然、不带 `[[...]]`；② trace 只有 router + formatter，无 search/pre_search/analytical |
| **失败排查** | 出现链接 → formatter 在无 `<retrieved_blocks>` 时仍编造，prompt 约束失效 |

### TC-5.3 早停被质量守卫拦截 → 走 normal 仍正常

**测的是什么**：`analytical-pre-search.ts:524` 的逻辑——`wScore` 够但 `substantiveScore < 40` 时拦截早停，走 ReAct（normal）。

| 字段 | 内容 |
|------|------|
| **前置** | 当前书 = 疯传 |
| **操作** | 输入一个**命中明确但内容稀薄**的问题，如「**疯传里有没有提到苹果？**」（命中但实质性低）|
| **预期** | 日志见 `[S2-Pre] 早停被质量守卫拦截: ... 走 ReAct`；trace 含 analytical；最终回复正常 |
| **判据** | ① 不报错；② 走 normal 后链接生成同 TC-1.x（≥1 个 block 链接，因为 normal 路径也注入了 retrieved_blocks）|
| **意义** | 验证早停 → normal 的回退路径也享受 Epic #9 改动 |

### TC-5.4 空回复 / 极短回复兜底

| 字段 | 内容 |
|------|------|
| **操作** | 输入一个无意义或极短的问题，如「**啊？**」 |
| **预期** | 不抛异常；router 大概率判 depth=0 闲聊；回复非空 |
| **判据** | 无 JS 异常（看 Obsidian Console）|

---

## 附录 A：判据速查表

| 检查项 | 怎么看 | 通过线 |
|--------|--------|--------|
| block 链接是否存在 | 回复全文 regex `\[\[[^\]]*#\^[^|\]]+\|[^\]]{2,6}\]\]` | normal 路径 ≥1（基线 0）；早停路径 ≥1 |
| 走的哪条路径 | LangSmith trace 节点列表 | normal: 有 analytical；早停: 无 analytical 有 pre_search；闲聊: 仅 router+formatter |
| 早停确认 | Obsidian Console `[S2-Pre]` 日志 | 见 `早停: ...跳过 ReAct` |
| 链接真实性 | 点击链接 / grep block_id | 100% 真实 |
| injector 不重复 | `[WikiLinkInjector]` 日志 + 回复检查 | 同文件无紧邻重复 |
| LLM 是否自己写的 | formatter LLM 子节点的 raw content（injector 前）| raw 已含链接 = LLM 遵循；raw 无但最终有 = injector 补的 |

## 附录 B：LangSmith 查看关键步骤

1. 打开 https://smith.langchain.com → DeepReader project
2. 最新一条 root trace = 刚才的对话
3. 展开 `direct_child_run_ids`：找名为 `formatter` / `analytical` / `pre_search` / `router` 的节点
4. **判断 raw LLM 输出（关键）**：点 `formatter` 节点 → 它的子节点里有 `ChatOpenAI2`（或类似 LLM 名）→ 点开 → `outputs.generations[0][0].message.kwargs.content` = LLM 原始输出（injector 处理前）
5. **判断喂了什么**：同一 LLM 节点的 `inputs` 里找 `<retrieved_blocks>` 段（normal 路径）或早停 prompt（早停路径）
6. **injector 日志**：trace 里搜 `[WikiLinkInjector]` 字样，或在 Obsidian DevTools Console 看

## 附录 C：失败时的最小排查清单

按顺序排查（90% 问题在前 3 步）：

1. **部署对了吗？** Obsidian 设置 → DeepReader → 版本应为 1101；若不是，`npm run deploy` 后在 Obsidian 命令面板 reload 插件
2. **走对路径了吗？** LangSmith trace 节点 —— 没 analytical 却期待 normal？或反之？
3. **`<retrieved_blocks>` 真的喂了吗？** formatter LLM 子节点的 inputs 里有没有这段、block_id 是否带 `^`
4. **LLM raw 输出有链接吗？** 有 = LLM 遵循，问题在 injector；无 = LLM 不遵循，问题在 prompt 或模型能力
5. **injector 误删了吗？** raw 有但最终无 → 看 `[WikiLinkInjector]` 日志和 self-verification

---

## 用例执行建议顺序

第一次跑建议按此顺序，能在 30 分钟内覆盖所有关键路径：

1. TC-0（准备，5min）
2. TC-1.1（normal 核心赌注，5min）
3. TC-2.1（早停核心赌注，5min）
4. TC-3.1 + TC-3.3（链接质量，5min）
5. TC-4.1（injector 不重复，3min）
6. TC-5.2（闲聊回归，2min）
7. TC-5.3（守卫拦截回退，3min）
8. 视情况补 TC-1.2 / TC-1.3 / TC-2.2 / TC-5.1（泛化验证，每个 3min）

**最关键的两个用例**：TC-1.1 和 TC-2.1。这两个过了 = Epic #9 核心赌注成立；其他都是边界和回归保护。
