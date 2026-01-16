# PDF 索引建立流程分析

> 从代码执行角度分析 PDF 索引的完整流程
>
> 更新时间: 2026-01-16

## 目录

1. [流程概览](#流程概览)
2. [API 层处理](#api-层处理)
3. [服务层处理](#服务层处理)
4. [PageIndex 解析](#pageindex-解析)
5. [向量存储](#向量存储)
6. [性能优化点](#性能优化点)
7. [错误处理](#错误处理)

---

## 流程概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                          索引建立流程                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. API 请求 (POST /api/index)                                      │
│     ↓                                                                │
│  2. 路由验证 (routes.py: create_index)                               │
│     ↓                                                                │
│  3. 创建后台任务 (asyncio.create_task)                               │
│     ↓                                                                │
│  4. 异步索引执行 (_run_index_task)                                   │
│     ↓                                                                │
│  5. 线程池执行 (_index_pdf_sync)                                    │
│     ↓                                                                │
│  6. PageIndex 解析 (page_index_main)                                │
│     ↓                                                                │
│  7. ChromaDB 存储                                                    │
│     ↓                                                                │
│  8. 返回结果                                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## API 层处理

### 入口点

**文件**: `deeppdf-api/src/deeppdf/api/routes.py`
**函数**: `create_index(req: IndexRequest)`

### 执行流程

```python
# 第 64-140 行
@router.post("/index", response_model=IndexResponse)
async def create_index(req: IndexRequest):
    # 1. 同步验证路径
    pdf_path = Path(req.path)
    if not pdf_path.exists():
        raise HTTPException(status_code=400, detail="PDF file not found")

    # 2. 生成任务 ID
    task_id = f"task_{hashlib.md5(f'{req.path}{time.time()}'.encode()).hexdigest()[:12]}"

    # 3. 提取 LLM 配置参数
    llm_config = {
        "model": req.llm_model,
        "llm_provider": req.llm_provider,
        "api_key": req.openai_api_key or req.deepseek_api_key,
        "base_url": req.api_url,
        "max_pages_per_node": req.max_pages_per_node,
        "if_add_node_summary": req.if_add_node_summary,
        # ... 其他参数
    }

    # 4. 初始化任务状态
    _running_tasks[task_id] = {
        "status": "pending",
        "message": "任务已创建，等待处理",
        "pdf_path": req.path,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "cancelled": False
    }

    # 5. 创建异步任务 (非阻塞)
    task = asyncio.create_task(
        _run_index_task(task_id, req.path, str(settings.base_dir), **llm_config)
    )
    _running_tasks[task_id]["task"] = task

    # 6. 立即返回 (< 1 秒)
    return IndexResponse(
        status="pending",
        index_id=task_id,
        message="索引任务已创建..."
    )
```

### 关键设计

1. **快速返回**: 请求验证后立即返回，不等待索引完成
2. **后台执行**: 使用 `asyncio.create_task()` 创建后台任务
3. **状态跟踪**: `_running_tasks` 字典存储任务状态和 asyncio.Task 对象
4. **可取消性**: 通过 Task 对象支持 `task.cancel()`

---

## 服务层处理

### 任务包装器

**文件**: `deeppdf-api/src/deeppdf/api/routes.py`
**函数**: `_run_index_task(task_id, pdf_path, storage_dir, **kwargs)`

```python
# 第 25-61 行
async def _run_index_task(task_id, pdf_path, storage_dir, **kwargs):
    """后台运行索引任务（支持取消）"""
    try:
        # 1. 检查取消标记
        if _running_tasks.get(task_id, {}).get("cancelled"):
            _running_tasks[task_id]["status"] = "cancelled"
            return

        # 2. 更新状态为处理中
        _running_tasks[task_id]["status"] = "processing"
        _running_tasks[task_id]["message"] = "正在索引 PDF..."

        # 3. 调用索引服务
        result = await index_pdf(pdf_path, storage_dir, **kwargs)

        # 4. 再次检查取消
        if _running_tasks.get(task_id, {}).get("cancelled"):
            _running_tasks[task_id]["status"] = "cancelled"
            return

        # 5. 更新最终状态
        if result["status"] == "error":
            _running_tasks[task_id]["status"] = "failed"
            _running_tasks[task_id]["error"] = result.get("error")
        else:
            _running_tasks[task_id]["status"] = "completed"
            _running_tasks[task_id]["result"] = result

    except asyncio.CancelledError:
        _running_tasks[task_id]["status"] = "cancelled"
        raise
    except Exception as e:
        _running_tasks[task_id]["status"] = "failed"
        _running_tasks[task_id]["error"] = str(e)
```

### 异步索引服务

**文件**: `deeppdf-api/src/deeppdf/services/indexer.py`
**函数**: `index_pdf(pdf_path, storage_dir, **kwargs)`

```python
# 第 368-383 行
async def index_pdf(pdf_path: str, storage_dir: str, **kwargs) -> Dict[str, Any]:
    """异步 PDF 索引"""
    loop = asyncio.get_event_loop()

    # 将 CPU 密集型任务委托给线程池执行
    result = await loop.run_in_executor(
        cpu_executor,  # ThreadPoolExecutor(max_workers=2)
        functools.partial(_index_pdf_sync, pdf_path=pdf_path, storage_dir=storage_dir, **kwargs)
    )
    return result
```

### 为什么使用线程池?

**问题**: PDF 解析和 LLM 调用是 CPU/IO 密集型操作
- 阻塞事件循环，导致其他请求无法处理

**解决方案**: `ThreadPoolExecutor`
- 在独立线程中执行同步代码
- 不阻塞主事件循环
- 限制并发数 (`max_workers=2`)

### 同步索引核心

**文件**: `deeppdf-api/src/deeppdf/services/indexer.py`
**函数**: `_index_pdf_sync(pdf_path, storage_dir, **kwargs)`

```python
# 第 103-365 行
def _index_pdf_sync(pdf_path: str, storage_dir: str, **kwargs) -> Dict[str, Any]:
    """在线程池中执行的同步逻辑"""

    # === 步骤 1/6: 验证 PDF 文件 ===
    # 第 152-177 行
    if not pdf_path_obj.exists():
        return {"status": "error", "error": "PDF file not found"}

    file_size = pdf_path_obj.stat().st_size
    if file_size < 1024:
        return {"status": "error", "error": "PDF file is too small"}

    # === 步骤 2/6: 检查 LLM API 配置 ===
    # 第 179-194 行
    llm_api_key = api_key or os.getenv("DEEPSEEK_API_KEY") or os.getenv("OPENAI_API_KEY")
    if require_llm and not llm_api_key:
        return {"status": "error", "error": "LLM API key is required"}

    # === 步骤 3/6: 初始化 PageIndex 配置 ===
    # 第 203-234 行
    config_loader = ConfigLoader()
    user_opt = {
        "model": model,
        "if_add_node_summary": if_add_node_summary if require_llm else "no",
        "max_page_num_each_node": max_pages_per_node,
        "llm_provider": {
            "type": llm_provider,
            "api_key": llm_api_key,
            "base_url": base_url,
        },
        # ... 其他配置
    }
    opt = config_loader.load(user_opt)

    # 创建 LLM 客户端
    from pageindex.llm_provider import get_provider
    provider = get_provider(user_opt["llm_provider"])
    llm_client_instance = UnifiedLLM(provider=provider, model=opt.model)

    # === 步骤 4/6: 创建 LLM 客户端 ===
    # (已在上面完成)

    # === 步骤 5/6: 解析 PDF 结构 ===
    # 第 236-273 行
    tree_result = page_index_main(str(pdf_path), opt=opt, llm_client=llm_client_instance)

    if not tree_result or not tree_result.get("structure"):
        raise Exception("PageIndex returned empty tree structure")

    # 提取章节节点
    section_nodes = []
    for top_level_node in tree_result.get("structure", []):
        nodes = _extract_nodes_from_tree(top_level_node)
        section_nodes.extend(nodes)

    # === 步骤 6/6: 存储到向量数据库 ===
    # 第 275-335 行
    store = ChromaStore(persist_directory=str(chroma_dir))
    store.create_collection(name=index_id, metadata={...})

    documents = [
        {
            "id": node["id"],
            "text": node["text"],  # 【章节名】\n摘要内容
            "metadata": {...}
        }
        for node in section_nodes
    ]

    store.add_documents(index_id, documents)

    # 保存索引元数据
    with open(metadata_path, "w") as f:
        json.dump({
            "id": index_id,
            "tree_structure": tree_result,
            "sections": section_nodes
        }, f)

    return {
        "status": "success",
        "index_id": index_id,
        "node_count": len(section_nodes)
    }
```

---

## PageIndex 解析

### 入口点

**文件**: `pageindex-lib/src/pageindex/page_index.py`
**函数**: `page_index_main(doc, opt=None, llm_client=None)`

### 执行流程

```python
# 第 1427-1480 行
def page_index_main(doc, opt=None, llm_client=None):
    # 1. 验证 PDF 输入
    is_valid_pdf = (
        isinstance(doc, str) and os.path.isfile(doc) and doc.lower().endswith(".pdf")
    ) or isinstance(doc, BytesIO)

    # 2. 解析 PDF 为页面列表
    print("Parsing PDF...")
    page_list = get_page_tokens(doc)  # 返回 [(page_text, token_count), ...]

    # 3. 异步构建树结构
    async def page_index_builder():
        # === 核心解析逻辑 ===
        structure = await tree_parser(page_list, opt, doc=doc, logger=logger, llm_client=llm_client)

        # 可选：添加节点 ID
        if opt.if_add_node_id == "yes":
            write_node_id(structure)

        # 可选：添加节点文本
        if opt.if_add_node_text == "yes":
            add_node_text(structure, page_list)

        # 可选：生成节点摘要
        if opt.if_add_node_summary == "yes":
            if opt.if_add_node_text == "no":
                add_node_text(structure, page_list)
            await generate_summaries_for_structure(structure, llm_client=llm_client)
            if opt.if_add_node_text == "no":
                remove_structure_text(structure)

        return {
            "doc_name": get_pdf_name(doc),
            "structure": structure,
        }

    # 4. 处理事件循环 (支持 nest_asyncio)
    try:
        loop = asyncio.get_running_loop()
        import nest_asyncio
        nest_asyncio.apply()
        return loop.run_until_complete(page_index_builder())
    except RuntimeError:
        return asyncio.run(page_index_builder())
```

### tree_parser: 树结构解析

**文件**: `pageindex-lib/src/pageindex/page_index.py`
**函数**: `tree_parser(page_list, opt, doc, logger, llm_client)`

```python
# 第 1291-1380 行
async def tree_parser(page_list, opt, doc=None, logger=None, llm_client=None):
    # === 1. 检查目录 ===
    check_toc_result = await check_toc(page_list, opt, llm_client=llm_client)

    # === 2. 根据目录情况选择处理模式 ===
    if (check_toc_result.get("toc_content")
        and check_toc_result["page_index_given_in_toc"] == "yes"):
        # 模式 A: 有目录且有页码
        toc_with_page_number = await meta_processor(
            page_list,
            mode="process_toc_with_page_numbers",
            toc_content=check_toc_result["toc_content"],
            toc_page_list=check_toc_result["toc_page_list"],
            ...
        )
    elif check_toc_result.get("toc_content"):
        # 模式 B: 有目录但无页码
        toc_with_page_number = await meta_processor(
            page_list,
            mode="process_toc_no_page_numbers",
            ...
        )
    else:
        # 模式 C: 无目录 (按页数分割)
        toc_with_page_number = await meta_processor(
            page_list,
            mode="process_no_toc",
            ...
        )

    # === 3. 验证标题出现在页面位置 ===
    toc_with_page_number = await check_title_appearance_in_start_concurrent(
        toc_with_page_number, page_list, llm_client=llm_client, logger=logger
    )

    # === 4. 后处理：构建树结构 ===
    valid_toc_items = [item for item in toc_with_page_number if item.get("physical_index") is not None]
    toc_tree = post_processing(valid_toc_items, len(page_list))

    # === 5. 递归处理大节点 ===
    tasks = [
        process_large_node_recursively(child, page_list, opt, logger=logger, llm_client=llm_client)
        for child in toc_tree
    ]
    await asyncio.gather(*tasks)

    return toc_tree
```

### 目录检测优化

**文件**: `pageindex-lib/src/pageindex/page_index.py`
**函数**: `find_toc_pages(start_page_index, page_list, opt, llm_client, logger)`

```python
# 第 445-514 行
async def find_toc_pages(start_page_index=0, page_list=None, opt=None, llm_client=None, logger=None):
    """优化版目录检测：先使用规则快速过滤，只在必要时使用 LLM"""

    toc_page_list = []
    rule_based_count = 0
    llm_confirm_count = 0

    for i in range(start_page_index, len(page_list)):
        if i >= opt.toc_check_page_num and not toc_page_list:
            break

        content = page_list[i][0]

        # === 规则计算置信度 ===
        confidence = _calculate_toc_confidence(content)

        # === 根据置信度决定策略 ===
        if confidence >= 0.7:  # 高置信度：直接使用规则
            is_toc_page = True
            rule_based_count += 1
        elif confidence >= 0.3:  # 中等置信度：LLM 确认
            detected_result = await toc_detector_single_page(content, llm_client=llm_client)
            is_toc_page = (detected_result == "yes")
            llm_confirm_count += 1
        else:  # 低置信度：跳过
            is_toc_page = False

        if is_toc_page:
            toc_page_list.append(i)
        elif toc_page_list:  # 目录结束
            break

    logger.info(f"TOC detection: {rule_based_count} rule-based, {llm_confirm_count} LLM-confirmed")
    return toc_page_list
```

### 置信度计算

**文件**: `pageindex-lib/src/pageindex/page_index.py`
**函数**: `_calculate_toc_confidence(content: str)`

```python
# 第 393-442 行
def _calculate_toc_confidence(content: str) -> float:
    """使用规则计算页面是目录页的置信度 (0-1)"""
    confidence = 0.0

    # 1. 目录关键词检测 (权重 0.4)
    toc_keywords = ["目录", "contents", "chapter", "章节", ...]
    if any(keyword in content.lower() for keyword in toc_keywords):
        confidence += 0.4

    # 2. 章节列表结构检测 (权重 0.3)
    lines = [line.strip() for line in content.split('\n') if line.strip()]
    if len(lines) >= 5:
        chapter_patterns = sum(1 for line in lines if line[0].isdigit())
        if chapter_patterns >= len(lines) * 0.3:
            confidence += 0.3

    # 3. 页码模式检测 (权重 0.2)
    import re
    page_numbers = re.findall(r'第?\s*\d+\s*章|^\d+\s+', content, re.MULTILINE)
    if len(page_numbers) >= 3:
        confidence += 0.2

    # 4. 点号引导模式 (权重 0.1)
    dot_pattern = re.findall(r'^\s*[\d一二三四五六七八九十]+[.、．]\s*\w+', content, re.MULTILINE)
    if len(dot_pattern) >= 3:
        confidence += 0.1

    return min(confidence, 1.0)
```

---

## 向量存储

### ChromaStore 初始化

**文件**: `deeppdf-api/src/deeppdf/storage/chroma_store.py`
**类**: `ChromaStore`

```python
# 第 13-44 行
class ChromaStore:
    def __init__(self, persist_directory: str = None, embedding_function=None):
        # 持久化目录
        self.persist_directory = Path(persist_directory)
        self.persist_directory.mkdir(parents=True, exist_ok=True)

        # 初始化中文嵌入函数
        self.embedding_function = embedding_function or ChineseEmbeddingFunction()

        # 初始化 ChromaDB 客户端
        self.client = chromadb.PersistentClient(
            path=str(self.persist_directory),
            settings=Settings(anonymized_telemetry=False, allow_reset=True)
        )
```

### 创建集合

```python
# 第 46-81 行
def create_collection(self, name: str, metadata=None, embedding_function=None):
    # 检查是否已存在
    existing_collections = [c.name for c in self.client.list_collections()]
    if name in existing_collections:
        return self.client.get_collection(name)

    # 使用中文嵌入函数
    embed_fn = embedding_function or self.embedding_function

    # 创建集合
    collection = self.client.create_collection(
        name=name,
        embedding_function=embed_fn,
        metadata=metadata if metadata else NotSet
    )
    return collection
```

### 添加文档

```python
# 第 115-140 行
def add_documents(self, collection_name: str, documents: List[Dict[str, Any]]):
    collection = self.get_collection(collection_name)

    ids = [doc["id"] for doc in documents]
    texts = [doc["text"] for doc in documents]
    metadatas = [doc["metadata"] for doc in documents]

    # ChromaDB 自动调用嵌入函数向量化 texts
    collection.add(
        ids=ids,
        documents=texts,
        metadatas=metadatas
    )
```

### 嵌入函数

**文件**: `deeppdf-api/src/deeppdf/storage/embeddings.py`
**类**: `ChineseEmbeddingFunction`

```python
class ChineseEmbeddingFunction(EmbeddingFunction):
    def __init__(self):
        # 使用 FlagEmbedging (BAAI/bge-small-zh-v1.5)
        from FlagEmbedding import BGEM3FlagModel
        self.model = BGEM3FlagModel('BAAI/bge-small-zh-v1.5', use_fp16=True)

    def __call__(self, texts: List[str]) -> List[List[float]]:
        # 返回 512 维向量
        return self.model.encode(texts)['dense_vecs'].tolist()
```

---

## 性能优化点

### 1. 后台任务模式

**优化前**: 同步等待索引完成 (5-10 分钟)
**优化后**: 立即返回任务 ID (< 1 秒)

```python
# 优化前 (旧代码)
result = await index_pdf(...)
return IndexResponse(**result)  # 等待 5-10 分钟

# 优化后 (当前代码)
task = asyncio.create_task(_run_index_task(...))
return IndexResponse(status="pending", index_id=task_id)  # 立即返回
```

### 2. 规则过滤目录检测

**优化前**: 每页调用 LLM 检测
**优化后**: 高置信度页面直接使用规则

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 典型目录页 | 1 次 LLM | 0 次 LLM |
| 非目录页 | 1 次 LLM | 0 次 LLM |
| 模糊页面 | 1 次 LLM | 1 次 LLM |

**减少 API 调用**: 70-90%

### 3. 指数退避重试

**优化前**: 所有错误等待 1 秒
**优化后**: 连接错误指数退避

```python
# 优化前
time.sleep(1)  # 固定等待

# 优化后
is_connection_error = any(keyword in error_msg.lower() for keyword in ["connection", "timeout", ...])
wait_time = min(2 ** i, 10) if is_connection_error else 1  # 1, 2, 4, 8, 10 秒
```

### 4. 线程池限制并发

```python
# 全局线程池
cpu_executor = ThreadPoolExecutor(max_workers=2)
```

**目的**: 限制同时索引的 PDF 数量，避免资源耗尽

---

## 错误处理

### API 层错误

```python
# 路径不存在
if not pdf_path.exists():
    raise HTTPException(status_code=400, detail="PDF file not found")
```

### 服务层错误

```python
# 文件过小
if file_size < 1024:
    return {"status": "error", "error": "PDF file is too small"}

# LLM API Key 缺失
if require_llm and not llm_api_key:
    return {"status": "error", "error": "LLM API key is required"}

# custom provider 缺少 base_url
if llm_provider == "custom" and not base_url:
    return {"status": "error", "error": "api_url parameter is required"}
```

### LLM 调用错误

```python
# UnifiedLLM 重试机制 (最多 10 次)
for i in range(self.max_retries):
    try:
        return self.provider.chat(self.model, messages, temperature)
    except Exception as e:
        if i < self.max_retries - 1:
            wait_time = min(2 ** i, 10) if is_connection_error else 1
            time.sleep(wait_time)
        else:
            return "Error"
```

### 任务取消处理

```python
try:
    result = await index_pdf(...)
except asyncio.CancelledError:
    _running_tasks[task_id]["status"] = "cancelled"
    raise
```

---

## 数据流图

```
┌──────────────┐
│ API Request  │ POST /api/index
│  {           │   path: xxx.pdf
│   path,      │   llm_model: xxx
│   llm_*,     │   api_url: xxx
│  }           │
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ routes.py: create_index()                              │
│  - 验证路径存在                                          │
│  - 生成 task_id                                         │
│  - 创建后台任务                                         │
│  - 立即返回 task_id                                     │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ routes.py: _run_index_task()                           │
│  - 更新状态: processing                                 │
│  - 检查取消标记                                          │
│  - 调用 index_pdf()                                     │
│  - 更新状态: completed/failed                           │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ indexer.py: index_pdf()                                │
│  - 使用 ThreadPoolExecutor                              │
│  - 委托给 _index_pdf_sync()                             │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ indexer.py: _index_pdf_sync()                          │
│  - 验证文件/配置                                         │
│  - 初始化 PageIndex + LLM                               │
│  - 调用 page_index_main()                               │
│  - 提取章节节点                                          │
│  - 存储 ChromaDB                                        │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ page_index.py: page_index_main()                       │
│  - 解析 PDF 为页面列表                                   │
│  - 调用 tree_parser()                                   │
│  - 生成节点摘要 (可选)                                   │
│  - 返回树结构                                            │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ page_index.py: tree_parser()                           │
│  - check_toc(): 检测目录                                │
│    └─ find_toc_pages(): 规则+LLM                        │
│  - meta_processor(): 生成章节树                         │
│  - check_title_appearance(): 验证页码                   │
│  - post_processing(): 构建树结构                        │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ ChromaStore                                             │
│  - create_collection()                                  │
│  - add_documents()                                      │
│    └─ 自动向量化 (bge-small-zh-v1.5)                    │
└──────┬──────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│ 完成                                                     │
│  - 更新任务状态: completed                              │
│  - 保存元数据 JSON                                       │
│  - 返回 index_id                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 文件路径映射

| 模块 | 文件路径 |
|------|----------|
| API 路由 | `deeppdf-api/src/deeppdf/api/routes.py` |
| 索引服务 | `deeppdf-api/src/deeppdf/services/indexer.py` |
| 存储层 | `deeppdf-api/src/deeppdf/storage/chroma_store.py` |
| 嵌入模型 | `deeppdf-api/src/deeppdf/storage/embeddings.py` |
| PageIndex | `pageindex-lib/src/pageindex/page_index.py` |
| LLM Provider | `pageindex-lib/src/pageindex/llm_provider.py` |

---

## 总结

整个索引建立流程分为 3 个阶段：

1. **快速响应阶段** (< 1 秒)
   - API 验证
   - 创建后台任务
   - 返回 task_id

2. **后台处理阶段** (5-10 分钟)
   - PDF 解析
   - 目录检测 (规则 + LLM)
   - 章节树生成
   - LLM 摘要生成
   - 向量化存储

3. **状态查询阶段**
   - GET /api/indexes/{task_id} 查询进度
   - DELETE /api/indexes/{task_id} 取消任务

**核心设计理念**:
- **异步优先**: 长时间任务不阻塞请求
- **可取消性**: 用户可随时取消任务
- **智能优化**: 规则过滤减少 LLM 调用
- **容错机制**: 指数退避处理网络波动
