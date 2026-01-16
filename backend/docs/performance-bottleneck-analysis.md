# 索引建立性能分析：为什么这么慢？

> 分析 PageIndex 索引建立的性能瓶颈
>
> 创建时间: 2026-01-16

## 问题概述

**现象**: 索引一个 239 页的 PDF 需要 5-10 分钟

**根本原因**: 大量的 LLM API 调用 + 网络延迟

---

## 时间消耗分解

### 实际日志分析

```
2026-01-16 12:44:44 - 开始解析 PDF
2026-01-16 12:44:51 - 第1次 API 调用完成 (7秒)
2026-01-16 12:44:56 - 第2次 API 调用完成 (5秒)
2026-01-16 12:45:03 - 第3次 API 调用完成 (7秒)
2026-01-16 12:45:11 - 第4次 API 调用完成 (8秒)
2026-01-16 12:45:20 - 第5次 API 调用完成 (9秒)
2026-01-16 12:45:26 - 第6次 API 调用完成 (6秒)
2026-01-16 12:45:31 - 第7次 API 调用完成 (5秒)
... (继续)
2026-01-16 12:45:51 - Connection error (出现网络错误)
```

**观察**: 每次 API 调用约 5-10 秒

---

## 瓶颈分析

### 瓶颈 #1: 标题验证阶段（最严重！）

**函数**: `check_title_appearance_in_start_concurrent`

**问题**:
- 对每个章节标题验证是否在预期的页面
- 假设 30 个章节 = 30 次 LLM 调用
- 每次 5-10 秒
- **总时间: 150-300 秒 (2.5-5 分钟)**

**代码位置**: `page_index.py`

```python
async def check_title_appearance_in_start_concurrent(
    toc_with_page_number, page_list, llm_client=None, logger=None
):
    tasks = []
    for item in toc_with_page_number:
        if item.get("physical_index") is not None:
            # 为每个章节创建一个验证任务！
            task = asyncio.create_task(
                check_single_toc_item(item, page_list, llm_client=llm_client)
            )
            tasks.append(task)

    # 并发执行，但仍然是 30 次 LLM 调用！
    results = await asyncio.gather(*tasks)
    return results
```

**为什么慢**:
1. 即使是并发执行，LLM API 也有速率限制
2. 每个 API 调用都有网络延迟（1-3 秒）
3. LLM 处理时间（2-5 秒）
4. 重试机制增加额外时间

---

### 瓶颈 #2: 摘要生成阶段

**函数**: `generate_summaries_for_structure`

**问题**:
- 为每个节点生成摘要
- 假设 30 个节点 = 30 次 LLM 调用
- 每次 5-10 秒
- **总时间: 150-300 秒 (2.5-5 分钟)**

**代码位置**: `utils.py:675-683`

```python
async def generate_summaries_for_structure(structure, llm_client=None):
    nodes = structure_to_list(structure)

    # 为每个节点生成摘要！
    tasks = [
        generate_node_summary(node, llm_client=llm_client)
        for node in nodes
    ]

    # 并发执行，但仍然是 30 次 LLM 调用！
    summaries = await asyncio.gather(*tasks, return_exceptions=True)

    for node, summary in zip(nodes, summaries):
        if not isinstance(summary, Exception):
            node["summary"] = summary
    return structure
```

**每个摘要的 Prompt**:
```
You are given a part of a document,
your task is to generate a description of the partial document
about what are main points covered in the partial document.

Partial Document Text: {node["text"]}

Directly return the description, do not include any other text.
```

**Token 估算**: 1000-5000 tokens / 节点

---

### 瓶颈 #3: 目录生成阶段（无目录模式）

**函数**: `generate_toc_init` + `generate_toc_continue`

**问题**:
- 当 PDF 没有目录时，需要 LLM 分析文档生成目录
- 每部分 5-10 页，需要 4-8 次调用
- 每次 5-10 秒
- **总时间: 20-80 秒**

**代码位置**: `page_index.py:718-751`

