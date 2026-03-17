# 段落向量化实现计划

> 设计文档: `docs/plans/2026-03-17-paragraph-vectorization-design.md`
> 创建日期: 2026-03-17

## 任务概览

| # | 任务 | 文件 | 预计改动 |
|---|------|------|----------|
| 1 | 添加段落切分函数 | `backend/.../indexer.py` | +60 行 |
| 2 | 添加段落提取函数 | `backend/.../indexer.py` | +80 行 |
| 3 | 修改索引流程，存储段落向量 | `backend/.../indexer.py` | +30 行 |
| 4 | 更新 querier 透传段落字段 | `backend/.../querier.py` | +10 行 |
| 5 | 更新前端 search-doc 格式化 | `frontend/.../search-doc.ts` | +40 行 |
| 6 | 测试验证 | - | - |

---

## Task 1: 添加段落切分函数

**文件**: `backend/deeppdf-api/src/deeppdf/services/indexer.py`

**位置**: 在 `_extract_nodes_from_tree` 函数之后添加

**代码**:

```python
# ============================================================
# 段落切分
# ============================================================

# 切分参数
PARAGRAPH_CHUNK_MIN = 300      # 目标最小字数
PARAGRAPH_CHUNK_TARGET = 400   # 理想目标字数
PARAGRAPH_CHUNK_MAX = 500      # 硬性上限
PARAGRAPH_MIN_KEEP = 100       # 小于此值不切分


def _split_text_to_chunks(text: str) -> List[Dict[str, Any]]:
    """
    将文本按句子边界切分成多个 chunk

    Args:
        text: 待切分的文本

    Returns:
        List of {"text": chunk_text, "char_start": int, "char_end": int}
    """
    if not text or len(text) < PARAGRAPH_MIN_KEEP:
        return [{"text": text, "char_start": 0, "char_end": len(text)}] if text else []

    # 如果文本长度在合理范围内，不切分
    if len(text) <= PARAGRAPH_CHUNK_MAX:
        return [{"text": text, "char_start": 0, "char_end": len(text)}]

    # 按中文句子分割（句号、问号、感叹号）
    import re
    sentence_pattern = r'([。！？\n]+)'
    parts = re.split(sentence_pattern, text)

    # 重新组合句子（保留标点）
    sentences = []
    for i in range(0, len(parts) - 1, 2):
        sentence = parts[i] + (parts[i + 1] if i + 1 < len(parts) else '')
        if sentence.strip():
            sentences.append(sentence)

    # 处理最后一部分（如果没有配对的标点）
    if len(parts) % 2 == 1 and parts[-1].strip():
        sentences.append(parts[-1])

    if not sentences:
        return [{"text": text, "char_start": 0, "char_end": len(text)}]

    # 贪心合并句子
    chunks = []
    current_chunk = ""
    current_start = 0
    char_pos = 0
    sentence_positions = []

    # 记录每个句子的起始位置
    pos = 0
    for s in sentences:
        sentence_positions.append((pos, pos + len(s)))
        pos += len(s)

    for i, (sentence, (s_start, s_end)) in enumerate(zip(sentences, sentence_positions)):
        test_chunk = current_chunk + sentence
        test_length = len(test_chunk)

        if test_length < PARAGRAPH_CHUNK_MIN:
            # 还没达到最小长度，继续累加
            current_chunk = test_chunk
        elif PARAGRAPH_CHUNK_MIN <= test_length <= PARAGRAPH_CHUNK_MAX:
            # 在合理范围内，检查是否接近目标
            if test_length >= PARAGRAPH_CHUNK_TARGET or i == len(sentences) - 1:
                # 达到目标或是最后一句，切分
                chunks.append({
                    "text": current_chunk + sentence,
                    "char_start": current_start,
                    "char_end": s_end
                })
                current_chunk = ""
                current_start = s_end
            else:
                # 继续累加，尝试达到目标
                current_chunk = test_chunk
        else:
            # 超过上限
            if current_chunk:
                # 先保存当前 chunk
                chunks.append({
                    "text": current_chunk,
                    "char_start": current_start,
                    "char_end": sentence_positions[i-1][1] if i > 0 else current_start
                })
                current_chunk = sentence
                current_start = s_start
            else:
                # 单句就超长，在逗号处强制切分
                sub_chunks = _split_long_sentence(sentence, current_start)
                chunks.extend(sub_chunks)
                current_chunk = ""
                current_start = s_end

    # 处理剩余内容
    if current_chunk.strip():
        chunks.append({
            "text": current_chunk,
            "char_start": current_start,
            "char_end": len(text)
        })

    return chunks if chunks else [{"text": text, "char_start": 0, "char_end": len(text)}]


def _split_long_sentence(sentence: str, start_pos: int) -> List[Dict[str, Any]]:
    """
    在逗号处切分超长句子

    Args:
        sentence: 超长句子
        start_pos: 起始位置

    Returns:
        切分后的 chunk 列表
    """
    import re
    comma_pattern = r'([，,；;]+)'
    parts = re.split(comma_pattern, sentence)

    chunks = []
    current = ""
    current_start = start_pos
    pos = start_pos

    for i, part in enumerate(parts):
        if len(current + part) <= PARAGRAPH_CHUNK_MAX:
            current += part
        else:
            if current:
                chunks.append({
                    "text": current,
                    "char_start": current_start,
                    "char_end": pos + len(current)
                })
            current = part
            current_start = pos
        pos += len(part)

    if current:
        chunks.append({
            "text": current,
            "char_start": current_start,
            "char_end": start_pos + len(sentence)
        })

    # 如果还是无法切分（无逗号），硬切分
    if not chunks:
        for i in range(0, len(sentence), PARAGRAPH_CHUNK_TARGET):
            chunk_text = sentence[i:i + PARAGRAPH_CHUNK_TARGET]
            if chunk_text:
                chunks.append({
                    "text": chunk_text,
                    "char_start": start_pos + i,
                    "char_end": start_pos + i + len(chunk_text)
                })

    return chunks
```

