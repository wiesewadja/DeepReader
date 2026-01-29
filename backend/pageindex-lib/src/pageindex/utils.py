"""
PageIndex 工具函数模块

本模块包含 PageIndex 处理过程中使用的辅助函数。
这些函数尚未迁移到专门的子模块中。

主要功能:
    - PDF 文本提取
    - 页码转换
    - 结构处理
    - 摘要生成
    - 日志工具

注意:
    本模块中的某些函数可能会在未来版本中迁移到专门的子模块中。
    如果有对应的新模块函数，建议优先使用新模块中的实现。

作者: DeepPDF Team
创建时间: 2026-01-16
"""

import asyncio
import json
import logging
import os
import pypdf
import re
from datetime import datetime
from io import BytesIO
from types import SimpleNamespace as config

import yaml

logger = logging.getLogger(__name__)


# ============================================================
# PDF 文本提取
# ============================================================

def get_text_of_pdf_pages(pdf_pages, start_page, end_page):
    """
    从已解析的页面列表中提取文本

    参数:
        pdf_pages: 页面列表，格式为 [(page_text, token_count), ...]
        start_page: 起始页码 (从 1 开始)
        end_page: 结束页码

    返回:
        指定页面的文本内容

    使用示例:
        >>> pages = [("页面1文本", 100), ("页面2文本", 150)]
        >>> text = get_text_of_pdf_pages(pages, 1, 2)
        >>> print(text)
        "页面1文本页面2文本"
    """
    text = ""
    for page_num in range(start_page - 1, end_page):
        text += pdf_pages[page_num][0]
    return text


def get_text_of_pdf_pages_with_labels(pdf_pages, start_page, end_page):
    """
    从已解析的页面列表中提取带标记的文本

    标记格式: <physical_index_N>页面内容<physical_index_N>

    参数:
        pdf_pages: 页面列表
        start_page: 起始页码 (从 1 开始)
        end_page: 结束页码

    返回:
        带物理索引标记的文本

    使用示例:
        >>> pages = [("页面1文本", 100)]
        >>> text = get_text_of_pdf_pages_with_labels(pages, 1, 1)
        >>> print(text)
        "<physical_index_1>\\n页面1文本\\n<physical_index_1>"
    """
    text = ""
    for page_num in range(start_page - 1, end_page):
        text += f"<physical_index_{page_num + 1}>\n{pdf_pages[page_num][0]}\n<physical_index_{page_num + 1}>\n"
    return text


def get_pdf_name(pdf_path):
    """
    获取 PDF 文件名

    参数:
        pdf_path: PDF 文件路径或 BytesIO 对象

    返回:
        PDF 文件名

    使用示例:
        >>> name = get_pdf_name("/path/to/document.pdf")
        >>> print(name)
        "document.pdf"
    """
    # Extract PDF name
    if isinstance(pdf_path, str):
        pdf_name = os.path.basename(pdf_path)
    elif isinstance(pdf_path, BytesIO):
        pdf_reader = pypdf.PdfReader(pdf_path)
        meta = pdf_reader.metadata
        pdf_name = meta.title if meta and meta.title else "Untitled"
        pdf_name = sanitize_filename(pdf_name)
    return pdf_name


def get_pdf_title(pdf_path):
    """
    获取 PDF 标题

    参数:
        pdf_path: PDF 文件路径

    返回:
        PDF 标题

    使用示例:
        >>> title = get_pdf_title("document.pdf")
        >>> print(title)
        "Document Title"
    """
    pdf_reader = pypdf.PdfReader(pdf_path)
    meta = pdf_reader.metadata
    title = meta.title if meta and meta.title else "Untitled"
    return title


def get_number_of_pages(pdf_path):
    """
    获取 PDF 页数

    参数:
        pdf_path: PDF 文件路径

    返回:
        PDF 总页数

    使用示例:
        >>> num = get_number_of_pages("document.pdf")
        >>> print(f"共 {num} 页")
    """
    pdf_reader = pypdf.PdfReader(pdf_path)
    num = len(pdf_reader.pages)
    return num


# ============================================================
# 文本解析工具
# ============================================================