---

### 瓶颈 #4: 网络连接错误

**问题**:
```
2026-01-16 12:33:30 - root - ERROR - Error: Connection error.
2026-01-16 12:34:33 - HTTP Request (重试后)
```

**影响**:
- 连接错误导致重试
- 指数退避：1秒 → 2秒 → 4秒 → 8秒
- 每次错误增加 15 秒延迟

---

## 时间估算（239页PDF）

| 阶段 | LLM 调用次数 | 单次耗时 | 总耗时 |
|------|-------------|---------|--------|
| 目录检测 | 0-3 次 | 5-10秒 | 0-30秒 |
| 目录生成 | 4-8 次 | 5-10秒 | 20-80秒 |
| 标题验证 | 20-40 次 | 5-10秒 | 100-400秒 ← **最大瓶颈** |
| 页码修复 | 0-10 次 | 5-10秒 | 0-100秒 |
| 摘要生成 | 20-30 次 | 5-10秒 | 100-300秒 ← **第二瓶颈** |
| 文档描述 | 0-1 次 | 5-10秒 | 0-10秒 |
| **总计** | **50-100 次** | - | **约 5-10 分钟** |

---

## 单次 LLM 调用的时间分解

```
┌─────────────────────────────────────────────────┐
│          单次 LLM API 调用的时间分解            │
├─────────────────────────────────────────────────┤
│                                                 │
│  网络延迟:  1-3 秒 ████████                    │
│  LLM 处理:  2-5 秒 ████████████████             │
│  响应传输:  0.5-1 秒 ██                        │
│  重试等待:  0-15 秒 (如果有错误) ████████████  │
│                                                 │
│  总计:      5-10 秒 (正常)                    │
│            10-30 秒 (有重试)                    │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 为什么标题验证这么慢？

### 详细分析

```python
# page_index.py 中的标题验证流程
async def check_title_appearance_in_start_concurrent(...):
    # 假设有 30 个章节

    tasks = []
    for item in toc_with_page_number:
        # 每个章节都调用 LLM
        task = asyncio.create_task(
            check_single_toc_item(item, page_list, llm_client)
        )
        tasks.append(task)

    # 并发执行
    results = await asyncio.gather(*tasks)
```

### 问题：并发为什么还是慢？

1. **API 速率限制**
   - 硅基流动: 10-20 请求/分钟
   - Moonshot: 类似限制
   - 30 个请求会被排队

2. **网络带宽**
   - 每次请求/响应都有延迟
   - 无法完全并行

3. **LLM 处理时间**
   - 模型需要读取和分析文本
   - 即使并行，服务器也需要处理时间

---

## 为什么摘要生成这么慢？

### 详细分析

```python
# utils.py:675
async def generate_summaries_for_structure(structure, llm_client=None):
    nodes = structure_to_list(structure)  # 假设 30 个节点

    tasks = [
        generate_node_summary(node, llm_client=llm_client)
        for node in nodes  # 30 次调用！
    ]

    summaries = await asyncio.gather(*tasks)
```

### 问题

1. **节点数量多**: 30 个节点 = 30 次调用
2. **Token 数量大**: 每个节点 1000-5000 tokens
3. **串行依赖**: 虽然并发，但受 API 限制

---

## 性能优化建议

### 优先级 1: 优化标题验证（影响最大）

**当前**: 30 次 LLM 调用，150-300 秒

**方案**: 规则匹配优先

```python
def check_title_by_rules(title, page_content):
    """使用规则快速验证"""
    # 1. 精确匹配
    if title in page_content:
        return True

    # 2. 去除空格匹配
    clean_title = re.sub(r'\s+', '', title)
    clean_content = re.sub(r'\s+', '', page_content)
    if clean_title in clean_content:
        return True

    # 3. 关键词匹配 (80% 匹配度)
    title_words = set(title.split())
    content_words = set(page_content.split())
    overlap = len(title_words & content_words) / len(title_words)
    if overlap > 0.8:
        return True

    # 4. 失败时才用 LLM
    return False

