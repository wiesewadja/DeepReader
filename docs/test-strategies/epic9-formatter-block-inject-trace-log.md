# Epic #9 Trace 排查日志（2026-07-01）

> 首条 #9 部署后实测 trace 的排查记录。下次测 #9 或排查类似问题，直接看本文回溯，不用重新踩坑。

---

## 1. 现场

| 项 | 值 |
|---|---|
| trace thread | `thread-d2b30962-1782876893056-7qgun5`（d2b30962 = 《疯传》）|
| trace_id（=root run id）| `019f1bbe-6f85-7566-9ebb-4e2bb091c6bf` |
| run_id（formatter 所在）| `019f1bbe-6f8b-7299-b891-1501bb9d8364` |
| 时间 | 2026-07-01 03:34:53，总耗时 **43131ms** |
| 场景 | 用户测 TC-1.1（《疯传》normal 深问「什么是社交货币？…结合内在吸引力和杠杆原理」）|
| 部署版本 | deepreader-dev `1101`（feat/formatter-block-inject）|
| LangSmith session | DeepReader（UUID `0834cabd-5422-4651-8f8b-5236a106aa63`）|

## 2. trace 拉取方法（LangSmith REST API）

**配置**：API key 在 `test-vault/.obsidian/plugins/deepreader-dev/data.json` 的 `langsmithApiKey`（勿入文档/提交）。

**步骤**：
1. `GET /api/v1/runs/<trace_id>` → root run（name=`LangGraph`），取 `direct_child_run_ids`
2. 逐个 `GET /api/v1/runs/<child_id>` → 拿 `name` / `prompt_tokens` / `completion_tokens` / `start_time` / `end_time`
3. 找 `name=='formatter'` 的节点 → 它的子节点里找 `name=='ChatOpenAI'` → 该 LLM run 的 `outputs.generations[0][0].message.kwargs.content` = **formatter raw 输出（injector 处理前）**
4. formatter 节点的 `outputs.formattedOutput` = **最终输出（injector 后）**

**坑**：
- `parent_run_id` 在 `runs/query` 里**过滤失效**（返回 session 全部 runs）→ 必须用 `GET /runs/<id>` 逐个展开
- LLM `inputs.messages` 大对象会被 LangSmith **预览截断**，`<retrieved_blocks>` 实际内容可能拿不全（本次就没拿到）→ 看 retrieved_blocks 要去 LangSmith UI 或用 prompt_tokens 增量反推
- 限流 429 → 加 retry + sleep 0.4s

## 3. 数据

### 流程（4 个一级子节点，按时间）
```
__start__      |    1ms | 03:34:53
inspectional   | 9739ms | pt=6994 ct=462   （S1 结构分析）
pre_search     |22240ms | pt=2552 ct=896   （S2-Pre 预检索，瓶颈）
formatter      |11135ms | pt=5572 ct=443   （S4 格式化）
```
**无 `analytical` 节点** → 这条没走深度分析（pre_search 命中后直接进 formatter，疑似早停 content 格式化或跳 ReAct）。但 formatter 用了含 retrieved_blocks 的 prompt，#9 formatter 改动生效。

### 速度 ⚠️（#9 之外的独立问题）
总 43s。`pre_search` 22s 是瓶颈（含检索 + 可能的早停 LLM 调用）。三个 LLM 串行。**43s 偏慢，建议另开任务查 pre_search 22s 在干嘛**。

### 质量
formatter LLM raw（injector 前）= **3 个 block 级链接**，最终输出 = 3（injector 未增删）：
- `[[疯传/11 - 铸造一种新形式的货币#^p10-006|自我分享的特质]]`
- `[[疯传/12 - 内在吸引力#^p11-004|内在吸引力]]`
- `[[疯传/13 - 杠杆原理#^p12-000|杠杆原理]]`

别名自然（作主语宾语）、文件名真实、blockId 真实（见第 5 节）、开头直接切入符合 Rule1。

## 4. #9 有效性证据链（四项互证）

| 维度 | 基线 | 本次 | 结论 |
|---|---|---|---|
| formatter prompt_tokens | 4489 | **5572**（+1083）| retrieved_blocks 段喂进去了 ✅ |
| LLM raw block 链接 | 0 | **3** | LLM 看着原文原生引用 ✅ |
| 链接真实性 | — | **3/3 真实** | 文件 + blockId 都在 test-vault ✅ |
| raw vs 最终输出 | — | **3 = 3** | injector Step2 没重复、没误删 ✅ |

**结论：核心赌注成立**。mimo-v2.5-pro 看着 `<retrieved_blocks>` 原文，自己写出正确的 block 级双链——文件名、blockId、别名全对。#9 改动有效。

## 5. ⚠️ 排查坑：vault 定位（重点，下次别再踩）

**目标 vault 永远是 test-vault，不是真实 vault，也不在 worktree 里。**

### 正确路径
- test-vault 在**主仓库**：`/Users/lizhao/workspace/DeepReader/test-vault/`
- worktree（`.worktrees/xxx/`）里**没有** test-vault（它是 vault 数据，gitignore，不进 worktree）
- 书章节 .md：`test-vault/DeepReader/<书名>/<序号> - <标题>.md`
  - 例：`test-vault/DeepReader/疯传/11 - 铸造一种新形式的货币.md`
- blockId 在章节 .md 内，格式 `^p<章号>-<段序号>`（如 `^p10-006`）；章号与文件序号有偏移（文件 `11 -` 对应 `p10-`）但引用照常工作

