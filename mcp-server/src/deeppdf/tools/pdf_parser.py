import PyPDF2
from typing import List, Dict, Any
from pathlib import Path


class PDFParseError(Exception):
    """PDF 解析错误"""
    pass


class PDFParser:
    """PDF 文档解析器"""

    def extract_sections(self, pdf_path: str) -> List[Dict[str, Any]]:
        """
        从 PDF 提取章节结构

        Args:
            pdf_path: PDF 文件路径

        Returns:
            章节列表，每个章节包含文本和元数据

        Raises:
            PDFParseError: 解析失败时抛出
        """
        pdf_path = Path(pdf_path)

        if not pdf_path.exists():
            raise PDFParseError(f"File not found: {pdf_path}")

        try:
            with open(pdf_path, "rb") as f:
                pdf_reader = PyPDF2.PdfReader(f)

                # 检查是否加密
                if pdf_reader.is_encrypted:
                    raise PDFParseError("Encrypted PDFs are not supported")

                sections = []

                # 暂时按页分割（稍后集成 PageIndex 进行智能分段）
                for page_num, page in enumerate(pdf_reader.pages):
                    text = page.extract_text()

                    # 跳过空页
                    if not text or text.strip() == "":
                        continue

                    sections.append({
                        "text": text.strip(),
                        "metadata": {
                            "page": page_num + 1,
                            "total_pages": len(pdf_reader.pages)
                        }
                    })

                return sections

        except PyPDF2.errors.PdfReadError as e:
            raise PDFParseError(f"Failed to read PDF: {str(e)}")
        except Exception as e:
            raise PDFParseError(f"Unexpected error: {str(e)}")

    def extract_text_from_page(self, pdf_path: str, page_num: int) -> str:
        """
        从指定页面提取文本

        Args:
            pdf_path: PDF 文件路径
            page_num: 页码（从 0 开始）

        Returns:
            提取的文本
        """
        pdf_path = Path(pdf_path)

        if not pdf_path.exists():
            raise PDFParseError(f"File not found: {pdf_path}")

        try:
            with open(pdf_path, "rb") as f:
                pdf_reader = PyPDF2.PdfReader(f)
                page = pdf_reader.pages[page_num]
                return page.extract_text() or ""
        except PyPDF2.errors.PdfReadError as e:
            raise PDFParseError(f"Failed to read PDF: {str(e)}")
        except Exception as e:
            raise PDFParseError(f"Failed to extract text from page {page_num}: {str(e)}")