**验证命令**:
```bash
cd /Users/lizhao/workspace/DeepReader/backend
uv run python -c "
from deeppdf.services.indexer import _split_text_to_chunks

# 测试短文本
short = '这是一个短段落。'
print('短文本:', _split_text_to_chunks(short))

# 测试中等文本
medium = '第一句。' * 80
print('中等文本 chunks:', len(_split_text_to_chunks(medium)))

# 测试长文本
long_text = '这是一个测试句子。' * 100
chunks = _split_text_to_chunks(long_text)
print(f'长文本: {len(long_text)} 字 -> {len(chunks)} chunks')
for i, c in enumerate(chunks[:3]):
    print(f'  chunk {i}: {len(c[\"text\"])} 字')
"
```

---

## Task 2: 添加段落提取函数

**文件**: `backend/deeppdf-api/src/deeppdf/services/indexer.py`

**位置**: 在 `_split_long_sentence` 函数之后添加

**代码**:

```python
# ============================================================
# 段落提取
# ============================================================

def _extract_paragraphs_from_tree(
    tree: Dict[str, Any],
    parent_section: str = "",
    chapter_index: int = 0,
    doc_type: str = "pdf",
    pdf_name: str = "",
) -> List[Dict]:
    """
    从 PageIndex 树状结构中提取段落并生成 chunk

    Args:
        tree: PageIndex 树结构
        parent_section: 父级章节名称
        chapter_index: 章节序号（用于生成 block_id）
        doc_type: 文档类型 (pdf/epub)
        pdf_name: 文档名称

    Returns:
        段落 chunk 列表
    """
    chunks: List[Dict] = []

    if not tree:
        return chunks

    node_name = tree.get("title", "")
    node_id = tree.get("node_id", "")
    node_text = tree.get("text", "")
    start_page = tree.get("start_index")

    current_section = f"{parent_section} > {node_name}" if parent_section else node_name

    # 提取当前节点的段落
    if node_text and node_text.strip():
        # 按换行符分割物理段落
        paragraphs = node_text.split('\n')
        paragraph_index = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            # 生成 block_id: ^ch{章节序号}-p{段落序号}
            block_id = f"^ch{chapter_index}-p{paragraph_index}"

            # 切分成 chunks
            para_chunks = _split_text_to_chunks(para)

            for chunk_idx, chunk_info in enumerate(para_chunks):
                chunk_id = f"{node_id}_p{paragraph_index}-c{chunk_idx}" if node_id else f"para_{chapter_index}_{paragraph_index}_c{chunk_idx}"

                chunks.append({
                    "id": chunk_id,
                    "text": chunk_info["text"],
                    "metadata": {
                        "type": "paragraph",
                        "block_id": block_id,
                        "chunk_index": chunk_idx,
                        "total_chunks": len(para_chunks),
                        "full_paragraph": para,  # 完整段落原文
                        "parent_node_id": node_id,
                        "parent_section": current_section,
                        "page": start_page,
                        "paragraph_index": paragraph_index,
                        "char_start": chunk_info["char_start"],
                        "char_end": chunk_info["char_end"],
                        "pdf_name": pdf_name,
                    }
                })

            paragraph_index += 1

    # 递归处理子节点（保持章节序号）
    children = tree.get("nodes", [])
    for child in children:
        chunks.extend(
            _extract_paragraphs_from_tree(
                child, current_section, chapter_index, doc_type, pdf_name
            )
        )

    return chunks


def _extract_all_paragraphs(
    structure_list: List[Dict],
    doc_type: str = "pdf",
    pdf_name: str = "",
) -> List[Dict]:
    """
    从结构列表中提取所有段落

    Args:
        structure_list: PageIndex 结构列表
        doc_type: 文档类型
        pdf_name: 文档名称

    Returns:
        所有段落 chunk 列表
    """
    all_chunks: List[Dict] = []

    for chapter_index, top_node in enumerate(structure_list):
        chunks = _extract_paragraphs_from_tree(
            top_node, "", chapter_index, doc_type, pdf_name
        )
        all_chunks.extend(chunks)

    return all_chunks
```

