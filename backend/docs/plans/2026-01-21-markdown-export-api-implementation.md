# Markdown 导出 API 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 扩展 PDF 导出 API，返回包含 `parent_id`, `total_pages`, `created_at` 的完整节点数据，供前端生成 Markdown 文件

**Architecture:**
- 后端只负责从索引元数据文件 (`{base_dir}/indexes/{index_id}.json`) 读取和转换数据
- 使用 pypdf 读取 PDF 获取总页数
- 遍历 `tree_structure` 建立节点父子关系映射
- 所有索引默认包含文本内容 (`if_add_node_text=yes`)

**Tech Stack:**
- FastAPI, Pydantic
- pypdf (PDF 页数读取)
- JSON (索引元数据存储)

---

## Task 1: 修改 ExportNodeData 模型，添加 parent_id 字段

**Files:**
- Modify: `deeppdf-api/src/deeppdf/api/export_models.py:8-17`

**Step 1: 修改模型，添加 parent_id 字段**

```python
class ExportNodeData(BaseModel):
    """单个节点的导出数据"""
    node_id: str
    node_name: str
    section: str
    page_range: str
    start_index: int | str
    end_index: int | str
    level: int
    text: str
    parent_id: str | None = None  # 新增：父节点 ID
```

**Step 2: 运行类型检查验证**

Run: `uv run mypy deeppdf-api/src/deeppdf/api/export_models.py`

Expected: No errors

**Step 3: 提交更改**

```bash
git add deeppdf-api/src/deeppdf/api/export_models.py
git commit -m "feat(export): add parent_id field to ExportNodeData"
```

---

## Task 2: 修改 ExportIndexResponse 模型，添加 total_pages 和 created_at 字段

**Files:**
- Modify: `deeppdf-api/src/deeppdf/api/export_models.py:20-25`

**Step 1: 修改响应模型，添加新字段**

```python
class ExportIndexResponse(BaseModel):
    """导出索引响应"""
    status: str
    index_id: str
    pdf_name: str
    total_pages: int          # 新增：PDF 总页数
    created_at: str           # 新增：创建时间
    nodes: List[ExportNodeData]
```

**Step 2: 运行类型检查验证**

Run: `uv run mypy deeppdf-api/src/deeppdf/api/export_models.py`

Expected: No errors

**Step 3: 提交更改**

```bash
git add deeppdf-api/src/deeppdf/api/export_models.py
git commit -m "feat(export): add total_pages and created_at to ExportIndexResponse"
```

---

## Task 3: 创建 export_utils.py 辅助函数模块

**Files:**
- Create: `deeppdf-api/src/deeppdf/api/export_utils.py`

**Step 1: 创建辅助函数模块**

```python
"""
导出功能辅助函数
"""
import pypdf
from pathlib import Path
from typing import Dict, Any, Optional


def get_pdf_page_count(pdf_path: str) -> int:
    """
    获取 PDF 总页数

    Args:
        pdf_path: PDF 文件路径

    Returns:
        PDF 总页数，如果文件不存在返回 0
    """
    try:
        reader = pypdf.PdfReader(pdf_path)
        return len(reader.pages)
    except (FileNotFoundError, Exception):
        return 0


def build_parent_mapping(tree_structure: list) -> Dict[str, str]:
    """
    从树状结构构建 node_id → parent_id 的映射

    Args:
        tree_structure: tree_structure 中的 structure 列表

    Returns:
        {node_id: parent_id} 的字典，根节点的 parent_id 为 None

    Example:
        >>> tree = [{"node_id": "root", "nodes": [...]}]
        >>> mapping = build_parent_mapping(tree)
        >>> print(mapping)
        {"root": None, "child1": "root"}
    """
    parent_mapping: Dict[str, Optional[str]] = {}

    def traverse(nodes: list, parent_id: Optional[str] = None):
        """递归遍历树结构，记录父子关系"""
        for node in nodes:
            node_id = node.get("node_id")
            if node_id:
                parent_mapping[node_id] = parent_id

            # 递归处理子节点
            children = node.get("nodes", [])
            if children:
                traverse(children, node_id)

    traverse(tree_structure)
    return parent_mapping


def find_parent_id(node_id: str, tree_structure: list) -> Optional[str]:
    """
    查找节点的父节点 ID

    Args:
        node_id: 当前节点 ID
        tree_structure: tree_structure 中的 structure 列表

    Returns:
        父节点 ID，如果不存在（根节点）返回 None
    """
    parent_mapping = build_parent_mapping(tree_structure)
    return parent_mapping.get(node_id)


def format_created_at(created_at: str) -> str:
    """
    将 created_at 格式化为 ISO 8601 格式

    Args:
        created_at: 原始格式 "YYYY-MM-DD HH:MM:SS"

    Returns:
        ISO 8601 格式 "YYYY-MM-DDTHH:MM:SS"
    """
    # 简单处理：将空格替换为 T
    return created_at.replace(" ", "T") + "Z"
```

