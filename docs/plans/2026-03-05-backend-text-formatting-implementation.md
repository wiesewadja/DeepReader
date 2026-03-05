# 后端文本格式化 - 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 优化后端对 PDF/EPUB 书籍章节内容的解析和排版，提升导出 Markdown 的可读性。

**Architecture:** 创建独立的文本格式化服务，在索引流程中调用；先进行规则预处理（换行合并、段落识别），可选使用 LLM 进行进一步格式化。

**Tech Stack:** Python 3.10+, FastAPI, html2text

---

## Phase 1: PDF 文本清洗

### Task 1.1: 创建文本格式化服务基础

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/services/text_formatter.py`

**Step 1: 创建 TextFormatter 类骨架**

```python
"""
文本格式化服务

对 PDF/EPUB 提取的原始文本进行清洗和格式化
"""

import re
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


class TextFormatter:
    """文本格式化器"""

    def __init__(self, use_llm: bool = False, llm_client=None):
        """
        初始化格式化器

        Args:
            use_llm: 是否使用 LLM 进行格式化
            llm_client: LLM 客户端（如果使用 LLM）
        """
        self.use_llm = use_llm
        self.llm_client = llm_client

    def format(self, text: str, doc_type: str = "pdf") -> str:
        """
        格式化文本

        Args:
            text: 原始文本
            doc_type: 文档类型 (pdf/epub)

        Returns:
            格式化后的文本
        """
        if not text or not text.strip():
            return text

        if doc_type == "pdf":
            return self._format_pdf(text)
        elif doc_type == "epub":
            return self._format_epub(text)
        else:
            return text

    def _format_pdf(self, text: str) -> str:
        """格式化 PDF 提取的文本"""
        # 1. 合并软换行
        text = self._merge_soft_line_breaks(text)

        # 2. 规范化段落
        text = self._normalize_paragraphs(text)

        # 3. 检测标题
        text = self._detect_headings(text)

        # 4. 清理多余空白
        text = self._clean_whitespace(text)

        return text

    def _format_epub(self, text: str) -> str:
        """格式化 EPUB 提取的文本"""
        # EPUB 已经通过 html2text 处理，主要做清理工作
        text = self._clean_whitespace(text)
        return text

    def _merge_soft_line_breaks(self, text: str) -> str:
        """合并软换行（句子中间的换行）"""
        # 由后续 Task 实现
        return text

    def _normalize_paragraphs(self, text: str) -> str:
        """规范化段落"""
        # 由后续 Task 实现
        return text

    def _detect_headings(self, text: str) -> str:
        """检测并标记标题"""
        # 由后续 Task 实现
        return text

    def _clean_whitespace(self, text: str) -> str:
        """清理多余空白"""
        # 由后续 Task 实现
        return text
```

**Step 2: 保存文件**

**Step 3: 验证语法**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run python -c "from deeppdf.services.text_formatter import TextFormatter; print('OK')"`
Expected: 输出 "OK"

---

### Task 1.2: 实现软换行合并

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/text_formatter.py`

**Step 1: 实现 _merge_soft_line_breaks 方法**

```python
def _merge_soft_line_breaks(self, text: str) -> str:
    """
    合并软换行（句子中间的换行）

    规则：
    1. 当前行以小写字母开头 -> 合并到上一行
    2. 上一行以连字符结尾（非破折号）-> 合并
    3. 上一行以标点结尾（句号、问号、感叹号）-> 保留换行
    """
    lines = text.split('\n')
    result = []

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            result.append('')
            continue

        if i > 0 and result:
            prev_line = result[-1] if result else ''
            should_merge = self._should_merge_lines(prev_line, stripped)

            if should_merge:
                # 合并到上一行
                if result:
                    # 如果上一行以连字符结尾，移除连字符
                    if prev_line.rstrip().endswith('-') and not prev_line.rstrip().endswith('--'):
                        result[-1] = prev_line.rstrip()[:-1] + stripped
                    else:
                        result[-1] = prev_line + ' ' + stripped
                continue

        result.append(stripped)

    return '\n'.join(result)


def _should_merge_lines(self, prev_line: str, curr_line: str) -> bool:
    """
    判断两行是否应该合并

    Args:
        prev_line: 上一行
        curr_line: 当前行

    Returns:
        是否应该合并
    """
    if not prev_line or not curr_line:
        return False

    prev_stripped = prev_line.rstrip()
    curr_stripped = curr_line.strip()

    # 当前行以小写字母开头 -> 可能需要合并
    if curr_stripped and curr_stripped[0].islower():
        # 但如果上一行以句子结束符结尾，不合并
        if prev_stripped and prev_stripped[-1] in '.!?。！？':
            return False
        return True

    # 上一行以单个连字符结尾 -> 合并（断词处理）
    if prev_stripped.endswith('-') and not prev_stripped.endswith('--'):
        return True

    return False
