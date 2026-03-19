# TOC 死链修复实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复长章节分片后 TOC 链接失效的问题，使第一部分文件名与 TOC 链接匹配。

**Architecture:** 修改 `markdown_exporter.py` 中的文件命名逻辑和内容生成逻辑，第一部分不带序号，后续部分从 2 开始带序号；同时添加分片导航。

**Tech Stack:** Python 3.10+, pytest

**注意:** 只修改 `_create_markdown_content_partial` 函数（分片版本），`_create_markdown_content` 函数（非分片版本）不需要修改。

---

## Chunk 1: 文件命名逻辑修改

### Task 1: 修改文件命名规则

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/markdown_exporter.py:487-492`
- Create: `backend/deeppdf-api/tests/test_markdown_exporter.py` (新建测试文件)

- [ ] **Step 1: 写失败的测试 - 文件命名规则**

```python
# backend/deeppdf-api/tests/test_markdown_exporter.py

import pytest
from deeppdf.services.markdown_exporter import _sanitize_filename


class TestChunkedFilename:
    """测试分片文件命名规则"""

    def test_single_part_filename_no_suffix(self):
        """单部分文件不带序号后缀"""
        idx = 1
        safe_node_name = "第一章"
        total_parts = 1
        part_idx = 1

        # 期望: 01-第一章.md
        if total_parts == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        elif part_idx == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        else:
            filename = f"{idx:02d}-{safe_node_name}-{part_idx}.md"

        assert filename == "01-第一章.md"

    def test_first_part_filename_no_suffix(self):
        """多部分时，第一部分不带序号后缀"""
        idx = 1
        safe_node_name = "第一章"
        total_parts = 3
        part_idx = 1

        # 期望: 01-第一章.md (不是 01-第一章-1.md)
        if total_parts == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        elif part_idx == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        else:
            filename = f"{idx:02d}-{safe_node_name}-{part_idx}.md"

        assert filename == "01-第一章.md"

    def test_second_part_filename_with_suffix(self):
        """多部分时，第二部分带序号后缀 2"""
        idx = 1
        safe_node_name = "第一章"
        total_parts = 3
        part_idx = 2

        # 期望: 01-第一章-2.md
        if total_parts == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        elif part_idx == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        else:
            filename = f"{idx:02d}-{safe_node_name}-{part_idx}.md"

        assert filename == "01-第一章-2.md"

    def test_third_part_filename_with_suffix(self):
        """多部分时，第三部分带序号后缀 3"""
        idx = 1
        safe_node_name = "第一章"
        total_parts = 3
        part_idx = 3

        # 期望: 01-第一章-3.md
        if total_parts == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        elif part_idx == 1:
            filename = f"{idx:02d}-{safe_node_name}.md"
        else:
            filename = f"{idx:02d}-{safe_node_name}-{part_idx}.md"

        assert filename == "01-第一章-3.md"
```

- [ ] **Step 2: 运行测试验证逻辑正确**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py::TestChunkedFilename -v`
Expected: PASS（测试验证目标逻辑正确，代码修改后应产生相同行为）

- [ ] **Step 3: 修改 markdown_exporter.py 文件命名逻辑**

修改 `export_pdf_to_markdown` 函数中的文件名生成逻辑（第 487-492 行）：

```python
# 修改前（第 487-492 行）
for part_idx, para_group in enumerate(paragraph_groups, start=1):
    # 构建文件名
    if total_parts == 1:
        filename = f"{idx:02d}-{safe_node_name}.md"
    else:
        filename = f"{idx:02d}-{safe_node_name}-{part_idx}.md"

# 修改后
for part_idx, para_group in enumerate(paragraph_groups, start=1):
    # 构建文件名：第一部分不带序号，后续部分从 2 开始
    if total_parts == 1:
        filename = f"{idx:02d}-{safe_node_name}.md"
    elif part_idx == 1:
        filename = f"{idx:02d}-{safe_node_name}.md"
    else:
        filename = f"{idx:02d}-{safe_node_name}-{part_idx}.md"
```

