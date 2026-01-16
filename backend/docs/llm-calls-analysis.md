# PDF 索引中的 LLM 调用分析

> 完整分析 PageIndex 索引建立过程中所有涉及 LLM 调用的环节
>
> 更新时间: 2026-01-16

## 目录

1. [LLM 调用概览](#llm-调用概览)
2. [阶段一：目录检测](#阶段一目录检测)
3. [阶段二：目录提取](#阶段二目录提取)
4. [阶段三：目录生成（无目录模式）](#阶段三目录生成无目录模式)
5. [阶段四：标题位置验证](#阶段四标题位置验证)
6. [阶段五：摘要生成](#阶段五摘要生成)
7. [调用次数统计](#调用次数统计)
8. [优化建议](#优化建议)

---

## LLM 调用概览

### 完整流程图

```
PDF 索引 LLM 调用流程
│
├─ 阶段一：目录检测 (find_toc_pages)
│  └─ toc_detector_single_page [条件调用]
│
├─ 阶段二：目录提取 (toc_extractor)
│  └─ (多个内部调用，用于解析目录结构)
│
├─ 阶段三：目录生成 (process_no_toc)
│  ├─ generate_toc_init [首次]
│  └─ generate_toc_continue [循环]
│
├─ 阶段四：标题位置验证
│  ├─ check_title_appearance_in_start_concurrent
│  └─ single_toc_item_index_fixer [条件调用]
│
└─ 阶段五：摘要生成
   ├─ generate_node_summary [每个节点]
   └─ generate_doc_description [可选]
```

### LLM 调用函数列表

| 函数名 | 文件 | 行号 | 用途 | 调用条件 |
|--------|------|------|------|----------|
| `toc_detector_single_page` | page_index.py | 142 | 检测单页是否为目录 | 规则置信度 0.3-0.7 |
| `toc_extractor` | page_index.py | - | 提取目录结构 | 找到目录页后 |
| `check_if_toc_extraction_is_complete` | page_index.py | 164 | 检查目录是否完整 | 提取目录后 |
| `generate_toc_init` | page_index.py | 710 | 生成初始目录树 | 无目录模式 |
| `generate_toc_continue` | page_index.py | 650 | 继续生成目录树 | 无目录模式，多部分 |
| `check_title_appearance_in_start_concurrent` | page_index.py | - | 验证标题位置 | 所有模式 |
| `single_toc_item_index_fixer` | page_index.py | 990 | 修复错误页码 | 验证失败时 |
| `fix_incorrect_toc` | page_index.py | - | 批量修复错误页码 | 有多个错误时 |
| `generate_node_summary` | utils.py | 671 | 生成节点摘要 | if_add_node_summary=yes |
| `generate_doc_description` | utils.py | 719 | 生成文档描述 | if_add_doc_description=yes |

---

## 阶段一：目录检测

### toc_detector_single_page

**文件**: `pageindex-lib/src/pageindex/page_index.py:124-145`

**触发条件**: 规则置信度在 0.3-0.7 之间

```python
async def toc_detector_single_page(content, llm_client=None):
    prompt = f"""
    Your job is to detect if there is a table of content provided in the given text.

    Given text: {content}

    return the following JSON format:
    {{
        "thinking": <why do you think there is a table of content in the given text>
        "toc_detected": "<yes or no>",
    }}

    Directly return the final JSON structure. Do not output anything else.
    Please note: abstract,summary, notation list, figure list, table list, etc. are not table of contents.
    """

    response = await llm_client.chat_async(prompt)
    json_content = extract_json(response)
    return json_content["toc_detected"]
```

**调用频率**:
- 优化前：每页 1 次
- 优化后：仅中等置信度页面（约 10-30%）

**Prompt 特点**:
- 输入：单页文本内容
- 输出：JSON 格式（yes/no）
- Token 估算：约 500-2000 tokens（取决于页面长度）

---

## 阶段二：目录提取

### 目录提取流程

当检测到目录页后，PageIndex 会尝试提取目录结构。这个过程涉及多个 LLM 调用。

**文件**: `page_index-lib/src/pageindex/page_index.py`

#### 1. toc_extractor (内部函数)

提取目录的层次结构和页码信息。

```python
# 简化的调用流程
async def toc_extractor(page_list, toc_page_list, llm_client):
    # 调用 LLM 解析目录结构
    # 返回：{"toc_content": ..., "page_index_given_in_toc": "yes"/"no"}
```

#### 2. check_if_toc_extraction_is_complete

**文件**: `pageindex-lib/src/pageindex/page_index.py:148-167`

```python
async def check_if_toc_extraction_is_complete(content, toc, llm_client=None):
    prompt = f"""
    You are given a partial document and a table of contents.
    Your job is to check if the table of contents is complete,
    which it contains all the main sections in the partial document.

    Reply format:
    {{
        "thinking": <why do you think the table of contents is complete or not>
        "completed": "yes" or "no"
    }}
    Directly return the final JSON structure. Do not output anything else.
    """

    prompt = prompt + "\n Document:\n" + content + "\n Table of contents:\n" + toc
    response = await llm_client.chat_async(prompt)
    json_content = extract_json(response)
    return json_content["completed"]
```

**调用时机**: 提取目录后，检查目录是否完整

**输出**: `"yes"` 或 `"no"`

---

## 阶段三：目录生成（无目录模式）

### 概述

当 PDF 没有目录或目录中没有页码信息时，进入 `process_no_toc` 模式。这个模式会使用 LLM 分析文档内容，生成目录结构。

### generate_toc_init

**文件**: `pageindex-lib/src/pageindex/page_index.py:718-751`

```python
async def generate_toc_init(part, llm_client=None):
    print("start generate_toc_init")

    prompt = """
    You are an expert in extracting hierarchical tree structure,
    your task is to generate the tree structure of the document.

    The structure variable is the numeric system which represents
    the index of the hierarchy section in the table of contents.
    For example, the first section has structure index 1,
    the first subsection has structure index 1.1,
    the second subsection has structure index 1.2, etc.

    For the title, you need to extract the original title from
    the text, only fix the space inconsistency.

    The provided text contains tags like <physical_index_X> and
    <physical_index_X> to indicate the start and end of page X.

    For the physical_index, you need to extract the physical index
    of the start of the section from the text. Keep the <physical_index_X> format.

    The response should be in the following format.
        [
            {{
                "structure": <structure index, "x.x.x"> (string),
                "title": <title of the section, keep the original title>,
                "physical_index": "<physical_index_X> (keep the format)"
            }},
            ...
        ]

    Directly return the final JSON structure. Do not output anything else.
    """

    prompt = prompt + "\nGiven text:\n" + part

    response, finish_reason = await llm_client.chat_with_finish_reason_async(prompt=prompt)

    if finish_reason == "finished":
        return extract_json(response)
    else:
        raise Exception(f"finish reason: {finish_reason}")
```

**调用时机**: 无目录模式，第一次生成目录

**输入**: 文档的前 N 页（通常 5-10 页）

**输出**: JSON 数组，包含章节标题和页码

**Token 估算**: 约 3000-8000 tokens（取决于页数）

### generate_toc_continue

**文件**: `pageindex-lib/src/pageindex/page_index.py:673-714`

```python
async def generate_toc_continue(toc_content, part, llm_client=None):
    print("start generate_toc_continue")

    prompt = """
    You are an expert in extracting hierarchical tree structure.
    You are given a tree structure of the previous part and the
    text of the current part.
    Your task is to continue the tree structure from the previous
    part to include the current part.

    The structure variable is the numeric system which represents
    the index of the hierarchy section in the table of contents.

    For the title, you need to extract the original title from
    the text, only fix the space inconsistency.

    The provided text contains tags like <physical_index_X> and
    <physical_index_X> to indicate the start and end of page X.

    For the physical_index, you need to extract the physical index
    of the start of the section from the text.
    Keep the <physical_index_X> format.

    The response should be in the following format.
        [
            {{
                "structure": <structure index, "x.x.x"> (string),
                "title": <title of the section, keep the original title>,
                "physical_index": "<physical_index_X> (keep the format)"
            }},
            ...
        ]

    Directly return the additional part of the final JSON structure.
    Do not output anything else.
    """

    prompt = (
        prompt + "\nGiven text:\n" + part
        + "\nPrevious tree structure:\n" + json.dumps(toc_content, indent=2)
    )

    response, finish_reason = await llm_client.chat_with_finish_reason_async(prompt=prompt)

    if finish_reason == "finished":
        return extract_json(response)
    else:
        raise Exception(f"finish reason: {finish_reason}")
```

**调用时机**: 无目录模式，文档被分成多个部分时

**输入**:
- `toc_content`: 之前生成的目录树结构
- `part`: 当前部分的文档内容

**输出**: 新增的目录树节点

**调用次数**: 取决于文档大小和 `max_pages_per_node` 设置

---

## 阶段四：标题位置验证

### check_title_appearance_in_start_concurrent

**文件**: `pageindex-lib/src/pageindex/page_index.py`

这是最消耗 LLM 调用的阶段之一！需要对每个章节标题验证其在文档中的实际位置。

```python
async def check_title_appearance_in_start_concurrent(toc_with_page_number, page_list, llm_client=None, logger=None):
    """
    并发验证每个章节标题是否出现在预期的页面位置

    这是 LLM 调用最密集的函数之一！
    """
    tasks = []

    for item in toc_with_page_number:
        if item.get("physical_index") is not None:
            # 为每个章节创建验证任务
            task = asyncio.create_task(
                check_single_item(item, page_list, llm_client=llm_client)
            )
            tasks.append(task)

    # 并发执行所有验证
    results = await asyncio.gather(*tasks)
    return results

async def check_single_item(item, page_list, llm_client=None):
    """验证单个章节标题的位置"""
    # 获取预期页面的内容
    page_content = page_list[item["physical_index"] - 1][0]

    prompt = f"""
    You are given a section title and a page of a document.
    Your job is to check if the section title appears in the given page.

    Section Title: {item["title"]}
    Page Content: {page_content}

    Return JSON format:
    {{
        "thinking": <analysis>,
        "appears": "yes" or "no"
    }}
    """

    response = await llm_client.chat_async(prompt)
    return extract_json(response)
```

**调用次数**: = 章节数量（通常 20-100 个）

**并发执行**: 使用 `asyncio.gather()` 并发调用

### single_toc_item_index_fixer

**文件**: `pageindex-lib/src/pageindex/page_index.py:954-992`

当标题验证失败时，使用 LLM 在指定范围内搜索标题的实际位置。

```python
async def single_toc_item_index_fixer(section_title, content, llm_client=None):
    """在给定页面范围内搜索章节标题的实际位置"""

    prompt = """
    You are given a section title and several pages of a document,
    your job is to find the physical index of the start page of the
    section in the partial document.

    The provided pages contains tags like <physical_index_X> and
    <physical_index_X> to indicate the physical location of the page X.

    Reply in a JSON format:
    {{
        "thinking": <explain which page, started and closed by
                    <physical_index_X>, contains the start of this section>,
        "physical_index": "<physical_index_X>" (keep the format)
    }}
    Directly return the final JSON structure. Do not output anything else.
    """

    prompt = (
        tob_extractor_prompt
        + "\nSection Title:\n" + str(section_title)
        + "\nDocument pages:\n" + content
    )

    response = await llm_client.chat_async(prompt)
    json_content = extract_json(response)
    return convert_physical_index_to_int(json_content["physical_index"])
```

**调用时机**: 标题验证失败时

**输入**: 章节标题 + 多页内容（搜索范围）

**Token 估算**: 约 2000-5000 tokens

---

## 阶段五：摘要生成

### generate_node_summary

**文件**: `pageindex-lib/src/pageindex/utils.py:664-672`

这是索引过程中 LLM 调用最多的部分！

```python
async def generate_node_summary(node, llm_client=None):
    prompt = f"""You are given a part of a document,
    your task is to generate a description of the partial document
    about what are main points covered in the partial document.

    Partial Document Text: {node["text"]}

    Directly return the description, do not include any other text.
    """

    response = await llm_client.chat_async(prompt)
    return response

async def generate_summaries_for_structure(structure, llm_client=None):
    """为所有节点生成摘要（并发执行）"""
    nodes = structure_to_list(structure)

    # 为每个节点创建摘要任务
    tasks = [
        generate_node_summary(node, llm_client=llm_client)
        for node in nodes
    ]

    # 并发执行
    summaries = await asyncio.gather(*tasks, return_exceptions=True)

    # 将摘要添加到节点
    for node, summary in zip(nodes, summaries):
        if not isinstance(summary, Exception):
            node["summary"] = summary

    return structure
```

**调用次数**: = 节点数量（通常 20-50 个）

**并发执行**: 是

**输入**: 单个节点的文本内容

**输出**: 节点摘要（1-3 句话）

**Token 估算**:
- 输入：约 1000-5000 tokens（取决于节点大小）
- 输出：约 100-300 tokens

### generate_doc_description

**文件**: `pageindex-lib/src/pageindex/utils.py:711-719`

**可选功能**：生成整个文档的一句话描述。

```python
def generate_doc_description(structure, llm_client=None):
    prompt = f"""Your are an expert in generating descriptions for a document.
    You are given a structure of a document.
    Your task is to generate a one-sentence description for the document,
    which makes it easy to distinguish the document from other documents.

    Document Structure: {structure}

    Directly return the description, do not include any other text.
    """

    response = llm_client.chat(prompt)
    return response
```

**调用条件**: `if_add_doc_description=yes`

**调用次数**: 1 次（整个文档）

**Token 估算**: 约 1000-3000 tokens

---

## 调用次数统计

### 典型场景：239 页的《纳瓦尔宝典》

| 阶段 | 函数 | 调用次数 | Token 估算 |
|------|------|----------|-----------|
| 目录检测 | `toc_detector_single_page` | 0-3 次（优化后） | 500-2000 |
| 目录提取 | `toc_extractor` + 相关 | 2-5 次 | 2000-5000 |
| 目录生成 | `generate_toc_init` | 1 次 | 3000-8000 |
| 目录生成 | `generate_toc_continue` | 3-7 次 | 3000-8000 |
| 标题验证 | `check_title_appearance_in_start_concurrent` | 20-40 次 | 1000-3000 |
| 页码修复 | `single_toc_item_index_fixer` | 0-10 次 | 2000-5000 |
| 摘要生成 | `generate_node_summary` | 20-30 次 | 1000-5000 |
| 文档描述 | `generate_doc_description` | 0-1 次 | 1000-3000 |

**总计**: 约 **50-100 次 LLM 调用**

**总 Token 估算**: 约 **50,000-200,000 tokens**

### 调用次数对比（优化前后）

| 场景 | 优化前 | 优化后 | 减少 |
|------|--------|--------|------|
| 目录检测 | 20 次（每页） | 0-3 次 | 85%+ |
| 其他阶段 | 无变化 | 无变化 | - |

---

## 优化建议

### 1. 目录检测优化（已实施）

**现状**: 使用规则置信度过滤

```python
# 高置信度（≥0.7）：直接使用规则，无需 LLM
# 中等置信度（0.3-0.7）：LLM 确认
# 低置信度（<0.3）：跳过
```

**效果**: 减少 85%+ 的目录检测 LLM 调用

### 2. 标题验证优化（待实施）

**问题**: `check_title_appearance_in_start_concurrent` 对每个章节都调用 LLM

**建议**: 使用规则匹配优先

```python
def check_title_by_rules(title, page_content):
    """使用规则快速验证标题是否在页面中"""
    # 1. 精确匹配
    if title in page_content:
        return True, 1.0

    # 2. 模糊匹配（去除空格、标点）
    clean_title = re.sub(r'\s+', '', title)
    clean_content = re.sub(r'\s+', '', page_content)
    if clean_title in clean_content:
        return True, 0.9

    # 3. 关键词匹配
    title_words = set(title.split())
    content_words = set(page_content.split())
    overlap = len(title_words & content_words) / len(title_words)
    if overlap > 0.7:
        return True, overlap

    return False, 0

# 规则失败后再使用 LLM
if not matched_by_rules:
    result = await llm_check_title_appearance(...)
```

**预期效果**: 减少 50-70% 的标题验证 LLM 调用

### 3. 批量摘要生成（待实施）

**问题**: 每个节点单独调用 LLM

**建议**: 使用批量请求

```python
async def generate_summaries_batch(nodes, llm_client=None):
    """批量生成摘要"""
    batch_size = 5  # 每批 5 个节点

    for i in range(0, len(nodes), batch_size):
        batch = nodes[i:i+batch_size]

        prompt = "Generate summaries for the following document sections:\n\n"
        for j, node in enumerate(batch):
            prompt += f"Section {j+1}:\n{node['text']}\n\n"

        prompt += """
        Return a JSON array of summaries, one for each section, in order:
        [
            "summary for section 1",
            "summary for section 2",
            ...
        ]
        """

        response = await llm_client.chat_async(prompt)
        summaries = json.loads(response)

        for node, summary in zip(batch, summaries):
            node["summary"] = summary
```

**预期效果**: 减少 API 调用次数 80%，但单次调用 Token 增加

### 4. 缓存机制（待实施）

```python
import hashlib

def get_content_hash(content):
    return hashlib.md5(content.encode()).hexdigest()

_llm_cache = {}

async def cached_llm_call(prompt, llm_client):
    prompt_hash = get_content_hash(prompt)

    if prompt_hash in _llm_cache:
        return _llm_cache[prompt_hash]

    response = await llm_client.chat_async(prompt)
    _llm_cache[prompt_hash] = response
    return response
```

**适用场景**: 重复索引相同 PDF

---

## LLM Provider 配置

### Provider 选择

**文件**: `pageindex-lib/src/pageindex/llm_provider.py:173-209`

```python
def get_provider(provider_config):
    provider_type = provider_config.get("type", "openai")

    if provider_type == "custom":
        # 硅基流动、Moonshot 等
        base_url = provider_config.get("base_url")
        model_param = provider_config.get("model_param", "model")
        return CustomProvider(base_url=base_url, api_key=..., model_param=model_param)

    elif provider_type == "deepseek":
        # DeepSeek
        return DeepSeekProvider(base_url="https://api.deepseek.com", ...)

    elif provider_type == "openai":
        # OpenAI
        return OpenAIProvider(api_key=..., base_url=...)
```

### 重试机制

**文件**: `pageindex-lib/src/pageindex/llm_provider.py:227-245`

```python
class UnifiedLLM:
    def __init__(self, provider, model, max_retries=10):
        self.provider = provider
        self.model = model
        self.max_retries = max_retries

    def chat(self, prompt, chat_history=None, temperature=0):
        for i in range(self.max_retries):
            try:
                return self.provider.chat(self.model, messages, temperature)
            except Exception as e:
                # 指数退避
                is_connection_error = any(
                    keyword in str(e).lower()
                    for keyword in ["connection", "timeout", "network"]
                )
                wait_time = min(2 ** i, 10) if is_connection_error else 1

                if i < self.max_retries - 1:
                    time.sleep(wait_time)
                else:
                    return "Error"
```

**重试策略**:
- 普通错误: 固定 1 秒等待
- 连接错误: 指数退避（1, 2, 4, 8, 10 秒）
- 最大重试: 10 次

---

## 成本估算

### Token 消耗

假设使用 OpenAI GPT-4 或类似模型：

| 阶段 | 调用次数 | 平均 Token | 总 Token |
|------|----------|-----------|----------|
| 目录检测 | 3 | 1500 | 4,500 |
| 目录提取 | 5 | 4000 | 20,000 |
| 目录生成 | 8 | 6000 | 48,000 |
| 标题验证 | 30 | 2000 | 60,000 |
| 页码修复 | 5 | 4000 | 20,000 |
| 摘要生成 | 25 | 3000 | 75,000 |
| 文档描述 | 1 | 2000 | 2,000 |
| **总计** | **77** | - | **229,500** |

### API 成本（参考价格）

**OpenAI GPT-4** (2024年价格):
- Input: $30/1M tokens
- Output: $60/1M tokens
- 假设 70% input, 30% output
- 成本: ~$6-8 / 文档

**DeepSeek** (更便宜):
- Input: ¥1/1M tokens
- Output: ¥2/1M tokens
- 成本: ~¥0.3-0.5 / 文档

**硅基流动 GLM-Z1-9B** (免费):
- 成本: ¥0 / 文档
- 限制: 有速率限制

---

## 总结

### LLM 调用分布

```
目录检测:     ███░░░░░░  10%
目录提取:     ██████░░░░  20%
目录生成:     ████████░░  25%
标题验证:     ██████████  35%
摘要生成:     ████████░░  25%
文档描述:     ██░░░░░░░░   5%
             ─────────────
总计: 50-100 次调用/文档
```

### 关键发现

1. **标题验证是最大的 LLM 消耗点**（35%）
   - 每个章节都需要验证
   - 可以通过规则匹配优化

2. **摘要生成是第二大的消耗点**（25%）
   - 与节点数量成正比
   - 可以通过批量调用优化

3. **目录检测优化效果显著**
   - 规则过滤减少了 85%+ 的调用
   - 准确率影响小

4. **无目录模式成本更高**
   - 需要生成完整目录结构
   - 建议优先使用有目录的 PDF