```

**Step 2: 验证功能**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run python -c "
from deeppdf.services.text_formatter import TextFormatter
f = TextFormatter()
text = '''This is a test
sentence that was split
across multiple lines.

This is a new paragraph.'''
result = f._merge_soft_line_breaks(text)
print('Result:')
print(result)
print('---')
assert 'This is a test sentence that was split across multiple lines.' in result
print('Test passed!')
"`
Expected: 输出 "Test passed!"

---

### Task 1.3: 实现段落规范化

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/text_formatter.py`

**Step 1: 实现 _normalize_paragraphs 方法**

```python
def _normalize_paragraphs(self, text: str) -> str:
    """
    规范化段落

    规则：
    1. 多个连续空行 -> 单个空行
    2. 识别段落边界（编号、缩进等）
    3. 段落内合并为连续文本
    """
    # 先合并多余的空行
    text = re.sub(r'\n{3,}', '\n\n', text)

    # 分割为段落块
    blocks = text.split('\n\n')
    result = []

    for block in blocks:
        lines = block.strip().split('\n')
        if not lines:
            continue

        # 检查是否为特殊块（列表、代码等）
        if self._is_list_block(lines):
            # 保持列表格式
            result.append('\n'.join(lines))
        else:
            # 合并为段落
            paragraph = ' '.join(line.strip() for line in lines if line.strip())
            if paragraph:
                result.append(paragraph)

    return '\n\n'.join(result)


def _is_list_block(self, lines: List[str]) -> bool:
    """判断是否为列表块"""
    if not lines:
        return False

    list_patterns = [
        r'^\d+\.\s',      # 1. 2. 3.
        r'^[a-zA-Z]\.\s', # a. b. c.
        r'^[-*+]\s',      # - * +
        r'^[•·]\s',       # 项目符号
    ]

    list_count = 0
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        for pattern in list_patterns:
            if re.match(pattern, stripped):
                list_count += 1
                break

    # 如果超过一半的行是列表项，认为是列表块
    return list_count > len([l for l in lines if l.strip()]) / 2
```

**Step 2: 验证功能**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run python -c "
from deeppdf.services.text_formatter import TextFormatter
f = TextFormatter()
text = '''First paragraph line 1
line 2
line 3.

Second paragraph here.'''
result = f._normalize_paragraphs(text)
print('Result:')
print(result)
print('---')
assert 'First paragraph line 1 line 2 line 3.' in result
print('Test passed!')
"`
Expected: 输出 "Test passed!"

---

### Task 1.4: 实现标题检测

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/text_formatter.py`

**Step 1: 实现 _detect_headings 方法**

```python
def _detect_headings(self, text: str) -> str:
    """
    检测并标记标题

    规则：
    1. 数字编号模式：1. 1.1 第1章 Chapter 1
    2. 全大写行（短行）
    3. 短行且后面紧跟段落
    """
    lines = text.split('\n')
    result = []

    # 标题模式
    heading_patterns = [
        (r'^第[一二三四五六七八九十百千万]+[章节篇部]', 1),  # 中文章节
        (r'^Chapter\s+\d+', 1),                             # 英文章节
        (r'^\d+\.\s+[^\d]', 2),                             # 数字编号 1. Title
        (r'^\d+\.\d+\s+', 3),                               # 二级编号 1.1 Title
        (r'^\d+\.\d+\.\d+\s+', 4),                          # 三级编号 1.1.1 Title
    ]

    for i, line in enumerate(lines):
        stripped = line.strip()

        if not stripped:
            result.append(line)
            continue

        heading_level = None

        # 检查标题模式
        for pattern, level in heading_patterns:
            if re.match(pattern, stripped, re.IGNORECASE):
                heading_level = level
                break

        # 检查全大写短行（可能是标题）
        if heading_level is None and len(stripped) < 50:
            # 检查是否全大写（忽略数字和标点）
            alpha_chars = [c for c in stripped if c.isalpha()]
            if alpha_chars and all(c.isupper() for c in alpha_chars):
                heading_level = 2

        if heading_level:
            # 添加 Markdown 标题标记
            result.append('#' * heading_level + ' ' + stripped)
        else:
            result.append(line)

    return '\n'.join(result)
```

**Step 2: 验证功能**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run python -c "
from deeppdf.services.text_formatter import TextFormatter
f = TextFormatter()
text = '''第一章 引言

这是正文内容。

1.1 背景

更多内容。'''
result = f._detect_headings(text)
print('Result:')
print(result)
print('---')
assert '# 第一章 引言' in result
assert '## 1.1 背景' in result
print('Test passed!')
"`
Expected: 输出 "Test passed!"

---

