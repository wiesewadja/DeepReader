---
name: langsmith-tracer
description: 从 LangSmith REST API 获取 DeepReader Agent 执行 trace，分析 token 用量、耗时、数据流和 wiki 链接质量。
---

# LangSmith Trace 分析

从 LangSmith 抓取 DeepReader Agent 的最近一次执行 trace，逐层展开数据流，定位 token 瓶颈、耗时异常、链接伪造等问题。

## 何时使用

当用户说以下内容时触发：
- "查 LangSmith"
- "看下最新 trace"
- "分析 token 用量"
- "LangSmith 数据流"
- "trace 分析"
- "检查 wiki 链接"

## 执行步骤

### Step 1: 读取配置

从 test-vault 的 data.json 获取 LangSmith 配置：

```bash
python3 -c "
import json
d = json.load(open('test-vault/.obsidian/plugins/deepreader/data.json'))
key = d.get('langsmithApiKey','')
project = d.get('langsmithProject','DeepReader')
enabled = d.get('langsmithEnabled', False)
print(f'key={key[:15]}...')
print(f'project={project}')
print(f'enabled={enabled}')
"
```

如果 key 为空或 enabled=false，提示用户先在 Obsidian 设置中启用 LangSmith。

### Step 2: 获取 session UUID

LangSmith 的 `/api/v1/runs/query` 的 `session` 参数需要 UUID 而非项目名。先查 session 列表：

```bash
curl -s "https://api.smith.langchain.com/api/v1/sessions" \
  -H "x-api-key: $LANGSMITH_KEY"
```

返回的数组中找 `name == "DeepReader"` 的条目，取其 `id` 作为 session UUID。

### Step 3: 获取最近的根 trace

```bash
curl -s -X POST "https://api.smith.langchain.com/api/v1/runs/query" \
  -H "x-api-key: $LANGSMITH_KEY" \
  -H "Content-Type: application/json" \
  -d '{"session": ["<SESSION_UUID>"], "limit": 5, "is_root": true}'
```

返回 `runs[]`，按 `start_time` 排序。取最新一条作为分析目标。

### Step 4: 展开子节点树

对根 trace 的 `direct_child_run_ids` 逐个获取详情：

```bash
curl -s "https://api.smith.langchain.com/api/v1/runs/<CHILD_ID>" \
  -H "x-api-key: $LANGSMITH_KEY"
```

对每个子节点，提取：
- `name` — 节点名（router / inspectional / analytical / formatter / __start__）
- `prompt_tokens` / `completion_tokens` / `total_tokens`
- `start_time` / `end_time` — 算耗时
- `direct_child_run_ids` — 继续展开下一层

### Step 5: 生成 trace 摘要

输出格式：

```
Root Trace: <start> → <end> (总耗时)
  Total tokens: <N> (prompt=<X>, completion=<Y>)

  S0 Router:     <pt> in + <ct> out = <tt> total (<耗时>s)
  S1 Inspectional: <pt> in + <ct> out = <tt> total (<耗时>s)
  S2 Analytical:  <pt> in + <ct> out = <tt> total (<耗时>s)
    └─ <子节点列表>
  S4 Formatter:   <pt> in + <ct> out = <tt> total (<耗时>s)
```

标注：
- 每个节点的 token 占比（占总 tokens 的百分比）
- 耗时最长的节点用 ⚠️ 标记
- LLM 调用次数（数 ChatOpenAI2 子节点）

### Step 6: 深入数据流分析（按需）

对需要深入分析的节点，获取其 LLM 子运行的 inputs 和 outputs：

```bash
# 找到 ChatOpenAI2 子节点 ID
curl -s "https://api.smith.langchain.com/api/v1/runs/<NODE_ID>" \
  -H "x-api-key: $LANGSMITH_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
children = data.get('direct_child_run_ids', [])
for c in children:
    print(c)
"
```

然后获取 LLM 调用详情：

