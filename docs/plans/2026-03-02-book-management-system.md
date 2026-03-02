# 图书管理系统实现计划

## 设计概要

基于头脑风暴确认的方案，实现一个与 Obsidian markdown 深度集成的图书管理系统。

### 核心设计决策
1. **数据存储**: 每本书的 markdown 笔记中添加 `booklists` 和 `tags` 属性
2. **入口文档**: 单一 `图书管理.md` 文件，使用 Obsidian Bases 查询聚合
3. **侧边栏**: 精简为快捷入口（跨书籍搜索、主题报告）
4. **搜索过滤**: 从入口文档发起搜索，预设书单/标签过滤条件

---

## 实现步骤

### Phase 1: 数据模型与后端 API

#### Step 1.1: 扩展书籍笔记 Frontmatter
**文件**: `frontend/src/services/reading-portal.ts`

修改 `BookFrontmatter` 接口和 `generateBookNoteContent` 方法：
```typescript
interface BookFrontmatter {
  // ... 现有字段 ...
  booklists: string[];  // 新增：所属书单列表
  tags: string[];       // 已有：书籍标签
}
```

#### Step 1.2: 后端跨书籍搜索支持书单/标签过滤
**文件**: `backend/deeppdf-api/src/deeppdf/api/models.py`

扩展 `CrossBookSearchRequest`：
```python
class CrossBookSearchRequest(BaseModel):
    query: str
    index_ids: Optional[List[str]] = None
    top_k: int = 5
    # 新增过滤条件
    booklists: Optional[List[str]] = Field(None, description="按书单过滤")
    tags: Optional[List[str]] = Field(None, description="按标签过滤")
```

**文件**: `backend/deeppdf-api/src/deeppdf/services/cross_book_search.py`

新增函数：
- `get_book_metadata(storage_dir, index_id)` - 从书籍笔记中读取 frontmatter
- `filter_indexes_by_metadata(indexes, booklists, tags, storage_dir)` - 根据书单/标签过滤索引

修改 `cross_book_search()` 函数，在搜索前应用过滤。

#### Step 1.3: 后端新增 API 获取书单/标签列表
**文件**: `backend/deeppdf-api/src/deeppdf/api/routes.py`

新增端点：
```
GET /api/booklists - 获取所有书单列表
GET /api/tags - 获取所有标签列表
```

---

### Phase 2: 入口文档生成

#### Step 2.1: 创建图书管理入口文档模板
**文件**: `frontend/src/services/reading-portal.ts`

新增方法：
- `createBookManagementPortal()` - 创建/更新 `图书管理.md`
- `generateBookManagementContent()` - 生成入口文档内容

入口文档结构：
```markdown
---
deeppdf_book_management: true
---

# 📚 图书管理

## 📖 书单

### 技术书籍
```base
filters:
  - file.hasProperty("booklists")
  - booklists.includes("技术书籍")
properties:
  book_name: "书名"
  progress: "进度"
```

[🔍 搜索此书单](obsidian://deeppdf-search?booklists=技术书籍)

### 文学作品
...

## 🏷️ 标签

#技术 #哲学 #心理学 ...

## 📊 统计

- 总书籍数: X
- 已完成: X
- 阅读中: X
```

#### Step 2.2: 支持 Obsidian URI 发起过滤搜索
**文件**: `frontend/src/main.ts`

处理 `obsidian://deeppdf-search` URI：
- 解析 `booklists` 和 `tags` 参数
- 打开侧边栏并设置搜索过滤条件

---

### Phase 3: 侧边栏精简

#### Step 3.1: 移除侧边栏的书籍列表
**文件**: `frontend/src/views/sidebar-view.ts`

- 移除 `renderIndexList()` 相关代码
- 移除索引列表 UI 组件
- 保留跨书籍搜索和主题报告入口

#### Step 3.2: 添加搜索范围显示
**文件**: `frontend/src/views/sidebar-view.ts`

- 在跨书籍搜索框旁显示当前过滤范围
- 支持 `booklists` 和 `tags` 参数
- 添加"清除过滤"按钮

---

### Phase 4: 书单/标签管理 UI

#### Step 4.1: 书籍笔记中添加书单/标签编辑
**文件**: `frontend/src/services/reading-portal.ts`

新增方法：
- `updateBookMetadata(indexId, booklists, tags)` - 更新书籍的 frontmatter

#### Step 4.2: 入口文档中添加快捷操作
- 每个书单/标签旁添加"搜索此范围"按钮
- 使用 `obsidian://deeppdf-search?booklists=xxx` URI

---

## 关键文件变更

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/services/reading-portal.ts` | 修改 | 添加书单/标签支持，创建入口文档 |
| `frontend/src/views/sidebar-view.ts` | 修改 | 精简 UI，添加搜索范围显示 |
| `frontend/src/main.ts` | 修改 | 处理 `deeppdf-search` URI |
| `frontend/src/api/http-client.ts` | 修改 | 添加书单/标签过滤参数 |
| `backend/.../api/models.py` | 修改 | 扩展 CrossBookSearchRequest |
| `backend/.../api/routes.py` | 修改 | 新增书单/标签列表 API |
| `backend/.../services/cross_book_search.py` | 修改 | 支持按书单/标签过滤 |

---

## 实现顺序

1. **Phase 1**: 后端 API 扩展（Step 1.2, 1.3）
2. **Phase 2**: 入口文档生成（Step 2.1, 2.2）
3. **Phase 3**: 侧边栏精简（Step 3.1, 3.2）
4. **Phase 4**: 书单/标签管理（Step 4.1, 4.2）

---

## 验收标准

1. 入口文档 `图书管理.md` 能正确显示书单和标签分组
2. 点击"搜索此书单"能打开侧边栏并预设过滤条件
3. 侧边栏不再显示完整书籍列表，只显示搜索入口
4. 跨书籍搜索 API 支持按书单/标签过滤
5. 书籍笔记的 frontmatter 能正确保存 booklists 和 tags

---

## 实现状态

**已完成** (2026-03-02)

### 简化方案
由于书籍元数据（booklists 和 tags）存储在 Obsidian vault 的 markdown 文件中，后端无法直接访问，因此采用了前端过滤的简化方案：
- 前端负责从 Obsidian 读取书籍笔记的 frontmatter
- 前端根据过滤条件筛选 index_ids 后传给后端
- 后端只需接受 `index_ids` 参数（已支持）

### 已实现的文件

| 文件 | 修改内容 |
|------|----------|
| `frontend/src/services/reading-portal.ts` | 添加 `booklists` 字段、元数据读取方法、图书管理入口文档生成 |
| `frontend/src/views/sidebar-view.ts` | 添加 `searchFilters` 属性、事件处理、`openBookManagement()` |
| `frontend/src/main.ts` | 添加 `deeppdf-search` 和 `deeppdf-theme-report` URI 处理器 |
| `frontend/src/components/index-manager/index-manager.ts` | 添加 `onOpenBookManagement` 回调和菜单项 |
| `frontend/src/utils/icons.ts` | 添加 `library` 图标 |

### 使用方式

1. 在书籍笔记的 frontmatter 中添加 `booklists` 和 `tags` 属性：
   ```yaml
   ---
   index_id: xxx
   book_name: "书名"
   booklists: ["技术书籍", "推荐阅读"]
   tags: ["编程", "方法论"]
   ---
   ```

2. 点击侧边栏「操作」→「图书管理」打开入口文档

3. 在入口文档中点击「搜索此书单」链接，自动打开侧边栏并预设过滤条件