### Task 1.5: 实现空白清理

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/text_formatter.py`

**Step 1: 实现 _clean_whitespace 方法**

```python
def _clean_whitespace(self, text: str) -> str:
    """
    清理多余空白

    规则：
    1. 行尾空白 -> 删除
    2. 多个连续空格 -> 单个空格
    3. 制表符 -> 空格
    4. 不间断空格 -> 普通空格
    """
    # 替换不间断空格
    text = text.replace('\u00a0', ' ')
    text = text.replace('\u3000', ' ')  # 中文全角空格

    # 制表符转空格
    text = text.replace('\t', ' ')

    # 多个空格合并为一个
    text = re.sub(r' {2,}', ' ', text)

    # 行尾空白
    lines = [line.rstrip() for line in text.split('\n')]
    text = '\n'.join(lines)

    # 文件开头和结尾的空白
    text = text.strip()

    return text
```

**Step 2: 验证完整格式化流程**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run python -c "
from deeppdf.services.text_formatter import TextFormatter
f = TextFormatter()
text = '''第一章  引言

This is a test sentence that was
split across multiple lines due to
PDF extraction.

1.1  背景

更多内容在这里。'''
result = f.format(text, 'pdf')
print('Result:')
print(result)
print('---')
print('Test passed!')
"`
Expected: 输出格式化后的文本

---

### Task 1.6: 添加单元测试

**Files:**
- Create: `backend/deeppdf-api/tests/test_text_formatter.py`

**Step 1: 创建测试文件**

```python
"""
文本格式化服务测试
"""

import pytest
from deeppdf.services.text_formatter import TextFormatter


class TestTextFormatter:
    """TextFormatter 测试类"""

    def setup_method(self):
        self.formatter = TextFormatter()

    def test_merge_soft_line_breaks(self):
        """测试软换行合并"""
        text = "This is a test\nsentence split across\nlines."
        result = self.formatter._merge_soft_line_breaks(text)
        assert "This is a test sentence split across lines." in result

    def test_preserve_paragraph_breaks(self):
        """测试保留段落分隔"""
        text = "First paragraph.\n\nSecond paragraph."
        result = self.formatter._normalize_paragraphs(text)
        assert "First paragraph." in result
        assert "Second paragraph." in result

    def test_detect_chinese_heading(self):
        """测试中文章节标题检测"""
        text = "第一章 引言\n\n正文内容"
        result = self.formatter._detect_headings(text)
        assert "# 第一章 引言" in result

    def test_detect_numbered_heading(self):
        """测试数字编号标题检测"""
        text = "1.1 背景\n\n内容"
        result = self.formatter._detect_headings(text)
        assert "## 1.1 背景" in result

    def test_clean_whitespace(self):
        """测试空白清理"""
        text = "  多余空格  \n\n"
        result = self.formatter._clean_whitespace(text)
        assert result == "多余空格"

    def test_full_format_pdf(self):
        """测试完整 PDF 格式化"""
        text = """第一章 测试

This is a sentence that
was split across lines.

1.1 小节

More content here."""
        result = self.formatter.format(text, "pdf")
        assert "# 第一章 测试" in result
        assert "## 1.1 小节" in result
```

**Step 2: 运行测试**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run pytest tests/test_text_formatter.py -v`
Expected: 所有测试通过

**Step 3: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/services/text_formatter.py backend/deeppdf-api/tests/test_text_formatter.py
git commit -m "feat: 添加 PDF 文本格式化服务

- 软换行合并
- 段落规范化
- 标题检测
- 空白清理

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 2: EPUB HTML 增强解析

### Task 2.1: 增强 EPUB 解析配置

**Files:**
- Modify: `backend/pageindex-lib/src/pageindex/epub_parser.py`

**Step 1: 修改 _html_to_text 方法**

找到 `_html_to_text` 方法，修改 html2text 配置：

```python
def _html_to_text(self, html: str) -> str:
    """
    将 HTML 转换为 Markdown 格式文本

    增强版：保留更多语义信息
    """
    import html2text

    h = html2text.HTML2Text()
    h.ignore_links = False       # 保留链接
    h.ignore_images = True       # 忽略图片（避免大文件）
    h.ignore_emphasis = False    # 保留强调
    h.body_width = 0             # 不自动换行
    h.unicode_snob = True        # 使用 Unicode
    h.skip_internal_links = True # 跳过内部链接
    h.inline_links = True        # 内联链接
    h.protect_links = True       # 保护链接不被拆分

    markdown = h.handle(html)

    # 后处理：优化格式
    markdown = self._post_process_markdown(markdown)

    return markdown.strip()


