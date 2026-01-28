# EPUB 文档支持设计文档

**日期**: 2025-01-28
**作者**: Claude
**状态**: 设计阶段

---

## 概述

为 DeepPDF 添加 EPUB 电子书格式支持，与现有 PDF 支持保持架构一致性。

**核心原则**：
- EPUB 解析全过程放在 PageIndex 库中实现
- DeepPDF 侧做最小改动
- 统一的索引和检索接口
- 自动检测文档类型

---

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  DeepPDF 项目                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  统一调用 PageIndex API：                                           │
│  - page_index_main(file_path)  # 自动检测 PDF/EPUB                  │
│  - 返回统一的 tree_structure                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│  PageIndex 库（需要扩展）                                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  现有：page_index_main(file_path) → 解析 PDF → tree_structure      │
│  新增：自动检测文件类型 → PDF/EPUB 解析器 → 统一 tree_structure    │
│                                                                     │
│  新增组件：                                                         │
│  - epub_parser.py: EPUB 解析（使用 ebooklib）                       │
│  - epub_to_tree.py: EPUB → PageIndex 格式转换                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 数据流

```
用户上传 EPUB → Obsidian 插件检测 → /api/index/document
     ↓
DeepPDF 调用 PageIndex.page_index_main(file_path)
     ↓
PageIndex 自动检测类型 → EPUB 解析器 → tree_structure
     ↓
DeepPDF 存储：ChromaDB 统一向量化 + 元数据（doc_type="epub"）
     ↓
检索：hybrid_search / llm_tree_search 无需区分类型
     ↓
Markdown 导出：根据 doc_type 选择格式
```

---

## PageIndex 库侧实现

### 新增模块

```
pageIndex/
├── epub_parser.py      # EPUB 解析器
├── epub_to_tree.py      # EPUB → PageIndex 树转换
├── page_index.py        # 修改：添加 EPUB 支持
└── utils.py             # 可能需要扩展工具函数
```

### 1. epub_parser.py

```python
"""
EPUB 文档解析器

依赖：ebooklib, beautifulsoup4, html2text
"""
from typing import Dict, Any, List
from ebooklib import epub
from bs4 import BeautifulSoup
import html2text

class EpubParser:
    """EPUB 文件解析器"""

    def __init__(self, epub_path: str):
        self.epub_path = epub_path
        self.book = None

    def load(self) -> None:
        """加载 EPUB 文件"""
        self.book = epub.read_epub(self.epub_path)

    def get_metadata(self) -> Dict[str, Any]:
        """获取元数据"""
        return {
            "title": self.book.get_metadata("DC", "title")[0],
            "author": self.book.get_metadata("DC", "creator")[0],
            "language": self.book.get_metadata("DC", "language")[0],
        }

    def get_toc(self) -> List[Dict]:
        """获取目录结构"""
        toc = self.book.get_toc()
        return self._parse_toc(toc)

    def get_chapters(self) -> List[Dict]:
        """获取所有章节内容"""
        chapters = []
        for item in self.book.get_items():
            if isinstance(item, epub.EpubHtml):
                content = item.get_content()
                text = self._html_to_text(content)
                chapters.append({
                    "file_name": item.get_name(),
                    "content": text,
                })
        return chapters

    def _html_to_text(self, html: str) -> str:
        """HTML 转纯文本"""
        h = html2text.HTML2Text()
        h.ignore_links = True
        h.ignore_images = True
        return h.handle(html)
```

### 2. epub_to_tree.py

```python
"""
EPUB → PageIndex 树结构转换器
"""
from typing import Dict, Any, List

def epub_to_tree(
    epub_data: Dict[str, Any],
    assign_node_ids: bool = True
) -> Dict[str, Any]:
    """将 EPUB 数据转换为 PageIndex tree_structure 格式"""
    parser = EpubTreeConverter()
    return parser.convert(epub_data, assign_node_ids)

class EpubTreeConverter:
    """EPUB 树转换器"""

    def convert(self, epub_data: Dict[str, Any], assign_node_ids: bool) -> Dict[str, Any]:
        metadata = epub_data["metadata"]
        toc = epub_data["toc"]
        chapters = epub_data["chapters"]

        chapter_index = self._build_chapter_index(chapters)
        structure = self._toc_to_tree(toc, chapter_index, assign_node_ids)

        return {
            "title": metadata["title"],
            "structure": structure,
        }
```

### 3. page_index.py 修改

