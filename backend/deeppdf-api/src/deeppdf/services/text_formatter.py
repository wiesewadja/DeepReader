"""
文本格式化服务

对 PDF/EPUB 提取的原始文本进行清洗和格式化
"""

import re
import logging
from typing import List

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
        """
        合并软换行（句子中间的换行）

        规则：
        1. 当前行以小写字母开头 -> 合并到上一行
        2. 上一行以连字符结尾（非破折号）-> 合并
        3. 上一行以标点结尾（句号、问号、感叹号）-> 保留换行
        """
        lines = text.split("\n")
        result = []

        for i, line in enumerate(lines):
            stripped = line.strip()
            if not stripped:
                result.append("")
                continue

            if i > 0 and result:
                prev_line = result[-1] if result else ""
                should_merge = self._should_merge_lines(prev_line, stripped)

                if should_merge:
                    # 合并到上一行
                    if result:
                        # 如果上一行以连字符结尾，移除连字符
                        if prev_line.rstrip().endswith(
                            "-"
                        ) and not prev_line.rstrip().endswith("--"):
                            result[-1] = prev_line.rstrip()[:-1] + stripped
                        else:
                            result[-1] = prev_line + " " + stripped
                    continue

            result.append(stripped)

        return "\n".join(result)

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

        if not prev_stripped or not curr_stripped:
            return False

        # 上一行以句子结束符结尾 -> 不合并（新段落开始）
        if prev_stripped[-1] in ".!?。！？":
            return False

        # 当前行以小写字母开头 -> 需要合并（英文规则）
        if curr_stripped[0].islower():
            return True

        # 上一行以单个连字符结尾 -> 合并（断词处理）
        if prev_stripped.endswith("-") and not prev_stripped.endswith("--"):
            return True

        # 中文规则：如果上一行不是以句号结尾，且当前行不是明显的新段落开始
        # 检测段落开头的常见模式
        paragraph_start_patterns = [
            r'^第[一二三四五六七八九十百千万]+[章节篇部]',  # 第X章/节
            r'^\d+[\.、]\s',  # 1. 或 1、
            r'^[（(]\d+[)）]',  # (1) 或 （1）
            r'^[•·※]\s',  # 列表项
        ]
        for pattern in paragraph_start_patterns:
            if re.match(pattern, curr_stripped):
                return False

        # 如果上一行以逗号、分号等结尾，当前行应该合并
        if prev_stripped[-1] in ',，;；:：、':
            return True

        return False

    def _normalize_paragraphs(self, text: str) -> str:
        """
        规范化段落

        规则：
        1. 多个连续空行 -> 单个空行
        2. 保持段落间的分隔（双换行）
        3. 清理段落内的多余空白
        """
        # 先合并多余的空行
        text = re.sub(r"\n{3,}", "\n\n", text)

        # 分割为段落块（以双换行分隔）
        blocks = text.split("\n\n")
        result = []

        for block in blocks:
            # 清理块内的首尾空白
            block = block.strip()
            if not block:
                continue

            lines = block.split("\n")
            if not lines:
                continue

            # 检查是否为特殊块（列表、代码等）
            if self._is_list_block(lines):
                # 保持列表格式
                result.append("\n".join(line.strip() for line in lines))
            else:
                # 普通段落：保持内容不变（_merge_soft_line_breaks 已经处理过）
                # 只清理行首尾空白
                cleaned_lines = [line.strip() for line in lines if line.strip()]
                if cleaned_lines:
                    result.append("\n".join(cleaned_lines))

        return "\n\n".join(result)

    def _is_list_block(self, lines: List[str]) -> bool:
        """判断是否为列表块"""
        if not lines:
            return False

        list_patterns = [
            r"^\d+\.\s",  # 1. 2. 3.
            r"^[a-zA-Z]\.\s",  # a. b. c.
            r"^[-*+]\s",  # - * +
            r"^[•·]\s",  # 项目符号
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
        non_empty_lines = [line for line in lines if line.strip()]
        return list_count > len(non_empty_lines) / 2

    def _detect_headings(self, text: str) -> str:
        """
        检测并标记标题

        规则：
        1. 数字编号模式：1. 1.1 第1章 Chapter 1
        2. 全大写行（短行）
        3. 短行且后面紧跟段落
        """
        lines = text.split("\n")
        result = []

        # 标题模式
        heading_patterns = [
            (r"^第[一二三四五六七八九十百千万]+[章节篇部]", 1),  # 中文章节
            (r"^Chapter\s+\d+", 1),  # 英文章节
            (r"^\d+\.\s+[^\d]", 2),  # 数字编号 1. Title
            (r"^\d+\.\d+\s+", 3),  # 二级编号 1.1 Title
            (r"^\d+\.\d+\.\d+\s+", 4),  # 三级编号 1.1.1 Title
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
                result.append("#" * heading_level + " " + stripped)
            else:
                result.append(line)

        return "\n".join(result)

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
        text = text.replace("\u00a0", " ")
        text = text.replace("\u3000", " ")  # 中文全角空格

        # 制表符转空格
        text = text.replace("\t", " ")

        # 多个空格合并为一个
        text = re.sub(r" {2,}", " ", text)

        # 行尾空白
        lines = [line.rstrip() for line in text.split("\n")]
        text = "\n".join(lines)

        # 文件开头和结尾的空白
        text = text.strip()

        return text