### grep blockId 真实性的正确命令
```bash
TV="/Users/lizhao/workspace/DeepReader/test-vault"
# 定位文件
find "$TV/DeepReader/疯传" -name "11 - 铸造*"
# 精确 grep blockId
grep -c "p10-006" "$TV/DeepReader/疯传/11 - 铸造一种新形式的货币.md"
# 看文件的 blockId 体系
grep -oE '\^[a-zA-Z0-9_-]+' "$TV/DeepReader/疯传/11 - 铸造一种新形式的货币.md" | head
```

### 我本次连错三次（教训）
1. **worktree 相对路径** `test-vault/`（worktree 没这目录，`ls` 报 No such file）→ 必须用主仓库**绝对路径**
2. **查了真实 vault** `~/Documents/昭见森奚童大脑/DeepReader`（里面没《疯传》，误判死链）→ 测试一律用 **test-vault**
3. **假设书 .md 在 `test-vault/DeepReader/` 根**（实际在 `test-vault/DeepReader/<书名>/` 子目录）→ `ls test-vault/DeepReader/` 是空的，要再下一层 `test-vault/DeepReader/<书名>/`

### test-vault 根结构（参考）
```
test-vault/
├── DeepReader/          ← 书数据根
│   ├── 疯传/            ← 各书目录（书名）
│   │   ├── 01 - 让你的品牌像病毒一样疯传.md
│   │   ├── 11 - 铸造一种新形式的货币.md
│   │   └── 疯传 - MOC.md
│   ├── AI极简经济学/
│   ├── covers/  assets/
│   └── ...
├── .obsidian/plugins/deepreader-dev/   ← 插件数据（data.json 含 langsmithApiKey、pageindex/、sessions/）
├── 书籍摘录/
└── 各种测试 epub/pdf
```

## 6. blockId 体系
- 章节文件名：`<序号> - <标题>.md`（如 `13 - 杠杆原理.md`）
- blockId：`^p<章号>-<段序号>`（如 `^p12-000`），写在 .md 内（行尾/行首的 `^xxx` 锚点）
- Obsidian 双链 `[[书/文件#^blockId|别名]]` 可跳转到对应段落
- blockId 全书唯一（章号前缀避免跨章冲突）

## 7. 教训清单
1. **vault = test-vault**（主仓库绝对路径 `/Users/lizhao/workspace/DeepReader/test-vault/`），不是真实 vault，不在 worktree
2. grep/ls 一律用**绝对路径**，别用相对（worktree 里没有 vault）
3. LangSmith trace：root = **trace_id**，逐个 `GET /runs/<id>` 展开（`parent_run_id` 过滤失效）
4. f-string 内联正则小心双反斜杠：`r'\[\['` 写进 f-string 的 `re.findall(r'\\[\\[...')` 会匹配字面 `\[` 而非 `[`，导致计数=0（本次"总 `[[]]`=0"的 bug）→ 正则定义在 f-string 外，或用单反斜杠
5. 判 LLM 是否原生引用：看 formatter 的 **LLM 子节点 raw**（injector 前），不是 formatter 节点 output（injector 后）
6. 判 retrieved_blocks 是否喂了：看 formatter **LLM prompt_tokens 增量**（基线 4489，喂了 +1083）——比看 inputs 内容可靠（inputs 被截断）

## 8. 待办
- [ ] pre_search 22s 速度瓶颈（另开任务，与 #9 无关；已拟 issue 草稿 `docs/issues/pre-search-latency.md`）
- [ ] 继续测 TC-2.1（早停路径）+ 回归用例（见 `epic9-formatter-block-inject-manual.md`）
- [ ] 早停路径的 formatter raw 链接数（本次是 normal-ish 路径，早停待验）

## 9. 后续发现（TC-1.3，2026-07-01 05:46）

trace `019f1c36-c0b0-713c-87ff-98694402281b`（高效能"以终为始"，TC-1.3）：

- formatter prompt **5720**（+1231 vs 基线 4489 = retrieved_blocks 注入），LLM raw **2 个 block 链接**（基线 0），**raw=最终**（injector 未动 → #9 Step2"LLM 已引用则跳过"正常工作）
- **链接位置瑕疵**：mimo 把链接放**句号后/句首**，别名孤立——
  - `…付诸实践。[[两次创造原则]] 这意味着…`（句号后悬挂）
  - `…检验标准。[[个人使命宣言]] 有了使命宣言…`（句号后 + 别名与紧跟词重复）
  - 这是 **LLM 遵循度问题**（mimo 没把别名当句子成分），**不是 injector bug**
- **路径偏离**：TC-1.3 预期 normal（analytical），实际 `inspectional→pre_search→formatter` **无 analytical**（同 TC-1.1）。pre_search 命中后直接进 formatter，路由/早停问题，独立于 #9

**已处理（本日）**：
- v1407：Rule5「别名自然」措辞强化——禁"句号/逗号之后"。**重测发现反效果**：mimo 挪到"句号前"（句尾悬挂），3 链接全句尾（措辞路线失败，mimo 总找漏洞；trace `019f1c5b`，3/3 blockId 真实，#9 核心仍有效）
- v（本次）：改用 **few-shot 正反例**（zh+en）—— 用 `019f1c5b` 的真实错例"两次创造"做反例，正例示范别名作状语融入句中；措辞同时堵"句号/逗号**前后**"。部署版本见下方 deploy 输出
- **待重测**：若 few-shot 后仍 ≥50% 句尾悬挂，接受为已知限制（#9 核心——生成真实 block 链接——已达成，位置是 nice-to-have，等更强模型或后处理）