def get_first_start_page_from_text(text):
    """
    从文本中提取第一个起始页码

    参数:
        text: 包含 <start_index_N> 标记的文本

    返回:
        第一个起始页码，如果未找到返回 -1

    使用示例:
        >>> text = "<start_index_5>内容<start_index_10>"
        >>> page = get_first_start_page_from_text(text)
        >>> print(page)
        5
    """
    start_page = -1
    start_page_match = re.search(r"<start_index_(\d+)>", text)
    if start_page_match:
        start_page = int(start_page_match.group(1))
    return start_page


def get_last_start_page_from_text(text):
    """
    从文本中提取最后一个起始页码

    参数:
        text: 包含 <start_index_N> 标记的文本

    返回:
        最后一个起始页码，如果未找到返回 -1

    使用示例:
        >>> text = "<start_index_5>内容<start_index_10>"
        >>> page = get_last_start_page_from_text(text)
        >>> print(page)
        10
    """
    start_page = -1
    # Find all matches of start_index tags
    start_page_matches = re.finditer(r"<start_index_(\d+)>", text)
    # Convert iterator to list and get the last match if any exist
    matches_list = list(start_page_matches)
    if matches_list:
        start_page = int(matches_list[-1].group(1))
    return start_page


def sanitize_filename(filename, replacement="-"):
    """
    清理文件名，替换非法字符

    参数:
        filename: 原始文件名
        replacement: 替换字符 (默认 "-")

    返回:
        清理后的文件名

    使用示例:
        >>> clean = sanitize_filename("file/name.pdf")
        >>> print(clean)
        "file-name.pdf"
    """
    # In Linux, only '/' and '\0' (null) are invalid in filenames.
    # Null can't be represented in strings, so we only handle '/'.
    return filename.replace("/", replacement)


# ============================================================
# 页码转换
# ============================================================

def convert_physical_index_to_int(data):
    """
    将物理索引字符串转换为整数

    支持格式:
        - "<physical_index_5>" → 5
        - "physical_index_5" → 5

    参数:
        data: 数据 (list, str 或其他)

    返回:
        转换后的数据

    使用示例:
        >>> data = [{"physical_index": "<physical_index_5>"}]
        >>> result = convert_physical_index_to_int(data)
        >>> print(result[0]["physical_index"])
        5
    """
    if isinstance(data, list):
        for i in range(len(data)):
            # Check if item is a dictionary and has 'physical_index' key
            if isinstance(data[i], dict) and "physical_index" in data[i]:
                if isinstance(data[i]["physical_index"], str):
                    if data[i]["physical_index"].startswith("<physical_index_"):
                        data[i]["physical_index"] = int(
                            data[i]["physical_index"].split("_")[-1].rstrip(">").strip()
                        )
                    elif data[i]["physical_index"].startswith("physical_index_"):
                        data[i]["physical_index"] = int(
                            data[i]["physical_index"].split("_")[-1].strip()
                        )
    elif isinstance(data, str):
        if data.startswith("<physical_index_"):
            data = int(data.split("_")[-1].rstrip(">").strip())
        elif data.startswith("physical_index_"):
            data = int(data.split("_")[-1].strip())
        # Check data is int
        if isinstance(data, int):
            return data
        else:
            return None
    return data


def convert_page_to_int(data):
    """
    将页码字符串转换为整数

    参数:
        data: 数据列表，每个项包含 "page" 字段

    返回:
        转换后的数据

    使用示例:
        >>> data = [{"page": "1"}, {"page": "2"}]
        >>> result = convert_page_to_int(data)
        >>> print(result[0]["page"])
        1
    """
    for item in data:
        if "page" in item and isinstance(item["page"], str):
            try:
                item["page"] = int(item["page"])
            except ValueError:
                # Keep original value if conversion fails
                pass
    return data


# ============================================================
# 结构处理
# ============================================================

def add_preface_if_needed(data):
    """
    如果需要，添加前言节点

    如果第一个章节的物理索引大于 1，则在开头添加前言节点。

    参数:
        data: 扁平的结构列表

    返回:
        可能包含前言节点的结构列表

    使用示例:
        >>> data = [{"physical_index": 3, "title": "第一章"}]
        >>> result = add_preface_if_needed(data)
        >>> print(result[0]["title"])
        "Preface"
    """
    if not isinstance(data, list) or not data:
        return data

    if data[0]["physical_index"] is not None and data[0]["physical_index"] > 1:
        preface_node = {
            "structure": "0",
            "title": "Preface",
            "physical_index": 1,
        }
        data.insert(0, preface_node)
    return data