```python
def page_index_main(
    file_path: str,
    config: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    主入口：自动检测文档类型并生成索引

    支持：PDF, EPUB
    """
    doc_type = _detect_document_type(file_path)

    if doc_type == "pdf":
        return _process_pdf(file_path, config)
    elif doc_type == "epub":
        return _process_epub(file_path, config)
    else:
        raise ValueError(f"不支持的文档类型: {doc_type}")

def _detect_document_type(file_path: str) -> str:
    """检测文档类型"""
    ext = Path(file_path).suffix.lower()

    if ext == ".pdf":
        return "pdf"
    elif ext == ".epub":
        return "epub"

    # magic bytes 检测
    with open(file_path, "rb") as f:
        header = f.read(4)
        if header == b"%PDF":
            return "pdf"
        elif header[:2] == b"PK":
            return "epub"

    raise ValueError(f"无法识别的文档类型: {file_path}")

def _process_epub(file_path: str, config: Optional[Dict]) -> Dict[str, Any]:
    """处理 EPUB 文件"""
    from .epub_parser import EpubParser
    from .epub_to_tree import epub_to_tree

    parser = EpubParser(file_path)
    parser.load()

    epub_data = {
        "metadata": parser.get_metadata(),
        "toc": parser.get_toc(),
        "chapters": parser.get_chapters(),
    }

    tree = epub_to_tree(epub_data, assign_node_ids=True)

    # 可选：生成摘要
    if config and config.get("use_llm"):
        tree = _generate_summaries(tree, config)

    return tree
```

---

## DeepPDF 侧改动

### API 层

```python
# backend/deeppdf-api/src/deeppdf/api/routes.py

SUPPORTED_DOC_TYPES = {".pdf", ".epub"}

@app.post("/api/index/document")  # 新端点
async def index_document(request: IndexRequest):
    """统一文档索引入口"""
    file_ext = Path(request.file_path).suffix.lower()
    if file_ext not in SUPPORTED_DOC_TYPES:
        raise HTTPException(400, f"不支持的文件类型")

    return await index_document(
        file_path=request.file_path,
        storage_dir=settings.storage_dir,
        use_llm=request.use_llm,
    )

# 向后兼容
@app.post("/api/index/pdf")
async def index_pdf_legacy(request: IndexRequest):
    """PDF 索引入口（向后兼容）"""
    return await index_document(request)
```

### 数据模型

```python
# backend/deeppdf-api/src/deeppdf/api/models.py

class IndexResponse(BaseModel):
    """索引响应"""
    index_id: str
    doc_type: Literal["pdf", "epub"]  # 新增
    status: str
    node_count: int
    message: str
```

### 索引元数据格式

```json
{
  "index_id": "xxx",
  "doc_type": "epub",
  "pdf_name": "book.epub",
  "pdf_path": "/path/to/book.epub",
  "node_count": 10,
  "tree_structure": {...},
  "markdown_files": {...}
}
```

---

## 前端（Obsidian 插件）改动

### 文件类型检测

```typescript
async function detectDocumentType(file: TFile): Promise<"pdf" | "epub"> {
    const ext = file.extension.toLowerCase();
    if (ext === "pdf") return "pdf";
    if (ext === "epub") return "epub";
    throw new Error(`不支持的文件类型: ${ext}`);
}

async function indexDocument(file: TFile, useLlm: boolean = false) {
    const docType = await detectDocumentType(file);
    return await apiClient.indexDocument({
        file_path: file.path,
        use_llm: useLlm,
    });
}
```

### UI 更新

```typescript
// 文件选择器支持 EPUB
<input
    type="file"
    accept=".pdf,.epub"
    onChange={handleFileSelect}
/>
```

---

## 实现优先级

| 优先级 | 任务 | 位置 |
|--------|------|------|
| P0 | PageIndex 库添加 EPUB 解析和转换 | PageIndex 项目 |
| P0 | DeepPDF API 支持 .epub 文件 | DeepPDF 后端 |
| P1 | 统一索引端点 /api/index/document | DeepPDF 后端 |
| P1 | Obsidian 插件支持 EPUB 上传 | DeepPDF 前端 |
| P2 | Markdown 导出适配 EPUB | DeepPDF 后端 |

---

## 测试计划

### PageIndex 库测试
- EPUB 解析器单元测试
- EPUB → tree 转换测试
- 文档类型检测测试

### DeepPDF 测试
- API 端点测试（.epub 文件）
- 索引流程端到端测试
- 检索功能测试（PDF/EPUB 混合）
