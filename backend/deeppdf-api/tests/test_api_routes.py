"""
API 路由测试 - Agent 引用功能

测试 Agent API 返回结构化引用数据
"""

import pytest
from fastapi.testclient import TestClient
from deeppdf.main import app
from deeppdf.api.models import CitationInfo


@pytest.fixture
def client():
    """创建测试客户端"""
    return TestClient(app)


class TestCitationExtraction:
    """测试引用提取功能"""

    def test_extract_citations_basic(self):
        """测试基本引用提取"""
        from deeppdf.api.routes import _extract_citations_from_answer

        answer = "根据 [[document.md#^page-5]] 的内容，答案是..."
        citations = _extract_citations_from_answer(answer, "test_index")

        assert len(citations) == 1
        assert citations[0].obsidian_link == "[[document.md#^page-5]]"
        assert citations[0].page == 5
        assert citations[0].anchor == "^page-5"

    def test_extract_citations_multiple(self):
        """测试提取多个引用"""
        from deeppdf.api.routes import _extract_citations_from_answer

        answer = """
        参考 [[file1.md#^page-10]] 和 [[file2.md#^page-20]] 的内容，
        以及 [[file3.md]] 的说明。
        """
        citations = _extract_citations_from_answer(answer, "test_index")

        assert len(citations) == 3
        assert citations[0].obsidian_link == "[[file1.md#^page-10]]"
        assert citations[0].page == 10
        assert citations[1].obsidian_link == "[[file2.md#^page-20]]"
        assert citations[1].page == 20
        assert citations[2].obsidian_link == "[[file3.md]]"
        assert citations[2].page is None

    def test_extract_citations_deduplication(self):
        """测试引用去重"""
        from deeppdf.api.routes import _extract_citations_from_answer

        answer = """
        参考 [[file1.md#^page-10]] 的内容，
        再次参考 [[file1.md#^page-10]]，
        还有 [[file1.md#^page-10]]。
        """
        citations = _extract_citations_from_answer(answer, "test_index")

        # 相同的引用应该被去重
        assert len(citations) == 1
        assert citations[0].obsidian_link == "[[file1.md#^page-10]]"

    def test_extract_citations_no_links(self):
        """测试没有链接的情况"""
        from deeppdf.api.routes import _extract_citations_from_answer

        answer = "这是一个普通的回答，没有任何链接。"
        citations = _extract_citations_from_answer(answer, "test_index")

        assert len(citations) == 0

    def test_extract_citations_mixed_formats(self):
        """测试混合格式的链接"""
        from deeppdf.api.routes import _extract_citations_from_answer

        answer = """
        参考 [[path/to/file.md#^page-42]] 和
        [[simple.md]] 以及
        [[nested/path/file.md#^page-99]]。
        """
        citations = _extract_citations_from_answer(answer, "test_index")

        assert len(citations) == 3
        assert citations[0].obsidian_link == "[[path/to/file.md#^page-42]]"
        assert citations[0].page == 42
        assert citations[1].obsidian_link == "[[simple.md]]"
        assert citations[1].page is None
        assert citations[2].obsidian_link == "[[nested/path/file.md#^page-99]]"
        assert citations[2].page == 99


class TestCitationInfoModel:
    """测试 CitationInfo 模型"""

    def test_citation_info_with_page(self):
        """测试带页码的引用信息"""
        citation = CitationInfo(
            node_id="test_node",
            obsidian_link="[[file.md#^page-5]]",
            page=5,
            anchor="^page-5",
        )

        assert citation.node_id == "test_node"
        assert citation.obsidian_link == "[[file.md#^page-5]]"
        assert citation.page == 5
        assert citation.anchor == "^page-5"

    def test_citation_info_without_page(self):
        """测试不带页码的引用信息"""
        citation = CitationInfo(
            node_id="test_node",
            obsidian_link="[[file.md]]",
            page=None,
            anchor="",
        )

        assert citation.node_id == "test_node"
        assert citation.obsidian_link == "[[file.md]]"
        assert citation.page is None
        assert citation.anchor == ""

    def test_citation_info_serialization(self):
        """测试引用信息的序列化"""
        citation = CitationInfo(
            node_id="test_node",
            obsidian_link="[[file.md#^page-5]]",
            page=5,
            anchor="^page-5",
        )

        # 测试 model_dump() 方法
        data = citation.model_dump()
        assert data["node_id"] == "test_node"
        assert data["obsidian_link"] == "[[file.md#^page-5]]"
        assert data["page"] == 5
        assert data["anchor"] == "^page-5"


class TestAgentAPIWithCitations:
    """测试 Agent API 的引用功能"""

    def test_agent_request_default_include_citations(self):
        """测试 AgentRequest 默认 include_citations=False"""
        from deeppdf.api.models import AgentRequest

        req = AgentRequest(query="test query", index_id="test_id")
        assert req.include_citations is False

    def test_agent_request_with_include_citations(self):
        """测试 AgentRequest 设置 include_citations=True"""
        from deeppdf.api.models import AgentRequest

        req = AgentRequest(
            query="test query", index_id="test_id", include_citations=True
        )
        assert req.include_citations is True


class TestAgentResponseWithCitations:
    """测试 AgentResponseWithCitations 模型"""

    def test_response_with_citations(self):
        """测试带引用的响应"""
        from deeppdf.api.models import AgentResponseWithCitations

        citations = [
            CitationInfo(
                node_id="node1",
                obsidian_link="[[file1.md#^page-10]]",
                page=10,
                anchor="^page-10",
            ),
            CitationInfo(
                node_id="node2", obsidian_link="[[file2.md]]", page=None, anchor=""
            ),
        ]

        response = AgentResponseWithCitations(
            status="success",
            answer="这是回答",
            iterations=2,
            citations=citations,
        )

        assert response.status == "success"
        assert response.answer == "这是回答"
        assert response.iterations == 2
        assert len(response.citations) == 2
        assert response.citations[0].obsidian_link == "[[file1.md#^page-10]]"

    def test_response_without_citations(self):
        """测试不带引用的响应"""
        from deeppdf.api.models import AgentResponseWithCitations

        response = AgentResponseWithCitations(
            status="success", answer="这是回答", iterations=1, citations=None
        )

        assert response.status == "success"
        assert response.citations is None

    def test_response_error_with_citations(self):
        """测试错误响应（带引用模型）"""
        from deeppdf.api.models import AgentResponseWithCitations

        response = AgentResponseWithCitations(
            status="error", error="执行失败", iterations=None, citations=None
        )

        assert response.status == "error"
        assert response.error == "执行失败"


class TestBackwardCompatibility:
    """测试向后兼容性"""

    def test_agent_response_without_citations_field(self):
        """测试旧的 AgentResponse 模型仍然可用"""
        from deeppdf.api.models import AgentResponse

        response = AgentResponse(status="success", answer="回答", iterations=1)

        assert response.status == "success"
        assert response.answer == "回答"
        assert not hasattr(response, "citations") or response.citations is None

    def test_citations_field_optional(self):
        """测试引用字段是可选的"""
        from deeppdf.api.models import AgentResponseWithCitations

        # 不提供 citations 字段
        response = AgentResponseWithCitations(
            status="success", answer="回答"
        )  # type: ignore

        assert response.status == "success"
        assert response.citations is None