def post_processing(structure, end_physical_index):
    """
    后处理结构，转换页码并构建树

    参数:
        structure: 扁平的结构列表
        end_physical_index: 结束物理索引

    返回:
        处理后的结构 (树状或扁平)

    使用示例:
        >>> flat = [
        ...     {"physical_index": 1, "title": "第一章", "appear_start": "yes"},
        ...     {"physical_index": 5, "title": "第二章"}
        ... ]
        >>> tree = post_processing(flat, 10)
    """
    # 导入 list_to_tree 从新模块
    from .structure.tree import list_to_tree

    # First convert page_number to start_index in flat list
    for i, item in enumerate(structure):
        item["start_index"] = item.get("physical_index")
        if i < len(structure) - 1:
            if structure[i + 1].get("appear_start") == "yes":
                item["end_index"] = structure[i + 1]["physical_index"] - 1
            else:
                item["end_index"] = structure[i + 1]["physical_index"]
        else:
            item["end_index"] = end_physical_index
    tree = list_to_tree(structure)
    if len(tree) != 0:
        return tree
    else:
        ### remove appear_start
        for node in structure:
            node.pop("appear_start", None)
            node.pop("physical_index", None)
        return structure


def clean_structure_post(data):
    """
    清理结构，移除特定字段

    参数:
        data: 树状结构

    返回:
        清理后的结构

    使用示例:
        >>> clean = clean_structure_post(tree)
    """
    if isinstance(data, dict):
        data.pop("page_number", None)
        data.pop("start_index", None)
        data.pop("end_index", None)
        if "nodes" in data:
            clean_structure_post(data["nodes"])
    elif isinstance(data, list):
        for section in data:
            clean_structure_post(section)
    return data


def remove_fields(data, fields=["text"]):
    """
    递归移除结构中的指定字段

    参数:
        data: 树状结构
        fields: 要移除的字段列表

    返回:
        移除指定字段后的结构

    使用示例:
        >>> clean = remove_fields(tree, fields=["text", "summary"])
    """
    if isinstance(data, dict):
        return {k: remove_fields(v, fields) for k, v in data.items() if k not in fields}
    elif isinstance(data, list):
        return [remove_fields(item, fields) for item in data]
    return data


def remove_structure_text(data):
    """
    递归移除结构中的 text 字段

    参数:
        data: 树状结构

    返回:
        移除 text 字段后的结构

    使用示例:
        >>> clean = remove_structure_text(tree)
    """
    if isinstance(data, dict):
        data.pop("text", None)
        if "nodes" in data:
            remove_structure_text(data["nodes"])
    elif isinstance(data, list):
        for item in data:
            remove_structure_text(item)
    return data


def create_clean_structure_for_description(structure):
    """
    创建用于生成文档描述的干净结构

    只保留关键字段: title, node_id, summary, prefix_summary

    参数:
        structure: 原始结构

    返回:
        只包含必要字段的结构

    使用示例:
        >>> clean = create_clean_structure_for_description(tree)
    """
    if isinstance(structure, dict):
        clean_node = {}
        # Only include essential fields for description
        for key in ["title", "node_id", "summary", "prefix_summary"]:
            if key in structure:
                clean_node[key] = structure[key]

        # Recursively process child nodes
        if "nodes" in structure and structure["nodes"]:
            clean_node["nodes"] = create_clean_structure_for_description(
                structure["nodes"]
            )

        return clean_node
    elif isinstance(structure, list):
        return [create_clean_structure_for_description(item) for item in structure]
    else:
        return structure


def format_structure(structure, order=None):
    """
    格式化结构，重新排序字段

    参数:
        structure: 树状结构
        order: 字段顺序列表

    返回:
        字段重新排序后的结构

    使用示例:
        >>> order = ["structure", "title", "node_id", "start_index", "end_index"]
        >>> formatted = format_structure(tree, order)
    """
    def reorder_dict(data, key_order):
        if not key_order:
            return data
        return {key: data[key] for key in key_order if key in data}

    if not order:
        return structure
    if isinstance(structure, dict):
        if "nodes" in structure:
            structure["nodes"] = format_structure(structure["nodes"], order)
        if not structure.get("nodes"):
            structure.pop("nodes", None)
        structure = reorder_dict(structure, order)
    elif isinstance(structure, list):
        structure = [format_structure(item, order) for item in structure]
    return structure


# ============================================================
# LLM 摘要生成
# ============================================================