**验证命令**:
```bash
cd /Users/lizhao/workspace/DeepReader/backend
uv run python -c "
from deeppdf.services.indexer import _extract_all_paragraphs, _split_text_to_chunks

# 模拟一个简单的树结构
mock_tree = [{
    'title': '第一章',
    'node_id': 'node_1',
    'text': '这是第一段内容。' * 50 + '\\n\\n' + '这是第二段内容。' * 30,
    'start_index': 1,
    'nodes': []
}]

chunks = _extract_all_paragraphs(mock_tree, 'pdf', '测试文档')
print(f'提取了 {len(chunks)} 个 chunks')
for c in chunks[:3]:
    print(f\"  - {c['id']}: block_id={c['metadata']['block_id']}, len={len(c['text'])}\")
"
```

---

## Task 3: 修改索引流程

**文件**: `backend/deeppdf-api/src/deeppdf/services/indexer.py`

**修改 1**: 更新 `_store_to_chromadb` 函数签名和实现

找到 `_store_to_chromadb` 函数（约第 420 行），修改：

```python
def _store_to_chromadb(
    section_nodes: List[Dict],
    paragraph_chunks: Optional[List[Dict]] = None,  # 新增参数
    index_id: str = "",
    pdf_path_obj: Path = None,
    storage_dir: str = "",
    doc_type: str = "pdf",
    progress_callback=None,
    original_filename: Optional[str] = None,
) -> Tuple[float, int]:  # 返回 (vector_time, paragraph_count)
    """
    存储到 ChromaDB

    Args:
        section_nodes: 章节节点列表
        paragraph_chunks: 段落 chunk 列表（可选）
        ...其他参数...

    Returns:
        (vector_time, paragraph_count)
    """
    if progress_callback:
        progress_callback("store_vectors", 80, "正在向量化并存储章节...")

    storage_dir_path = Path(storage_dir)
    chroma_dir = storage_dir_path / "chroma"
    chroma_dir.mkdir(parents=True, exist_ok=True)
    logger.info(f"[向量存储] ChromaDB 目录: {chroma_dir}")

    vector_start = time.time()
    store = get_chroma_store(persist_directory=str(chroma_dir))

    # 创建集合
    logger.info(f"[向量存储] 创建集合: {index_id}")
    display_name = Path(original_filename).stem if original_filename else pdf_path_obj.stem

    # 计算总节点数
    total_nodes = len(section_nodes) + (len(paragraph_chunks) if paragraph_chunks else 0)

    collection_metadata = {
        "doc_type": doc_type,
        "pdf_name": display_name,
        "pdf_path": str(pdf_path_obj.absolute()),
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "node_count": len(section_nodes),
        "paragraph_count": len(paragraph_chunks) if paragraph_chunks else 0,
        "indexing_method": "pageindex_tree",
        "llm_enabled": True,
        "read_pages": "",
        "chat_rounds": 0,
        "last_read_at": "",
    }

    store.create_collection(name=index_id, metadata=collection_metadata)
    logger.info("[向量存储] 集合创建成功")

    # 准备章节文档
    logger.info("[向量存储] 准备章节文档...")
    documents = [
        {
            "id": node["id"],
            "text": node["text"],
            "metadata": {**node["metadata"], "pdf_name": display_name, "type": "section"},
        }
        for node in section_nodes
    ]

    # 添加章节文档
    store.add_documents(index_id, documents)
    logger.info(f"[向量存储] 已存储 {len(documents)} 个章节向量")

    # 存储段落向量
    paragraph_count = 0
    if paragraph_chunks:
        if progress_callback:
            progress_callback("store_paragraphs", 88, "正在向量化并存储段落...")

        logger.info("[向量存储] 准备段落文档...")
        para_documents = [
            {
                "id": chunk["id"],
                "text": chunk["text"],
                "metadata": chunk["metadata"],
            }
            for chunk in paragraph_chunks
        ]

        store.add_documents(index_id, para_documents)
        paragraph_count = len(para_documents)
        logger.info(f"[向量存储] 已存储 {paragraph_count} 个段落向量")

    vector_time = time.time() - vector_start
    logger.info(f"[向量存储] 总耗时: {vector_time:.2f} 秒")

    return vector_time, paragraph_count
```