**Step 2: 运行类型检查验证**

Run: `uv run mypy deeppdf-api/src/deeppdf/api/export_utils.py`

Expected: No errors

**Step 3: 提交更改**

```bash
git add deeppdf-api/src/deeppdf/api/export_utils.py
git commit -m "feat(export): add utility functions for parent_id and page count"
```

---

## Task 4: 更新 export_index_data() 函数，使用新字段

**Files:**
- Modify: `deeppdf-api/src/deeppdf/api/export_handlers.py:10-71`

**Step 1: 在文件顶部添加 import**

```python
from .export_utils import get_pdf_page_count, find_parent_id, format_created_at
```

**Step 2: 修改函数，实现新逻辑**

```python
async def export_index_data(index_id: str):
    """导出索引的节点数据,供前端生成 Markdown"""
    try:
        # 加载索引元数据
        storage_dir = Path(settings.base_dir)
        metadata_path = storage_dir / "indexes" / f"{index_id}.json"

        if not metadata_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Index '{index_id}' not found"
            )

        with open(metadata_path, "r", encoding="utf-8") as f:
            metadata = json.load(f)

        # 提取节点数据
        nodes = []
        tree_structure = metadata.get("tree_structure", {}).get("structure", [])

        for section in metadata.get("sections", []):
            node_metadata = section.get("metadata", {})
            start_index = node_metadata.get("start_index", "?")
            end_index = node_metadata.get("end_index", "?")

            # 格式化页码范围
            if str(start_index) == str(end_index):
                page_range = str(start_index)
            else:
                page_range = f"{start_index}-{end_index}"

            nodes.append({
                "node_id": section.get("id", ""),
                "node_name": node_metadata.get("node_name", ""),
                "section": node_metadata.get("section", ""),
                "page_range": page_range,
                "start_index": start_index,
                "end_index": end_index,
                "level": node_metadata.get("level", 0),
                "text": section.get("text", ""),
                "parent_id": find_parent_id(section.get("id", ""), tree_structure)
            })

        # 获取总页数
        pdf_path = metadata.get("pdf_path", "")
        total_pages = get_pdf_page_count(pdf_path) if pdf_path else 0

        # 格式化创建时间
        created_at_raw = metadata.get("created_at", "")
        created_at = format_created_at(created_at_raw)

        return {
            "status": "success",
            "index_id": index_id,
            "pdf_name": metadata.get("pdf_name", ""),
            "total_pages": total_pages,
            "created_at": created_at,
            "nodes": nodes
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export index data: {str(e)}"
        )
```

**Step 3: 运行类型检查验证**

Run: `uv run mypy deeppdf-api/src/deeppdf/api/export_handlers.py`

Expected: No errors

**Step 4: 提交更改**

```bash
git add deeppdf-api/src/deeppdf/api/export_handlers.py
git commit -m "feat(export): use parent_id, total_pages, and created_at in export"
```

---

## Task 5: 更新 API 路由日志

**Files:**
- Modify: `deeppdf-api/src/deeppdf/api/routes_export.py:12-14`

**Step 1: 更新日志输出，包含新字段信息**

```python
@router.get("/export/{index_id}", response_model=ExportIndexResponse)
async def export_index_endpoint(index_id: str):
    """
    导出索引的节点数据,供前端生成 Markdown 文件

    返回所有节点的数据,包括文本内容、章节信息、页码范围等
    """
    logger.info(f"[API] 收到导出请求: index_id='{index_id}'")
    result = await export_index_data(index_id)
    logger.info(f"[API] 导出完成: 返回 {len(result.get('nodes', []))} 个节点, total_pages={result.get('total_pages', 0)}")
    return ExportIndexResponse(**result)
```

**Step 2: 运行类型检查验证**

Run: `uv run mypy deeppdf-api/src/deeppdf/api/routes_export.py`

Expected: No errors

**Step 3: 提交更改**

```bash
git add deeppdf-api/src/deppdf/api/routes_export.py
git commit -m "docs(export): update log output with new fields"
```

---

## Task 6: 编写导出 API 测试脚本

**Files:**
- Create: `scripts/test_export_api.py`

**Step 1: 创建测试脚本**

