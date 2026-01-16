"""
PageIndex 自定义异常类

定义了 PageIndex 中使用的所有异常类型，提供清晰的错误信息和恢复建议。

异常层次结构:
    PageIndexError (基类)
    ├── PDFError (PDF 处理错误)
    ├── TOCError (目录处理错误)
    ├── LLMError (LLM 调用错误)
    └── ValidationError (数据验证错误)

使用示例:
    >>> try:
    ...     result = process_pdf(pdf_path)
    ... except PDFError as e:
    ...     logger.error(f"PDF 处理失败: {e}")
    ... except LLMError as e:
    ...     logger.error(f"LLM 调用失败，已重试 {e.retry_count} 次")
    ...     if e.retry_count < MAX_RETRIES:
    ...         # 尝试降级方案
    ...         ...

作者: DeepPDF Team
创建时间: 2026-01-16
"""


class PageIndexError(Exception):
    """
    PageIndex 基础异常类

    所有 PageIndex 特定异常的父类，用于捕获 PageIndex 相关的所有错误。

    属性:
        message: 错误信息
        original_error: 原始异常（如果有）

    使用示例:
        >>> try:
        ...     raise PageIndexError("处理失败")
        ... except PageIndexError as e:
        ...     print(f"错误: {e}")
        错误: 处理失败
    """

    def __init__(self, message: str, original_error: Exception = None):
        """
        初始化异常

        参数:
            message: 错误信息
            original_error: 原始异常对象（可选）
        """
        self.message = message
        self.original_error = original_error
        super().__init__(message)

    def __str__(self) -> str:
        """返回友好的错误信息"""
        if self.original_error:
            return f"{self.message} (原始错误: {type(self.original_error).__name__}: {self.original_error})"
        return self.message


class PDFError(PageIndexError):
    """
    PDF 处理相关错误

    当 PDF 解析失败、文件损坏或格式不支持时抛出。

    常见触发场景:
        - PDF 文件损坏或加密
        - 不支持的 PDF 版本
        - PDF 解析库（pypdf/PyMuPDF）返回错误

    使用示例:
        >>> try:
        ...     pages = parse_pdf(corrupted_file.pdf)
        ... except PDFError as e:
        ...     logger.error(f"无法解析 PDF: {e}")
        ...     # 尝试使用备用解析器
        ...     pages = parse_with_fallback(corrupted_file.pdf)
    """

    def __init__(self, message: str, pdf_path: str = None, original_error: Exception = None):
        """
        初始化 PDF 错误

        参数:
            message: 错误信息
            pdf_path: PDF 文件路径（可选）
            original_error: 原始异常（可选）
        """
        self.pdf_path = pdf_path
        super().__init__(message, original_error)

    def __str__(self) -> str:
        """返回包含文件路径的错误信息"""
        base_msg = super().__str__()
        if self.pdf_path:
            return f"PDF 文件 '{self.pdf_path}': {base_msg}"
        return base_msg


class TOCError(PageIndexError):
    """
    目录处理相关错误

    当目录检测、解析或验证失败时抛出。

    常见触发场景:
        - PDF 中没有找到目录
        - 目录格式无法识别
        - 目录解析失败
        - 目录验证准确度过低

    使用示例:
        >>> try:
        ...     toc = extract_toc(pdf_pages)
        ... except TOCError as e:
        ...     logger.warning(f"目录提取失败: {e}")
        ...     # 降级到无目录模式
        ...     toc = generate_toc_with_llm(pdf_pages)
    """

    def __init__(self, message: str, stage: str = None, original_error: Exception = None):
        """
        初始化目录错误

        参数:
            message: 错误信息
            stage: 目录处理的阶段（检测/解析/验证）
            original_error: 原始异常（可选）
        """
        self.stage = stage
        super().__init__(message, original_error)

    def __str__(self) -> str:
        """返回包含处理阶段的错误信息"""
        base_msg = super().__str__()
        if self.stage:
            return f"目录{self.stage}阶段: {base_msg}"
        return base_msg