**修改 2**: 更新调用 `_store_to_chromadb` 的位置

找到调用 `_store_to_chromadb` 的位置（约第 1006 行），修改：

```python
        # 提取段落 chunks
        logger.info("[段落提取] 开始从章节中提取段落...")
        paragraph_chunks = _extract_all_paragraphs(
            structure_list, doc_type, original_stem
        )
        logger.info(f"[段落提取] 共提取 {len(paragraph_chunks)} 个段落 chunks")

        # 步骤 6: 存储到 ChromaDB（包含章节和段落）
        vector_time, paragraph_count = _store_to_chromadb(
            section_nodes,
            paragraph_chunks=paragraph_chunks,  # 新增
            index_id=index_id,
            pdf_path_obj=pdf_path_obj,
            storage_dir=storage_dir,
            doc_type=doc_type,
            progress_callback=progress_callback,
            original_filename=original_filename,
        )
```

**修改 3**: 更新返回结果

找到最终返回的位置（约第 1056 行），修改：

```python
        return {
            "status": "success",
            "index_id": index_id,
            "doc_type": doc_type,
            "node_count": len(section_nodes),
            "paragraph_count": paragraph_count,  # 新增
            "pdf_name": original_stem,
            "indexing_method": "pageindex_tree",
        }
```

---

## Task 4: 更新 querier 透传段落字段

**文件**: `backend/deeppdf-api/src/deeppdf/services/querier.py`

**位置**: 找到 `_query_pdf_sync` 函数中格式化结果的部分（约第 130-150 行）

**修改**:

```python
                formatted_results.append({
                    "text": item["text"],
                    "metadata": {
                        **item["metadata"],
                        # 确保段落相关字段被透传
                        "type": item["metadata"].get("type", "section"),
                        "block_id": item["metadata"].get("block_id"),
                        "full_paragraph": item["metadata"].get("full_paragraph"),
                        "markdown_path": markdown_path,
                    },
                })
```

---

## Task 5: 更新前端 search-doc 格式化

**文件**: `frontend/src/agent/tools/search-doc.ts`

**修改**: 找到格式化结果的部分（约第 118-148 行），替换为：

```typescript
      // 格式化搜索结果，区分章节和段落
      const formattedResults = result.results
        .map((item, index) => {
          const type = item.metadata.type || 'section';
          const isParagraph = type === 'paragraph';
          const distance = item.metadata.distance !== undefined
            ? ` (relevance: ${(1 - item.metadata.distance).toFixed(2)})`
            : '';

          if (isParagraph) {
            // 段落结果格式
            const blockId = item.metadata.block_id || '';
            const parentSection = item.metadata.parent_section || 'Unknown';
            const page = item.metadata.page;
            const fullParagraph = item.metadata.full_paragraph || item.text;

            // 生成 Obsidian block 链接
            const obsidianLink = `[[${context.pdfName}#${blockId}]]`;

            log(`[search_doc] 段落结果 ${index + 1}: block_id=${blockId}, page=${page}`);

            // 截断过长的文本
            const trimmedText = fullParagraph.trim();
            const truncatedText = trimmedText.length > MAX_TEXT_LENGTH_PER_RESULT
              ? trimmedText.slice(0, MAX_TEXT_LENGTH_PER_RESULT) + '...[已截断]'
              : trimmedText;

            return `${index + 1}. **${parentSection}** (Page ${page})${distance} [段落]
   Link: ${obsidianLink}
   block_id: ${blockId}
   ${truncatedText}`;
          } else {
            // 章节结果格式（保持现有逻辑）
            const section = item.metadata.section || item.metadata.node_name || 'Unknown Section';
            const page = item.metadata.page;
            const nodeId = item.metadata.node_id;

            const obsidianLink = generateObsidianLink(
              nodeId,
              section,
              context.pdfName,
              context.markdownFiles
            );

            log(`[search_doc] 章节结果 ${index + 1}: node_id=${nodeId}, page=${page}`);

            const trimmedText = item.text.trim();
            const truncatedText = trimmedText.length > MAX_TEXT_LENGTH_PER_RESULT
              ? trimmedText.slice(0, MAX_TEXT_LENGTH_PER_RESULT) + '...[已截断]'
              : trimmedText;

            return `${index + 1}. **${section}**${page ? ` (Page ${page})` : ''}${distance}
   Link: ${obsidianLink}
   node_id: ${nodeId || 'N/A'}
   ${truncatedText}`;
          }
        })
        .join('\n\n');