async def generate_node_summary(node, llm_client=None):
    """
    为单个节点生成摘要

    参数:
        node: 节点对象，必须包含 "text" 字段
        llm_client: LLM 客户端

    返回:
        节点摘要文本

    异常:
        ValueError: 如果 llm_client 为 None

    使用示例:
        >>> summary = await generate_node_summary(node, llm_client)
        >>> print(summary)
        "本章介绍了..."
    """
    prompt = f"""You are given a part of a document, your task is to generate a description of the partial document about what are main points covered in the partial document.

    Partial Document Text: {node["text"]}

    Directly return the description, do not include any other text.
    """
    # 添加上下文信息
    title = node.get("title", "未知章节")
    context = f"摘要生成-章节'{title[:30]}...'"
    response = await llm_client.chat_async(prompt, context=context)
    return response


async def generate_summaries_for_structure(structure, llm_client=None):
    """
    为结构中的所有节点生成摘要

    参数:
        structure: 树状结构
        llm_client: LLM 客户端

    返回:
        添加了 summary 字段的结构

    异常:
        ValueError: 如果 llm_client 为 None

    使用示例:
        >>> result = await generate_summaries_for_structure(tree, llm_client)
    """
    # 导入 structure_to_list 从新模块
    from .structure.converter import structure_to_list

    nodes = structure_to_list(structure)
    tasks = [generate_node_summary(node, llm_client=llm_client) for node in nodes]
    summaries = await asyncio.gather(*tasks, return_exceptions=True)

    for node, summary in zip(nodes, summaries):
        if not isinstance(summary, Exception):
            node["summary"] = summary
    return structure


def generate_doc_description(structure, llm_client=None):
    """
    生成文档描述

    参数:
        structure: 文档结构
        llm_client: LLM 客户端

    返回:
        文档描述文本

    异常:
        ValueError: 如果 llm_client 为 None

    使用示例:
        >>> desc = generate_doc_description(tree, llm_client)
        >>> print(desc)
        "这是一本关于..."
    """
    prompt = f"""Your are an expert in generating descriptions for a document.
    You are given a structure of a document. Your task is to generate a one-sentence description for the document, which makes it easy to distinguish the document from other documents.

    Document Structure: {structure}

    Directly return the description, do not include any other text.
    """
    # 添加上下文信息
    response = llm_client.chat(prompt, context="文档描述生成")
    return response


# ============================================================
# 调试工具
# ============================================================

def print_toc(tree, indent=0):
    """
    打印目录树

    参数:
        tree: 树状结构
        indent: 缩进级别

    使用示例:
        >>> print_toc(tree)
        第一章
          第一节
        第二章
    """
    for node in tree:
        print("  " * indent + node["title"])
        if node.get("nodes"):
            print_toc(node["nodes"], indent + 1)


