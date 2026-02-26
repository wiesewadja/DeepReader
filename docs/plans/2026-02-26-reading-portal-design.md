# 阅读入口功能设计文档

## 概述

创建一个"阅读入口"文档，使用 Obsidian Base 表格统一管理所有已索引的 PDF 书籍，追踪阅读进度，并提供快速启动对话阅读的入口。

## 核心需求

1. **阅读仪表盘** - 在一个 Markdown 文档中通过 Obsidian Base 表格查看所有已索引书籍的状态
2. **进度追踪** - 基于对话覆盖页码自动计算阅读进度
3. **快速启动** - 点击链接即可跳转到 DeepPDF 侧边栏开始对话
4. **书籍笔记** - 按需创建书籍笔记文件，自动生成摘要

## 文件结构

```
DeepPDF/
├── 📚 阅读入口.md          # Base 表格入口文档
└── 书籍名称.md              # 按需创建的书籍笔记（带 frontmatter）
```

## 数据模型

### 书籍笔记 Frontmatter

```yaml
---
index_id: idx_abc123
status: reading        # unread / reading / completed
progress: 15           # 百分比
total_pages: 438
read_pages: "1,2,3,4,5,10,11,12,13,14,15,100,101,102"
last_read: 2026-02-26
chat_rounds: 12
tags: [技术, AI]
created: 2026-02-20
---
```

### 进度计算

```
进度 = len(read_pages) / total_pages * 100
```

- `unread`: progress = 0%
- `reading`: 0% < progress < 100%
- `completed`: progress = 100%

## 入口文档结构

```markdown
---
deeppdf_entry: true
---

# 📚 阅读入口

管理所有已索引的 PDF 文档，追踪阅读进度。

```base
file: DeepPDF
fields:
  - name: 书名
    type: text
  - name: 状态
    type: select
    options: [未开始, 阅读中, 已完成]
  - name: 进度
    type: number
  - name: 总页数
    type: number
  - name: 最后阅读
    type: date
  - name: 对话轮数
    type: number
  - name: 标签
    type: multiselect
  - name: 操作
    type: text
```

> 💡 点击「操作」列的链接开始对话阅读
```

## 书籍笔记结构

```markdown
---
index_id: idx_abc123
status: reading
progress: 15
total_pages: 438
read_pages: "1,2,3,4,5,10,11,12,13,14,15,100,101,102"
last_read: 2026-02-26
chat_rounds: 12
tags: [技术, AI]
created: 2026-02-20
---

# 📖 书籍名称

## 📖 摘要

> [!note] AI 生成摘要
> 本书中介绍了...（后台异步生成）

## 📑 章节目录

1. 第一章：xxx
2. 第二章：xxx
（后台异步生成）

## 💭 阅读笔记

（用户自由记录区域）

## 🔗 相关链接

- [[📚 阅读入口]] - 返回书籍列表
- [开始对话](obsidian://deeppdf-chat?index_id=idx_abc123) - 与 AI 讨论
```

## 技术实现

### 前端

1. **URI 协议处理**
   - 使用 `registerObsidianProtocolHandler` 注册 `deeppdf-chat` 协议
   - 解析 `obsidian://deeppdf-chat?index_id=xxx` 链接
   - 打开侧边栏并切换到指定书籍

2. **入口文档管理**
   - 提供"打开阅读入口"按钮
   - 自动创建 `DeepPDF/📚 阅读入口.md`
   - 扫描书籍笔记更新 Base 数据

3. **书籍笔记管理**
   - 首次阅读时创建笔记文件
   - 触发后台摘要生成任务
   - 更新 frontmatter 进度数据

### 后端

1. **新增 API 端点**
   - `POST /api/indexes/{index_id}/reading-progress` - 更新阅读页码
   - `GET /api/indexes/{index_id}/reading-progress` - 获取进度详情
   - `POST /api/indexes/{index_id}/generate-summary` - 触发摘要生成

2. **索引元数据扩展**
   ```python
   read_pages: List[int] = []      # 已阅读页码
   chat_rounds: int = 0            # 对话轮数
   last_read_at: str = None        # 最后阅读时间
   ```

3. **对话接口改造**
   - 每次查询后自动提取引用页码
   - 更新 `read_pages` 和 `last_read_at`

## 实现优先级

1. **P0：核心功能**
   - URI 协议处理
   - 入口文档创建
   - 书籍笔记创建（按需）
   - 阅读进度追踪

2. **P1：增强功能**
   - 摘要自动生成
   - 进度同步到 frontmatter

3. **P2：优化功能**
   - Base 表格美化
   - 状态统计展示