class LLMError(PageIndexError):
    """
    LLM 调用相关错误

    当 LLM API 调用失败、超时或返回无效结果时抛出。

    属性:
        retry_count: 已重试次数
        last_error: 最后一次错误信息
        request_type: 请求类型（chat/chat_async等）

    常见触发场景:
        - API 密钥无效或过期
        - 网络连接失败
        - API 超时
        - 请求速率限制
        - 返回内容格式错误

    使用示例:
        >>> try:
        ...     response = await llm_client.chat_async(prompt)
        ... except LLMError as e:
        ...     logger.error(f"LLM 调用失败: {e.message}")
        ...     logger.error(f"已重试 {e.retry_count} 次")
        ...     if e.retry_count < MAX_RETRIES:
        ...         # 尝试降级方案
        ...         ...
        ...     else:
        ...         raise  # 放弃，重新抛出异常
    """

    def __init__(
        self,
        message: str,
        retry_count: int = 0,
        last_error: str = "",
        request_type: str = "unknown",
        original_error: Exception = None,
    ):
        """
        初始化 LLM 错误

        参数:
            message: 错误信息
            retry_count: 已重试次数（默认 0）
            last_error: 最后一次错误信息
            request_type: 请求类型（chat/chat_async等）
            original_error: 原始异常（可选）
        """
        self.retry_count = retry_count
        self.last_error = last_error
        self.request_type = request_type
        super().__init__(message, original_error)

    def __str__(self) -> str:
        """返回包含详细信息的错误信息"""
        base_msg = super().__str__()
        details = []
        if self.request_type != "unknown":
            details.append(f"请求类型={self.request_type}")
        if self.retry_count > 0:
            details.append(f"已重试={self.retry_count}次")
        if self.last_error:
            details.append(f"最后错误={self.last_error}")

        if details:
            return f"{base_msg} ({', '.join(details)})"
        return base_msg


class ValidationError(PageIndexError):
    """
    数据验证错误

    当输入数据不符合预期格式或范围时抛出。

    常见触发场景:
        - 页码超出范围
        - 参数类型错误
        - 缺少必需参数
        - 数据格式不匹配

    使用示例:
        >>> try:
        ...     validate_page_number(page_num, max_pages=100)
        ... except ValidationError as e:
        ...     logger.error(f"参数验证失败: {e}")
        ...     # 使用默认值或请求用户重新输入
        ...     page_num = 1
    """

    def __init__(self, message: str, parameter: str = None, value=None, original_error: Exception = None):
        """
        初始化验证错误

        参数:
            message: 错误信息
            parameter: 参数名称（可选）
            value: 参数值（可选）
            original_error: 原始异常（可选）
        """
        self.parameter = parameter
        self.value = value
        super().__init__(message, original_error)

    def __str__(self) -> str:
        """返回包含参数信息的错误信息"""
        base_msg = super().__str__()
        if self.parameter:
            value_str = f"值={self.value}" if self.value is not None else ""
            return f"参数 '{self.parameter}' {value_str}: {base_msg}"
        return base_msg


class RetryExhaustedError(LLMError):
    """
    重试次数耗尽错误

    当 LLM 调用达到最大重试次数仍然失败时抛出的特殊异常。

    与 LLMError 的区别:
        - LLMError: 通用的 LLM 错误，可以继续重试
        - RetryExhaustedError: 已达最大重试次数，不应继续重试

    使用示例:
        >>> try:
        ...     response = await call_with_retry(llm_client, prompt)
        ... except RetryExhaustedError as e:
        ...     logger.critical(f"LLM 调用彻底失败: {e}")
        ...     # 使用降级方案或终止处理
        ...     raise
    """

    def __init__(
        self,
        message: str = "LLM 调用达到最大重试次数",
        retry_count: int = 0,
        last_error: str = "",
        request_type: str = "unknown",
        original_error: Exception = None,
    ):
        """
        初始化重试耗尽错误

        参数:
            message: 错误信息
            retry_count: 已重试次数（默认 0）
            last_error: 最后一次错误信息
            request_type: 请求类型（chat/chat_async等）
            original_error: 原始异常（可选）
        """
        super().__init__(message, retry_count, last_error, request_type, original_error)


class TimeoutError(LLMError):
    """
    LLM 调用超时错误

    当 LLM API 调用超过预设超时时间时抛出。

    使用场景:
        - 长时间无响应
        - 处理大量数据超时
    """

    def __init__(
        self,
        message: str = "LLM 调用超时",
        timeout_seconds: float = 0,
        request_type: str = "unknown",
        original_error: Exception = None,
    ):
        """
        初始化超时错误

        参数:
            message: 错误信息
            timeout_seconds: 超时秒数
            request_type: 请求类型
            original_error: 原始异常（可选）
        """
        self.timeout_seconds = timeout_seconds
        super().__init__(message, request_type=request_type, original_error=original_error)

    def __str__(self) -> str:
        """返回包含超时信息的错误信息"""
        base_msg = super().__str__()
        if self.timeout_seconds > 0:
            return f"{base_msg} (超时={self.timeout_seconds}秒)"
        return base_msg
