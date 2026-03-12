# 段落级引用跳转实现方案

> **状态**: 待实现
> **创建日期**: 2026-03-11
> **优先级**: 中

## 背景

当前引用跳转只能定位到**文档级别**，无法精确定位到具体段落。用户期望实现段落级引用跳转，提升阅读体验。

## 目标

1. 后端定位到文档级别（已有能力）
2. 前端本地搜索定位到具体行号
3. 滚动到该段落并可选高亮

## 当前架构

### 后端能力
- 通过向量搜索定位到 Markdown 文件
- 返回字段：
  - `markdown_path` - 文档路径
  - `snippet` - 引用文本片段
  - `anchor` - 块引用锚点（大部分文档没有）

### 前端能力
- `openMarkdownDocument(path, anchor)` - 打开文档
- 支持块引用锚点 `#^block-id`（需要文档预定义）

## 技术方案

### 方案 A：使用 snippet 本地搜索（推荐）

**实现思路：**
1. 打开目标文档
2. 读取文档内容
3. 在内容中搜索 snippet 文本
4. 找到后获取行号
5. 使用 `Editor.scrollIntoView()` 滚动到该行

**相关 API：**
```typescript
// Obsidian Editor API
interface EditorPosition {
    line: number;
    ch: number;
}

interface EditorRange {
    from: EditorPosition;
    to: EditorPosition;
}

// 滚动方法
editor.scrollIntoView(range: EditorRange, center?: boolean): void;

// 选中方法（可选高亮）
editor.setSelection(from: EditorPosition, to: EditorPosition): void;
```

### 方案 B：后端返回行号（不可行）

用户明确说明："不能从后端查询获取，后端无法知道行号的"

### 方案 C：块引用锚点（需要修改索引逻辑）

需要在索引时为每个段落生成 `^block-id`，改动较大，暂不采用。

## 待确认问题

### 1. snippet 可靠性
- [ ] 后端返回的 snippet 是否为原文？
- [ ] 是否经过处理（去换行、标点变化等）？
- [ ] 需要验证实际数据的匹配率

### 2. 匹配策略
- [ ] 精确匹配 vs 模糊匹配？
- [ ] 匹配失败时的回退行为？
- [ ] 多个匹配结果时如何选择？

**建议策略：**
```
1. 优先精确匹配
2. 失败时尝试匹配前 50 个字符
3. 仍失败则直接打开文档（不定位）
```

### 3. 性能考量
- [ ] 大文档（>1MB）的搜索性能
- [ ] 是否需要缓存文档内容？
- [ ] 是否需要 Web Worker？

### 4. 用户体验
- [ ] 是否需要在打开文档后高亮/选中匹配文本？
- [ ] Notice 提示应该显示什么信息？
- [ ] 是否支持阅读模式下滚动？

## 已完成的工作

### 代码修改（已提交但未完成集成）

1. **CitationData 接口扩展** - [message.ts:20-44](../frontend/src/components/message/message.ts#L20-L44)
   ```typescript
   export interface CitationData {
       // ... 已有字段
       /** 可选：搜索文本（用于段落级定位，优先使用此字段，否则使用 snippet） */
       search_text?: string;
   }
   ```

2. **辅助方法实现** - [sidebar-view.ts](../frontend/src/views/sidebar-view.ts)
   - `openDocumentWithSearch()` - 打开文档并搜索定位
   - `findTextLine()` - 在内容中查找文本所在行
   - `scrollToLine()` - 滚动到指定行
   - `scrollToTextInActiveView()` - 在当前视图中搜索滚动

## 下一步行动

- [ ] 验证 snippet 匹配可靠性（测试实际数据）
- [ ] 确定匹配策略（精确/模糊/回退）
- [ ] 集成到 `handleCitationJump()` 方法
- [ ] 添加单元测试
- [ ] 测试大文档性能
- [ ] 用户验收测试

## 相关文件

- `frontend/src/components/message/message.ts` - CitationData 接口
- `frontend/src/views/sidebar-view.ts` - 引用跳转逻辑
- `backend/deeppdf-api/src/deeppdf/services/querier.py` - 后端搜索逻辑

## 参考资料

- [Obsidian Editor API](https://docs.obsidian.md/Reference/TypeScript+API/Editor)
- 之前的研究：Obsidian 使用 `eState` 传递滚动位置信息