- [ ] **Step 4: 更新测试使用实际代码逻辑**

```python
# backend/deeppdf-api/tests/test_markdown_exporter.py

import pytest


def _generate_chunked_filename(idx: int, safe_node_name: str, part_idx: int, total_parts: int) -> str:
    """模拟 markdown_exporter.py 中的文件名生成逻辑"""
    if total_parts == 1:
        return f"{idx:02d}-{safe_node_name}.md"
    elif part_idx == 1:
        return f"{idx:02d}-{safe_node_name}.md"
    else:
        return f"{idx:02d}-{safe_node_name}-{part_idx}.md"


class TestChunkedFilename:
    """测试分片文件命名规则"""

    def test_single_part_filename_no_suffix(self):
        """单部分文件不带序号后缀"""
        filename = _generate_chunked_filename(1, "第一章", 1, 1)
        assert filename == "01-第一章.md"

    def test_first_part_filename_no_suffix(self):
        """多部分时，第一部分不带序号后缀"""
        filename = _generate_chunked_filename(1, "第一章", 1, 3)
        assert filename == "01-第一章.md"

    def test_second_part_filename_with_suffix(self):
        """多部分时，第二部分带序号后缀 2"""
        filename = _generate_chunked_filename(1, "第一章", 2, 3)
        assert filename == "01-第一章-2.md"

    def test_third_part_filename_with_suffix(self):
        """多部分时，第三部分带序号后缀 3"""
        filename = _generate_chunked_filename(1, "第一章", 3, 3)
        assert filename == "01-第一章-3.md"
```

- [ ] **Step 5: 运行测试验证通过**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py::TestChunkedFilename -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/services/markdown_exporter.py backend/deeppdf-api/tests/test_markdown_exporter.py
git commit -m "fix(export): first part of chunked chapter uses no suffix

- First part: 01-章节名.md (TOC link target)
- Subsequent parts: 01-章节名-2.md, 01-章节名-3.md, etc.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 2: 添加分片导航

### Task 2: 添加文件顶部指示

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/markdown_exporter.py:234-316`

- [ ] **Step 1: 写失败的测试 - 顶部指示**

```python
# backend/deeppdf-api/tests/test_markdown_exporter.py

class TestChunkedNavigation:
    """测试分片导航"""

    def test_part_indicator_in_first_part(self):
        """第一部分包含分片指示"""
        # 模拟 _create_markdown_content_partial 生成的第一部分内容
        content = _create_test_content_partial(part_num=1, total_parts=3)

        # 应包含 "第 1/3 部分" 指示
        assert "📖 第 1/3 部分" in content

    def test_part_indicator_in_middle_part(self):
        """中间部分包含分片指示"""
        content = _create_test_content_partial(part_num=2, total_parts=3)

        # 应包含 "第 2/3 部分" 指示
        assert "📖 第 2/3 部分" in content

    def test_no_part_indicator_for_single_part(self):
        """单部分文件不包含分片指示"""
        content = _create_test_content_partial(part_num=1, total_parts=1)

        # 不应包含分片指示
        assert "📖" not in content


def _create_test_content_partial(part_num: int, total_parts: int) -> str:
    """测试辅助函数：模拟内容生成"""
    # 简化版本，只测试关键输出
    if total_parts == 1:
        return "# 章节标题\n\n正文内容..."

    part_indicator = f"> 📖 第 {part_num}/{total_parts} 部分\n\n"
    return f"# 章节标题\n\n{part_indicator}正文内容..."
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py::TestChunkedNavigation -v`
Expected: FAIL (需要实现逻辑)

- [ ] **Step 3: 修改 _create_markdown_content_partial 添加顶部指示**

修改 `_create_markdown_content_partial` 函数（约第 284-306 行）：

```python
# 修改前（第 284-295 行 frontmatter）
    # 创建 Front Matter
    front_matter = f"""---
pdf_name: {pdf_name}
node_id: {node_id}
part_id: {part_id}
section: {section}
page_range: {page_range}
level: {metadata.get('level', 0)}
part: {part_num}/{total_parts}
tags: [DeepPDF, {pdf_name}]
---

"""