def _post_process_markdown(self, markdown: str) -> str:
    """
    后处理 Markdown 内容

    优化 html2text 的输出
    """
    import re

    # 1. 清理多余空行
    markdown = re.sub(r'\n{3,}', '\n\n', markdown)

    # 2. 修复链接格式
    markdown = re.sub(r'\[([^\]]+)\]\(\s+', r'[\1](', markdown)
    markdown = re.sub(r'\s+\)', ')', markdown)

    # 3. 优化列表格式
    markdown = re.sub(r'^(\s*[-*+])\s+', r'\1 ', markdown, flags=re.MULTILINE)

    # 4. 优化引用块格式
    markdown = re.sub(r'^>\s*$', '', markdown, flags=re.MULTILINE)

    return markdown
```

**Step 2: 验证功能**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/pageindex-lib && uv run python -c "
from pageindex.epub_parser import EpubParser
# 简单测试 HTML 转换
parser = EpubParser.__new__(EpubParser)
html = '<h1>Title</h1><p>Paragraph with <strong>bold</strong> text.</p><ul><li>Item 1</li><li>Item 2</li></ul>'
result = parser._html_to_text(html)
print('Result:')
print(result)
print('---')
assert '**bold**' in result or '__bold__' in result
print('Test passed!')
"`
Expected: 输出包含格式化的 Markdown

**Step 3: 提交**

```bash
git add backend/pageindex-lib/src/pageindex/epub_parser.py
git commit -m "feat: 增强 EPUB HTML 解析

- 保留链接和强调格式
- 添加 Markdown 后处理
- 优化列表和引用块格式

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 3: 集成到索引流程

### Task 3.1: 在 indexer 中集成格式化服务

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/indexer.py`

**Step 1: 导入并初始化 TextFormatter**

在文件顶部添加：

```python
from .text_formatter import TextFormatter
```

在 `create_index` 函数中，找到节点文本处理的位置，添加格式化：

```python
# 在处理节点文本的地方
formatter = TextFormatter(use_llm=options.get('use_llm_formatting', False))

# 格式化节点文本
for node in section_nodes:
    if node.get('text'):
        node['text'] = formatter.format(node['text'], doc_type)
```

**Step 2: 添加配置参数**

在 API 路由中添加新参数：

```python
# 在 routes.py 的索引请求模型中
class IndexRequest(BaseModel):
    # ... 现有字段 ...
    use_llm_formatting: bool = False  # 是否使用 LLM 格式化
```

**Step 3: 验证集成**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run python -c "
from deeppdf.services.text_formatter import TextFormatter
# 验证导入正常
print('TextFormatter imported successfully')
"`
Expected: 输出成功信息

**Step 4: 提交**

```bash
git add backend/deeppdf-api/src/deeppdf/services/indexer.py backend/deeppdf-api/src/deeppdf/api/routes.py
git commit -m "feat: 集成文本格式化到索引流程

- 在索引时自动格式化节点文本
- 添加 use_llm_formatting 配置参数

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Phase 4: LLM 格式化（可选）

> 注：此阶段为可选增强，可在后续实现

### Task 4.1: 实现 LLM 格式化

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/services/text_formatter.py`

**Step 1: 添加 LLM 格式化方法**

```python
async def _llm_format(self, text: str) -> str:
    """
    使用 LLM 格式化文本

    Args:
        text: 原始文本

    Returns:
        格式化后的 Markdown
    """
    if not self.llm_client:
        logger.warning("LLM client not available, skipping LLM formatting")
        return text

    prompt = f"""你是一个文本格式化专家。请将以下从 PDF 提取的文本重新排版为结构清晰的 Markdown 格式。

要求：
1. 保持原文内容不变，只调整格式
2. 识别标题层级并使用 # ## ### 标记
3. 将段落合并为完整的句子
4. 识别列表并使用 - 或 1. 标记
5. 识别引用块并使用 > 标记
6. 不要添加任何解释或总结

原文：
{text}

请输出格式化后的 Markdown："""

    try:
        response = await self.llm_client.chat(prompt)
        return response.strip()
    except Exception as e:
        logger.error(f"LLM formatting failed: {e}")
        return text
```

**Step 2: 修改 format 方法支持异步**

```python
async def format_async(self, text: str, doc_type: str = "pdf") -> str:
    """
    异步格式化文本（支持 LLM）
    """
    if not text or not text.strip():
        return text

    # 规则预处理
    if doc_type == "pdf":
        text = self._format_pdf(text)
    elif doc_type == "epub":
        text = self._format_epub(text)

    # LLM 格式化（可选）
    if self.use_llm and len(text) > 500:
        text = await self._llm_format(text)

    return text
```

---

## 验收标准

- [ ] PDF 文本不再有断裂的句子
- [ ] 段落正确分隔
- [ ] 标题被正确识别和标记
- [ ] EPUB 保留列表、强调格式
- [ ] 多余空白被清理
- [ ] 单元测试全部通过