```bash
curl -s "https://api.smith.langchain.com/api/v1/runs/<LLM_ID>" \
  -H "x-api-key: $LANGSMITH_KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
outputs = data.get('outputs', {})
gens = outputs.get('generations', [[]])[0][0]
msg = gens.get('message', {}).get('kwargs', {})
content = msg.get('content', '')
reasoning = msg.get('additional_kwargs', {}).get('reasoning_content', '')
print(f'Reasoning: {len(reasoning)} chars')
print(f'Content: {len(content)} chars')
print(content)
"
```

### Step 7: Wiki 链接质量检查

从 S4 的 LLM 输出中提取所有 wiki 链接：

```python
import re
links = re.findall(r'\[\[([^\]]*#\^[^|\]]+)\|([^\]]*)\]\]', content)
for path, alias in links:
    # path 格式: 书名/file_name#^block_id
    print(f'  {alias} → {path}')
```

检查：
1. **block_id 是否真实** — 对比 S2 的 toolResults 中的 block_id
2. **file_name 是否正确** — 对比 S2 搜索结果中的 fileName
3. **是否全部被 self-verification 移除** — 如果 S4 输出无链接但 S4 LLM 输出有链接，说明 self-verification 清理了全部伪造链接

## API 参考

### 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/v1/sessions` | GET | 列出所有项目 |
| `/api/v1/runs/query` | POST | 按条件查询 runs |
| `/api/v1/runs/<id>` | GET | 获取单个 run 详情（含 token 统计） |

### 查询参数（POST /api/v1/runs/query）

```json
{
  "session": ["<UUID>"],          // 必须 UUID，不能是项目名
  "limit": 5,
  "is_root": true,                // 只取根 trace
  "parent_run_id": "<UUID>"       // 获取某 run 的子节点
}
```

### Run 对象关键字段

| 字段 | 说明 |
|------|------|
| `name` | 节点名（LangGraph 节点名） |
| `run_type` | chain / llm / tool |
| `prompt_tokens` | 输入 token 数 |
| `completion_tokens` | 输出 token 数 |
| `total_tokens` | 总 token 数 |
| `start_time` / `end_time` | ISO 时间戳 |
| `direct_child_run_ids` | 直接子节点 ID 列表 |
| `inputs` / `outputs` | 输入输出（大对象可能被截断） |
| `status` | success / error |

### LLM 输出结构

outputs.generations[0][0].message.kwargs:
- `content` — 最终文本输出
- `additional_kwargs.reasoning_content` — 深度推理过程（GLM 模型特有）

## 常见问题定位

| 现象 | 检查方向 |
|------|---------|
| S4 输出无 wiki 链接 | S2 是否走了 early stop？pre-search 是否丢失了 block_id？self-verification 是否清理了全部链接？ |
| S1 耗时过长 | 检查 reasoning_content 长度，GLM 深度推理可能产生 3000+ chars 的思考过程 |
| S2 token 过高 | 数 ChatOpenAI2 子节点数量，如果 >3 说明没有走 Plan-Execute 而走了 ReAct |
| 总体 token 偏高 | 检查 S1 的 prompt_tokens（目录树注入大小）和 S4 的 prompt_tokens（历史消息累积） |
| 某节点 token 为 0 | 可能是 RunnableLambda（纯逻辑节点，不调用 LLM） |

## 注意事项

1. **session 参数必须用 UUID**：传项目名会返回 422 错误 "Input should be a valid UUID"
2. **inputs 可能被截断**：LangSmith 对大 input 做预览截断，无法获取完整的 system prompt。需要从 LLM 子节点获取
3. **GLM 模型的 reasoning**：`reasoning_content` 不计入 `completion_tokens` 但影响耗时
4. **pre_search vs search_book**：early stop 路径的工具名是 `pre_search`，正常路径是 `search_book`。self-verification 的 `checkWikiLinkValid` 只检查后两者，`checkBlockIdExists` 不限工具名