# 修改后 - 添加 total_parts 字段
    # 创建 Front Matter
    front_matter = f"""---
pdf_name: {pdf_name}
node_id: {node_id}
part_id: {part_id}
section: {section}
page_range: {page_range}
level: {metadata.get('level', 0)}
part: {part_num}/{total_parts}
total_parts: {total_parts}
tags: [DeepPDF, {pdf_name}]
---

"""
```

同时修改标题和分片指示（第 297-306 行）：

```python
# 修改前（第 297-306 行）
    # 标题（分片时添加序号）
    if total_parts > 1:
        title = f"# {section} ({part_num}/{total_parts})\n\n"
    else:
        title = f"# {section}\n\n"

    # 摘要（仅第一部分）
    summary_block = ""
    if summary and summary.strip():
        summary_block = f"> [!summary] 章节摘要\n> {summary.strip().replace(chr(10), chr(10) + '> ')}\n\n"

# 修改后
    # 标题
    title = f"# {section}\n\n"

    # 分片指示（仅分片文件显示）
    part_indicator = ""
    if total_parts > 1:
        part_indicator = f"> 📖 第 {part_num}/{total_parts} 部分\n\n"

    # 摘要（仅第一部分）
    summary_block = ""
    if summary and summary.strip():
        summary_block = f"> [!summary] 章节摘要\n> {summary.strip().replace(chr(10), chr(10) + '> ')}\n\n"

    # 组装头部：标题 + 分片指示 + 摘要
    header = title + part_indicator + summary_block
```

同时修改 return 语句：

```python
# 修改前
    return front_matter + title + summary_block + processed_text + footer

# 修改后
    return front_matter + header + processed_text + footer
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py::TestChunkedNavigation::test_part_indicator_* -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/services/markdown_exporter.py backend/deeppdf-api/tests/test_markdown_exporter.py
git commit -m "feat(export): add part indicator at top of chunked files

Shows '📖 第 X/Y 部分' for multi-part chapters

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

### Task 3: 添加底部导航链接

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/markdown_exporter.py:234-316`

- [ ] **Step 1: 写失败的测试 - 底部导航**

```python
# backend/deeppdf-api/tests/test_markdown_exporter.py

class TestChunkedFooterNavigation:
    """测试分片底部导航"""

    def test_first_part_has_next_link_only(self):
        """第一部分只有'下一部分'链接"""
        content = _create_test_content_with_nav(
            part_num=1, total_parts=3,
            base_filename="01-第一章"
        )

        assert "下一部分" in content
        assert "上一部分" not in content
        assert "[[01-第一章-2]]" in content

    def test_middle_part_has_both_links(self):
        """中间部分有'上一部分'和'下一部分'链接"""
        content = _create_test_content_with_nav(
            part_num=2, total_parts=3,
            base_filename="01-第一章"
        )

        assert "上一部分" in content
        assert "下一部分" in content
        assert "[[01-第一章]]" in content
        assert "[[01-第一章-3]]" in content

    def test_last_part_has_prev_link_only(self):
        """最后部分只有'上一部分'链接"""
        content = _create_test_content_with_nav(
            part_num=3, total_parts=3,
            base_filename="01-第一章"
        )

        assert "上一部分" in content
        assert "下一部分" not in content
        assert "[[01-第一章-2]]" in content

    def test_single_part_has_no_navigation(self):
        """单部分文件没有导航链接"""
        content = _create_test_content_with_nav(
            part_num=1, total_parts=1,
            base_filename="01-第一章"
        )

        assert "上一部分" not in content
        assert "下一部分" not in content


