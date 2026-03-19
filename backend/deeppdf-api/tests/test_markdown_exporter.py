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


def _create_test_content_partial(part_num: int, total_parts: int) -> str:
    """测试辅助函数：模拟内容生成"""
    if total_parts == 1:
        return "# 章节标题\n\n正文内容..."

    part_indicator = f"> 📖 第 {part_num}/{total_parts} 部分\n\n"
    return f"# 章节标题\n\n{part_indicator}正文内容..."


class TestChunkedNavigation:
    """测试分片导航"""

    def test_part_indicator_in_first_part(self):
        """第一部分包含分片指示"""
        content = _create_test_content_partial(part_num=1, total_parts=3)
        assert "📖 第 1/3 部分" in content

    def test_part_indicator_in_middle_part(self):
        """中间部分包含分片指示"""
        content = _create_test_content_partial(part_num=2, total_parts=3)
        assert "📖 第 2/3 部分" in content

    def test_no_part_indicator_for_single_part(self):
        """单部分文件不包含分片指示"""
        content = _create_test_content_partial(part_num=1, total_parts=1)
        assert "📖" not in content


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