def print_json(data, max_len=40, indent=2):
    """
    打印 JSON 数据，截断长字符串

    参数:
        data: 要打印的数据
        max_len: 最大字符串长度 (默认 40)
        indent: 缩进 (默认 2)

    使用示例:
        >>> print_json(tree)
        {"title": "第一章", "nodes": [...]}
    """
    def simplify_data(obj):
        if isinstance(obj, dict):
            return {k: simplify_data(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [simplify_data(item) for item in obj]
        elif isinstance(obj, str) and len(obj) > max_len:
            return obj[:max_len] + "..."
        else:
            return obj

    simplified = simplify_data(data)
    print(json.dumps(simplified, indent=indent, ensure_ascii=False))


# ============================================================
# 日志工具
# ============================================================

class JsonLogger:
    """
    JSON 日志记录器

    将日志消息保存为 JSON 文件，每条日志包含时间戳和级别。

    属性:
        filename: 日志文件名
        log_data: 日志数据列表

    日志格式:
        {
            "timestamp": "2026-01-18 11:30:45.123",
            "level": "INFO",
            "message": "开始处理"
        }

    使用示例:
        >>> logger = JsonLogger("document.pdf")
        >>> logger.info("开始处理")
        >>> logger.error("处理失败")
    """

    def __init__(self, file_path):
        # Extract PDF name for logger name
        pdf_name = get_pdf_name(file_path)

        current_time = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.filename = f"{pdf_name}_{current_time}.json"
        os.makedirs("./logs", exist_ok=True)
        # Initialize empty list to store all messages
        self.log_data = []

    def log(self, level, message, **kwargs):
        # Add timestamp to each log entry
        log_entry = {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],  # 毫秒级时间戳
            "level": level,
        }

        if isinstance(message, dict):
            log_entry.update(message)
        else:
            log_entry["message"] = message

        # Add any additional kwargs
        log_entry.update(kwargs)

        self.log_data.append(log_entry)

        # Write entire log data to file (ensure_ascii=False for Chinese support)
        with open(self._filepath(), "w", encoding="utf-8") as f:
            json.dump(self.log_data, f, indent=2, ensure_ascii=False)

    def info(self, message, **kwargs):
        self.log("INFO", message, **kwargs)

    def error(self, message, **kwargs):
        self.log("ERROR", message, **kwargs)

    def warning(self, message, **kwargs):
        self.log("WARNING", message, **kwargs)

    def debug(self, message, **kwargs):
        self.log("DEBUG", message, **kwargs)

    def exception(self, message, **kwargs):
        kwargs["exception"] = True
        self.log("ERROR", message, **kwargs)

    def _filepath(self):
        return os.path.join("logs", self.filename)


# ============================================================
# PDF 解析工具 (向后兼容)
# ============================================================

def get_page_tokens(pdf_path, model=None, pdf_parser="PyMuPDF"):
    """
    解析 PDF 并返回每页的文本和 Token 数量

    注意: 此函数为了向后兼容而保留。
    新代码应使用 pdf.parser.PDFParser 类。

    参数:
        pdf_path: PDF 文件路径
        model: 用于 Token 计数的模型名称 (可选，默认从配置文件读取)
        pdf_parser: PDF 解析器 ("pypdf" 或 "PyMuPDF")

    返回:
        列表，每个元素是 (页面文本, Token 数量) 的元组

    使用示例:
        >>> pages = get_page_tokens("document.pdf")
        >>> for text, tokens in pages:
        ...     print(f"{tokens} tokens")
    """
    # 导入新模块
    from .pdf.parser import PDFParser

    parser = PDFParser(default_parser=pdf_parser, model=model)
    return parser.parse(pdf_path)


# ============================================================
# 配置加载器 (向后兼容)
# ============================================================

class ConfigLoader:
    """
    配置加载器

    从 YAML 文件加载默认配置，并与用户提供的配置合并。

    注意: 此类为了向后兼容而保留。
    新代码应使用 core.config.ConfigLoader 类。

    属性:
        _default_dict: 默认配置字典

    使用示例:
        >>> loader = ConfigLoader()
        >>> config = loader.load({"model": "gpt-4o"})
        >>> print(config.model)
        "gpt-4o"
    """

    def __init__(self, default_path: str = None):
        if default_path is None:
            default_path = Path(__file__).parent / "config.yaml"
        self._default_dict = self._load_yaml(default_path)

    @staticmethod
    def _load_yaml(path):
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def _validate_keys(self, user_dict):
        unknown_keys = set(user_dict) - set(self._default_dict)
        if unknown_keys:
            raise ValueError(f"Unknown config keys: {unknown_keys}")

    def _dict_to_config(self, data):
        """Recursively convert dict to SimpleNamespace"""
        if isinstance(data, dict):
            return config(**{k: self._dict_to_config(v) for k, v in data.items()})
        elif isinstance(data, list):
            return [self._dict_to_config(item) for item in data]
        else:
            return data

    def load(self, user_opt=None) -> config:
        """
        Load the configuration, merging user options with default values.
        """
        if user_opt is None:
            user_dict = {}
        elif isinstance(user_opt, config):
            user_dict = vars(user_opt)
        elif isinstance(user_opt, dict):
            user_dict = user_opt
        else:
            raise TypeError("user_opt must be dict, config(SimpleNamespace) or None")

        self._validate_keys(user_dict)
        merged = {**self._default_dict, **user_dict}
        return self._dict_to_config(merged)

    def get_llm_client(self, user_opt: dict | None = None):
        """
        获取 LLM 客户端

        注意: 新代码应直接使用 llm.UnifiedLLM 和 llm.get_provider
        """
        # 导入新模块
        from .llm import UnifiedLLM, get_provider

        cfg = self.load(user_opt)
        provider_config = getattr(cfg, "llm_provider", {})
        provider = get_provider(provider_config)
        return UnifiedLLM(provider=provider, model=cfg.model)
