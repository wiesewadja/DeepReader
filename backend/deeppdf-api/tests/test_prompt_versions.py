# tests/test_prompt_versions.py
"""测试 Prompt 版本切换功能"""
from deeppdf.agent.prompts import PromptBuilder


class TestPromptVersioning:
    """测试 Prompt 版本管理"""

    def test_v1_builder_uses_old_template(self):
        """测试 V1 版本使用旧模板"""
        builder = PromptBuilder(
            tool_descriptions="Test tools", enable_few_shot=False, version=1
        )
        prompt = builder.build()

        # V1 应该包含旧版本的特征内容
        assert "格式禁令" not in prompt  # V1 模板没有这个
        assert "结构化输出" in prompt  # V1 特有
        assert "使用列表、标题等方式清晰组织答案" in prompt

    def test_v2_builder_uses_core_rules(self):
        """测试 V2 版本使用核心规则"""
        builder = PromptBuilder(
            tool_descriptions="Test tools", enable_few_shot=False, version=2
        )
        prompt = builder.build()

        # V2 应该包含核心规则，但不包含旧版本的说教式内容
        assert "核心约束" in prompt
        assert "格式规范" in prompt
        assert "引用要求（强制）" in prompt  # 更新关键词
        assert "全面性" in prompt  # 新增的全面性要求
        assert "表达风格" in prompt
        assert "格式禁令" not in prompt

    def test_v2_includes_v2_examples(self):
        """测试 V2 版本包含 V2 示例"""
        builder = PromptBuilder(
            tool_descriptions="Test tools", enable_few_shot=True, version=2
        )
        prompt = builder.build()

        # V2 示例的特征内容
        assert "示例 1: 简单事实查询" in prompt
        assert "昭见森，iPhone 在" in prompt
        assert "示例 5: 格式对比" in prompt
        assert "错误示范（列表格式）" in prompt

    def test_v1_includes_v1_examples(self):
        """测试 V1 版本包含 V1 示例"""
        builder = PromptBuilder(
            tool_descriptions="Test tools", enable_few_shot=True, version=1
        )
        prompt = builder.build()

        # V1 示例的特征内容
        assert "示例 1: 简单事实查询" in prompt
        assert "我来快速检索这个问题" in prompt  # V1 特有

    def test_default_version_is_v2(self):
        """测试默认版本为 V2"""
        builder = PromptBuilder(tool_descriptions="Test tools", enable_few_shot=False)
        prompt = builder.build()

        # 默认应该使用 V2
        assert "核心约束" in prompt

    def test_disable_few_shot(self):
        """测试禁用 Few-Shot 示例"""
        builder_v1 = PromptBuilder(
            tool_descriptions="Test tools", enable_few_shot=False, version=1
        )
        builder_v2 = PromptBuilder(
            tool_descriptions="Test tools", enable_few_shot=False, version=2
        )

        prompt_v1 = builder_v1.build()
        prompt_v2 = builder_v2.build()

        # 禁用示例后不应该包含示例内容
        assert "示例对话" not in prompt_v1
        assert "示例对话" not in prompt_v2