```python
"""
测试导出 API 功能
"""
import asyncio
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent / "deeppdf-api/src"))

from deeppdf.api.export_handlers import export_index_data
from deeppdf.services.indexer import _save_metadata


async def test_export_api():
    """测试完整的导出流程"""
    print("=== 测试导出 API ===\n")

    # 使用一个已存在的索引
    storage_dir = Path(__file__).parent.parent / "deeppdf-api/data"
    index_path = storage_dir / "indexes" / "idx_7995251fb87b.json"

    if not index_path.exists():
        print(f"⚠️  测试索引文件不存在: {index_path}")
        print("请先运行一个索引测试，或使用已有的索引")
        return

    # 提取 index_id
    index_id = index_path.stem.replace("idx_", "")
    print(f"测试索引: {index_id}")

    # 调用导出函数
    try:
        result = await export_index_data(index_id)

        print("\n✅ 导出成功!")
        print(f"  - status: {result['status']}")
        print(f"  - pdf_name: {result['pdf_name']}")
        print(f"  - total_pages: {result['total_pages']}")
        print(f"  - created_at: {result['created_at']}")
        print(f"  - nodes count: {len(result['nodes'])}")

        # 验证节点数据
        if result['nodes']:
            node = result['nodes'][0]
            print(f"\n第一个节点示例:")
            print(f"  - node_id: {node['node_id']}")
            print(f"  - section: {node['section']}")
            print(f"  - parent_id: {node.get('parent_id', 'None')}")
            print(f"  - has text: {bool(node['text'])}")

            # 验证 parent_id
            if node.get('level', 0) > 1 and node.get('parent_id'):
                print(f"\n✅ parent_id 正确 (level={node['level']}, parent={node['parent_id']})")
            elif node.get('level', 0) == 1:
                print(f"\n✅ 根节点 parent_id 为 None (正确)")

    except Exception as e:
        print(f"\n❌ 导出失败: {e}")


if __name__ == "__main__":
    asyncio.run(test_export_api())
```

**Step 2: 运行测试验证功能**

Run: `uv run python scripts/test_export_api.py`

Expected:
- 导出成功，显示所有新字段
- parent_id 正确匹配
- total_pages 正确读取 PDF 页数

**Step 3: 提交测试脚本**

```bash
git add scripts/test_export_api.py
git commit -m "test: add export API test script"
```

---

## Task 7: 运行完整测试套件验证

**Files:**
- Test: `scripts/test_export_api.py`

**Step 1: 确保服务正在运行**

Run:
```bash
curl -s http://localhost:6088/docs | head -5
```

Expected: 显示 API 文档标题

**Step 2: 运行测试脚本**

Run: `uv run python scripts/test_export_api.py`

Expected:
- 所有字段正确返回
- 无错误或异常

**Step 3: 手动 API 测试（可选）**

Run:
```bash
curl http://localhost:6088/api/export/idx_7995251fb87b
```

Expected: 返回完整的 JSON 响应，包含所有新字段

---

## Task 8: 更新 API 文档（如果需要）

**Files:**
- Modify: `deeppdf-api/README.md` 或相关文档

**Step 1: 添加导出 API 文档**

在 API 文档中添加：
- `/export/{index_id}` 端点说明
- 响应格式示例
- 新增字段说明

**Step 2: 提交文档**

```bash
git add deeppdf-api/README.md
git commit -m "docs: document export API with new fields"
```

---

## 测试验证清单

完成所有任务后，运行以下验证：

- [ ] 所有文件通过 mypy 类型检查
- [ ] API 返回正确的数据结构
- [ ] parent_id 正确匹配父子关系
- [ ] total_pages 正确返回 PDF 页数
- [ ] created_at 格式为 ISO 8601
- [ ] 404 错误正确处理索引不存在
- [ ] 500 错误正确处理异常

---

## 实施后状态

完成后，`GET /export/{index_id}` 将返回：

```json
{
  "status": "success",
  "index_id": "idx_xxx",
  "pdf_name": "sample.pdf",
  "total_pages": 150,
  "c_time": "2026-01-21T10:00:00Z",
  "nodes": [
    {
      "node_id": "node_1",
      "node_name": "Introduction",
      "section": "1 Introduction",
      "page_range": "1-5",
      "start_index": 1,
      "end_index": 5,
      "level": 1,
      "text": "<physical_index_1>...",
      "parent_id": null
    },
    {
      "node_id": "node_2",
      "node_name": "1.1 Background",
      "section": "1.1 Background",
      "page_range": "6-10",
      "start_index": 6,
      "end_index": 10,
      "level": 2,
      "text": "<physical_index_6>...",
      "parent_id": "node_1"
    }
  ]
}
```