# 只有 20% 的标题需要 LLM 确认
# 30 次调用 → 6 次调用
# 时间: 150-300 秒 → 30-60 秒
```

**预期效果**: 减少 80% 标题验证时间

---

### 优先级 2: 跳过摘要生成（可选）

**当前**: 30 次调用，150-300 秒

**方案**: 添加参数控制

```python
# 请求参数
{
    "if_add_node_summary": false  # 不生成摘要
}
```

**权衡**:
- 优点: 节省 2.5-5 分钟
- 缺点: 检索质量可能下降

---

### 优先级 3: 使用更快的 LLM

**当前**: 使用通用大模型

**方案**: 使用专门的快速模型

| 模型 | 速度 | 质量 | 成本 |
|------|------|------|------|
| GPT-4 | 基准 | 最好 | 高 |
| Claude | 基准 | 好 | 中 |
| DeepSeek | 快 20% | 好 | 低 |
| GLM-Z1-9B | 快 50% | 中 | 免费 |
| 小模型 (量化) | 快 70% | 可用 | 很低 |

**建议**:
- 目录生成: 使用高质量模型
- 标题验证: 使用快速模型
- 摘要生成: 使用中等模型

---

### 优先级 4: 增加并发数

**当前**: `max_retries=10`, 没有并发控制

**方案**: 批量并发

```python
async def generate_summaries_batch(nodes, llm_client=None):
    """每批 5 个节点"""
    batch_size = 5

    for i in range(0, len(nodes), batch_size):
        batch = nodes[i:i+batch_size]

        # 单次调用处理 5 个节点
        prompt = "Generate summaries for:\n"
        for j, node in enumerate(batch):
            prompt += f"Section {j+1}: {node['text'][:200]}...\n"

        prompt += "Return JSON array of summaries."

        response = await llm_client.chat_async(prompt)
        summaries = json.loads(response)
```

**预期效果**:
- API 调用次数: 30 → 6
- 但单次 Token 增加
- 总体可能更快

---

## 实际优化建议

### 立即可做（不改代码）

1. **使用更快的 LLM**
   ```json
   {
     "llm_model": "THUDM/glm-z1-9b-0414",  // 硅基流动免费
     "if_add_node_summary": false  // 跳过摘要生成
   }
   ```

2. **减少节点数量**
   ```json
   {
     "max_pages_per_node": 20  // 当前 5-10，改为 20
   }
   ```
   节点数: 30 → 15，LLM 调用减半

3. **使用更快的 API**
   - 硅基流动: 免费，速度快
   - DeepSeek: 便宜，速度快
   - 避免使用 OpenAI（网络慢）

---

## 总结

### 索引慢的根本原因

1. **标题验证**: 占用 30-40% 时间，最大瓶颈
2. **摘要生成**: 占用 25-30% 时间，第二瓶颈
3. **LLM API 延迟**: 每次调用 5-10 秒
4. **网络错误**: 重试增加额外时间

### 快速优化方案

| 优化项 | 难度 | 效果 | 时间节省 |
|--------|------|------|----------|
| 跳过摘要生成 | 低 | 中 | 2-3 分钟 |
| 增大 max_pages_per_node | 低 | 中 | 1-2 分钟 |
| 使用快速 LLM | 低 | 高 | 1-3 分钟 |
| 优化标题验证 | 高 | 高 | 2-4 分钟 |

### 预期优化效果

**当前**: 5-10 分钟/文档

**快速优化后** (不改代码):
- 跳过摘要: 2-3 分钟
- 增大节点: +1-2 分钟
- 总计: **3-5 分钟/文档**

**深度优化后** (改代码):
- 规则优先验证: -2 分钟
- 批量摘要: -1 分钟
- 总计: **2-3 分钟/文档**

---

## 下一步

您希望我：
1. 实施某个优化方案？
2. 进一步分析某个瓶颈？
3. 创建性能测试脚本？
