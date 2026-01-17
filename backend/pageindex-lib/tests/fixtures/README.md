# PageIndex 测试 PDF 文件

本目录用于存放测试用的 PDF 文件。

## 目录结构

```
fixtures/
├── README.md           # 本文件
└── pdf/                # PDF 测试文件目录
    ├── chinese/        # 中文 PDF
    │   ├── academic/   # 中文学术论文
    │   ├── technical/  # 中文技术文档
    │   └── books/      # 中文书籍
    └── english/        # 英文 PDF
        ├── academic/   # 英文学术论文
        ├── technical/  # 英文技术文档
        └── books/      # 英文书籍
```

## 测试 PDF 要求

### 1. 中文 PDF

#### 学术论文 (chinese/academic/)
- 有完整的目录结构
- 使用中文编号 (第一章、第二章 等)
- 包含参考文献、致谢等
- 示例：硕士/博士论文

#### 技术文档 (chinese/technical/)
- 技术手册或 API 文档
- 使用数字编号 (1.1、1.2 等)
- 有清晰的层级结构
- 示例：产品文档、技术规范

#### 书籍 (chinese/books/)
- 有分篇/分章结构
- 目录可能包含页码
- 示例：技术书籍、教材

### 2. 英文 PDF

#### 学术论文 (english/academic/)
- Thesis 或 dissertation
- Complete table of contents
- Numbered chapters

#### 技术文档 (english/technical/)
- Technical manuals
- API documentation
- Clear hierarchical structure

#### 书籍 (english/books/)
- Books with parts/chapters
- Page numbers in TOC

## 文件命名建议

```
<category>-<type>-<description>.pdf

例如:
- chinese-academic-thesis-ai.pdf
- chinese-tech-manual-deeplearning.pdf
- english-book-python-cookbook.pdf
```

## 使用方法

```bash
# 测试单个 PDF
uv run python scripts/test_with_real_pdf.py tests/fixtures/pdf/chinese/academic/sample.pdf

# 测试时启用 LLM
uv run python scripts/test_with_real_pdf.py tests/fixtures/pdf/chinese/academic/sample.pdf --with-llm
```

## 注意事项

1. **文件大小**: 建议测试 PDF 不要超过 10 MB
2. **版权**: 请勿上传有版权保护的文件
3. **隐私**: 确保文件不包含敏感信息
4. **多样性**: 提供不同类型、不同结构的 PDF 用于测试

## 推荐测试源

### 公开资源
- [arXiv.org](https://arxiv.org/) - 学术论文预印本
- [Project Gutenberg](https://www.gutenberg.org/) - 公版书籍
- 技术文档开源项目

### 自己生成
- 使用 LaTeX/Word 创建测试文档
- 导出为 PDF 格式
- 确保包含目录结构

## 测试覆盖目标

一个好的测试 PDF 集合应该覆盖：

- [ ] 中文文档 (第一章、第二章)
- [ ] 数字编号文档 (1.1、1.2)
- [ ] 混合编号文档 (第一篇 1.1)
- [ ] 有目录页码的文档
- [ ] 无目录页码的文档
- [ ] 无目录的文档
- [ ] 多层目录结构 (3 层以上)
- [ ] 特殊字符 (全角标点、空格等)