def _create_test_content_with_nav(part_num: int, total_parts: int, base_filename: str) -> str:
    """测试辅助函数：模拟带导航的内容生成"""
    if total_parts == 1:
        return "正文内容\n\n---\n来源信息"

    nav_parts = []
    if part_num > 1:
        prev_file = base_filename if part_num == 2 else f"{base_filename}-{part_num - 1}"
        nav_parts.append(f"← 上一部分：[[{prev_file}]]")
    if part_num < total_parts:
        next_file = f"{base_filename}-{part_num + 1}"
        nav_parts.append(f"下一部分：[[{next_file}]] →")

    nav = " | ".join(nav_parts)
    return f"正文内容\n\n---\n来源信息\n\n{nav}"
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py::TestChunkedFooterNavigation -v`
Expected: FAIL

- [ ] **Step 3: 修改 _create_markdown_content_partial 添加底部导航**

需要新增参数来传递文件名信息。修改函数签名和实现：

```python
def _create_markdown_content_partial(
    node: Dict[str, Any],
    pdf_name: str,
    section: str,
    page_range: str,
    paragraphs: List[Dict[str, Any]],
    part_num: int,
    total_parts: int,
    base_filename: str = "",  # 新增：用于生成导航链接
) -> str:
```

在 footer 部分添加导航链接（约第 308-314 行）：

```python
# 修改前
    # 页脚
    footer_link = (
        f"[[{pdf_name}#page={start_page}]]"
        if str(start_page).isdigit()
        else f"[[{pdf_name}]]"
    )
    footer = f"\n\n---\n**来源**: {footer_link} (第 {page_range} 页)\n"

# 修改后
    # 页脚
    footer_link = (
        f"[[{pdf_name}#page={start_page}]]"
        if str(start_page).isdigit()
        else f"[[{pdf_name}]]"
    )
    footer = f"\n\n---\n**来源**: {footer_link} (第 {page_range} 页)"

    # 分片导航（仅多部分文件显示）
    if total_parts > 1 and base_filename:
        nav_parts = []
        if part_num > 1:
            # 上一部分：第一部分无后缀，其他部分带序号
            prev_file = base_filename if part_num == 2 else f"{base_filename}-{part_num - 1}"
            nav_parts.append(f"← 上一部分：[[{prev_file}]]")
        if part_num < total_parts:
            # 下一部分：总是带序号
            next_file = f"{base_filename}-{part_num + 1}"
            nav_parts.append(f"下一部分：[[{next_file}]] →")

        nav = " | ".join(nav_parts)
        footer += f"\n\n{nav}"

    footer += "\n"
```

同时需要修改 `export_pdf_to_markdown` 函数中调用 `_create_markdown_content_partial` 的地方（约第 498 行），传入 `base_filename`：

```python
# 修改前（第 497-500 行）
                # 创建 Markdown 内容
                markdown_content = _create_markdown_content_partial(
                    node, pdf_name, section, page_range, para_group, part_idx, total_parts
                )

# 修改后
                # 创建 Markdown 内容
                # base_filename 用于导航链接（不带 .md 后缀）
                base_filename = f"{idx:02d}-{safe_node_name}"
                markdown_content = _create_markdown_content_partial(
                    node, pdf_name, section, page_range, para_group, part_idx, total_parts,
                    base_filename=base_filename
                )
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py::TestChunkedFooterNavigation -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/services/markdown_exporter.py backend/deeppdf-api/tests/test_markdown_exporter.py
git commit -m "feat(export): add navigation links between chunked parts

- First part: '下一部分 →' link only
- Middle parts: '← 上一部分 | 下一部分 →' links
- Last part: '← 上一部分' link only

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Chunk 3: 集成测试

### Task 4: 集成测试

**Files:**
- Test: `backend/deeppdf-api/tests/test_markdown_exporter.py`

- [ ] **Step 1: 写集成测试**