```

---

## Task 6: 测试验证

### 6.1 单元测试

**文件**: 新建 `backend/deeppdf-api/tests/test_paragraph_chunking.py`

```python
"""段落切分测试"""
import pytest
from deeppdf.services.indexer import _split_text_to_chunks


class TestSplitTextToChunks:
    """测试文本切分功能"""

    def test_short_text_not_split(self):
        """短文本不切分"""
        text = "这是一个短段落。"
        chunks = _split_text_to_chunks(text)
        assert len(chunks) == 1
        assert chunks[0]["text"] == text

    def test_medium_text_not_split(self):
        """中等长度文本不切分"""
        text = "第一句。" * 70  # 约 350 字
        chunks = _split_text_to_chunks(text)
        assert len(chunks) == 1

    def test_long_text_split(self):
        """长文本需要切分"""
        text = "这是一个测试句子。" * 100  # 1000 字
        chunks = _split_text_to_chunks(text)
        assert len(chunks) > 1

        # 每个 chunk 长度在合理范围内
        for chunk in chunks:
            assert len(chunk["text"]) <= 500

    def test_chunk_positions(self):
        """chunk 位置信息正确"""
        text = "第一句。第二句。第三句。"
        chunks = _split_text_to_chunks(text)
        assert chunks[0]["char_start"] == 0
        assert chunks[-1]["char_end"] == len(text)
```

### 6.2 集成测试

```bash
# 1. 启动后端
cd /Users/lizhao/workspace/DeepReader/backend
uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio

# 2. 索引一个测试 PDF
curl -X POST "http://localhost:6088/index/local" \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/test.pdf"}'

# 3. 测试搜索（应返回段落和章节混合结果）
curl -X POST "http://localhost:6088/query" \
  -H "Content-Type: application/json" \
  -d '{"query": "测试问题", "index_id": "idx_xxx"}'

# 4. 检查结果中是否有 type: paragraph 的记录
```

### 6.3 前端测试

```bash
# 1. 构建前端
cd /Users/lizhao/workspace/DeepReader/frontend
npm run build

# 2. 在 Obsidian 中重新加载插件
# Cmd+R 或 使用 obsidian CLI

# 3. 测试 search_doc 工具
# 在 Agent 对话中提问，观察返回的 Link 格式
# 章节应为 [[文件名|章节名]]
# 段落应为 [[文件名#^ch0-p1]]
```

---

## 提交计划

每个 Task 完成后单独提交：

```bash
git add backend/deeppdf-api/src/deeppdf/services/indexer.py
git commit -m "feat(indexer): add paragraph chunking functions

- Add _split_text_to_chunks() for sentence-boundary text splitting
- Add _extract_paragraphs_from_tree() for paragraph extraction
- Target chunk size: 300-400 chars, max 500 chars"

git add backend/deeppdf-api/src/deeppdf/services/querier.py
git commit -m "feat(querier): pass through paragraph metadata fields"

git add frontend/src/agent/tools/search-doc.ts
git commit -m "feat(search-doc): format paragraph results with block links"

git add backend/deeppdf-api/tests/test_paragraph_chunking.py
git commit -m "test: add unit tests for paragraph chunking"
```

---

## 回滚方案

如果实现出现问题，可以：

1. 通过 `metadata.type` 过滤，只返回 `section` 类型结果
2. 重新索引文档（旧索引无段落向量，自动降级）
3. Git revert 对应的 commit