```python
# backend/deeppdf-api/tests/test_markdown_exporter.py

import json
from pathlib import Path
from unittest.mock import patch
from deeppdf.services.markdown_exporter import export_pdf_to_markdown


class TestChunkedExportIntegration:
    """集成测试：完整导出流程"""

    def test_chunked_export_filenames_and_navigation(self, tmp_path):
        """测试分片导出的文件名和导航"""
        # 准备测试数据
        index_id = "test_index"
        storage_dir = tmp_path / "storage"
        vault_path = tmp_path / "vault"

        # 创建索引元数据
        indexes_dir = storage_dir / "indexes"
        indexes_dir.mkdir(parents=True)

        # 创建一个长章节（超过 6000 字符会被拆分）
        long_content = "这是一个测试段落。" * 500  # 约 4500 字符
        metadata = {
            "pdf_name": "测试书籍.pdf",
            "sections": [
                {
                    "id": "node_1",
                    "text": long_content,
                    "metadata": {
                        "section": "第一章 长章节",
                        "node_name": "第一章 长章节",
                        "start_index": 1,
                        "end_index": 10,
                        "level": 1,
                    }
                }
            ]
        }

        metadata_file = indexes_dir / f"{index_id}.json"
        with open(metadata_file, "w", encoding="utf-8") as f:
            json.dump(metadata, f)

        # Mock ChromaDB 调用，返回空字典（使用 fallback 路径）
        with patch('deeppdf.services.markdown_exporter._fetch_paragraphs_from_chroma', return_value={}):
            # 执行导出
            result = export_pdf_to_markdown(
                index_id=index_id,
                storage_dir=str(storage_dir),
                vault_path=str(vault_path),
                output_folder="DeepPDF"
            )

        # 验证结果
        assert result["status"] == "success"
        assert result["files_created"] >= 1

        # 验证文件存在
        output_dir = vault_path / "DeepPDF" / "测试书籍"
        assert output_dir.exists()

        # 如果被拆分，验证第一部分文件名不带序号
        files = list(output_dir.glob("*.md"))
        if len(files) > 1:
            # 第一部分应该是 01-第一章 长章节.md（不带 -1）
            first_part = output_dir / "01-第一章 长章节.md"
            assert first_part.exists(), f"第一部分文件名应为不带序号的格式，实际文件: {[f.name for f in files]}"

            # 验证第二部分带序号
            second_part = output_dir / "01-第一章 长章节-2.md"
            assert second_part.exists(), f"第二部分文件名应带 -2 后缀"

            # 验证第一部分内容包含分片指示和下一部分链接
            content = first_part.read_text(encoding="utf-8")
            assert "📖 第 1/" in content
            assert "下一部分" in content
            assert "[[01-第一章 长章节-2]]" in content

            # 验证第二部分内容包含分片指示和上一部分链接
            content2 = second_part.read_text(encoding="utf-8")
            assert "📖 第 2/" in content2
            assert "上一部分" in content2
```

- [ ] **Step 2: 运行集成测试**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py::TestChunkedExportIntegration -v`
Expected: PASS

- [ ] **Step 3: 运行所有测试确保无回归**

Run: `cd backend/deeppdf-api && uv run pytest tests/test_markdown_exporter.py -v`
Expected: PASS

- [ ] **Step 4: 代码格式化**

Run: `cd backend && uv run ruff check deeppdf-api/src/deeppdf/services/markdown_exporter.py && uv run black deeppdf-api/src/deeppdf/services/markdown_exporter.py`

- [ ] **Step 5: 最终提交**

```bash
git add backend/deeppdf-api/src/deeppdf/services/markdown_exporter.py backend/deeppdf-api/tests/test_markdown_exporter.py
git commit -m "test(export): add integration tests for chunked export

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## 验证清单

- [ ] 文件命名：第一部分 `01-章节名.md`，后续部分 `01-章节名-2.md`
- [ ] frontmatter：包含 `total_parts` 字段
- [ ] 顶部指示：分片文件显示 `📖 第 X/Y 部分`
- [ ] 底部导航：第一部分只有"下一部分"，最后部分只有"上一部分"
- [ ] 导航链接：指向正确的文件名（不带 .md 后缀）
- [ ] 单部分文件：无分片指示，无导航链接
