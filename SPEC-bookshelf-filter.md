# SPEC: 书架筛选与排序功能

> 版本: 2026.05.24

---

## 1. 目标

为 LibraryView（书库）添加文件类型筛选、作者筛选和多维排序功能，让用户在书多时能快速定位书籍。

### 目标用户

DeepReader 插件用户（Obsidian 深度阅读者），书架上有多本书，需要按类型、作者快速筛选。

### 验收标准

- [ ] 点击类型 chip 可筛选对应类型书籍，chip 高亮选中态，数量正确
- [ ] 作者下拉可按作者筛选，选中后按钮显示当前作者名
- [ ] 排序下拉可切换排序方式，默认「添加时间（最新优先）」
- [ ] 搜索 + 类型筛选 + 作者筛选可组合使用
- [ ] 筛选后卡片数量和空状态正确显示
- [ ] 样式与现有书架风格一致（Obsidian 原生风格）
- [ ] 不影响现有功能：搜索、添加书籍、主题阅读、进度轮询
- [ ] `npm run build` 类型检查通过

---

## 2. 现状分析

| 能力 | 现状 |
|------|------|
| 搜索 | 文本搜索（按书名/作者子串匹配） |
| 排序 | 硬编码状态优先级（处理中 > 待处理 > 就绪 > 失败） |
| 筛选 | 无 |
| 微信读书 | 通过 `wereadMappingCache` 判断关联，`fileType` 可能是 `undefined` |

**关键文件**：
- `src/views/library-view.ts` — 书库视图（~1860 行）
- `src/views/library-view.css` — 样式（~750 行）

---

## 3. UI 设计

### 3.1 整体布局

```
┌──────────────────────────────────────────────────┐
│  我的书库                                          │
├──────────────────────────────────────────────────┤
│  🔍 搜索书籍...          [+添加] [📖主题] [↕排序▾]  │
├──────────────────────────────────────────────────┤
│  全部(12)  PDF(8)  EPUB(2)  微信读书(2)   [作者▾]   │
├──────────────────────────────────────────────────┤
│  ┌──┐  ┌──┐  ┌──┐  ┌──┐  ┌──┐                   │
│  │书│  │书│  │书│  │书│  │书│                    │
│  └──┘  └──┘  └──┘  └──┘  └──┘                   │
└──────────────────────────────────────────────────┘
```

- **第一行**（现有改造）：搜索框 + 操作按钮 + 排序下拉按钮
- **第二行**（新增）：类型 chips + 作者筛选下拉

### 3.2 类型 Chips

固定 4 个 chip，始终显示：

```
全部(12)  PDF(8)  EPUB(2)  微信读书(2)
```

- 默认选中「全部」
- 点击切换，高亮选中态（`var(--interactive-accent)` 背景）
- 括号内数字动态更新（基于搜索结果过滤后的书籍数）
- 微信读书数量 = `wereadMappingCache` 中有映射但不是 DeepReader 本地索引的书

### 3.3 作者筛选下拉

```
[作者 ▾]  →  点击展开
              ○ 全部作者
              ○ 纳西姆·尼古拉斯·塔勒布 (2)
              ● 吕峥 (1)
              ○ 未知作者 (3)
```

- 从当前书籍列表动态收集去重作者
- 按书籍数量降序排列
- 无作者的书籍归入「未知作者」
- 选中后按钮文案变为作者名，如 `[吕峥 ×]`
- 点击 × 清除筛选

### 3.4 排序下拉

移到工具栏第一行右侧，替换现有隐藏的排序逻辑：

```
[排序: 添加时间 ▾]  →  ● 添加时间（最新优先）
                        ○ 添加时间（最早优先）
                        ○ 书名 A→Z
                        ○ 书名 Z→A
                        ○ 作者 A→Z
                        ○ 作者 Z→A
                        ○ 按状态
```

- 默认：「添加时间（最新优先）」
- 「按状态」保留原有 `sortIndexes()` 逻辑作为可选项

---

## 4. 技术方案

### 4.1 修改文件

| 文件 | 变更 |
|------|------|
| `src/views/library-view.ts` | 添加筛选/排序状态、filter bar UI、`renderGrid()` 增加过滤逻辑 |
| `src/views/library-view.css` | 添加 filter bar 样式（chips、下拉菜单） |

不新增文件，不引入新依赖。

### 4.2 新增类属性

```typescript
// 筛选状态
private filterType: 'all' | 'pdf' | 'epub' | 'weread' = 'all';
private filterAuthor: string | null = null;  // null = 全部

// 排序状态
private sortKey: 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc' | 'author-asc' | 'author-desc' | 'status' = 'time-desc';
```

### 4.3 数据流

```
this.indexes[]
    ↓ 文本搜索过滤（现有 searchQuery）
    ↓ 类型过滤（filterType）
    ↓ 微信读书过滤（wereadMappingCache）
    ↓ 作者过滤（filterAuthor）
    ↓ 去重已关联 DeepReader 索引（现有逻辑）
    ↓ 排序（sortKey）
    ↓ 渲染
```

### 4.4 renderGrid() 改造

在现有 `filtered` 变量之后、`sorted` 之前插入筛选步骤：

```typescript
private renderGrid(): void {
    // ... 现有前置逻辑 ...

    let filtered = this.indexes;

    // 1. 文本搜索（现有逻辑）
    if (this.searchQuery) {
        filtered = filtered.filter(idx =>
            idx.pdf_name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
            (idx.author && idx.author.toLowerCase().includes(this.searchQuery.toLowerCase()))
        );
    }

    // 2. 类型筛选
    if (this.filterType !== 'all') {
        if (this.filterType === 'weread') {
            filtered = filtered.filter(idx => this.wereadMappingCache.has(idx.id));
        } else {
            filtered = filtered.filter(idx => idx.fileType === this.filterType);
        }
    }

    // 3. 作者筛选
    if (this.filterAuthor !== null) {
        if (this.filterAuthor === '__unknown__') {
            filtered = filtered.filter(idx => !idx.author);
        } else {
            filtered = filtered.filter(idx => idx.author === this.filterAuthor);
        }
    }

    // 4. 去重已关联（现有逻辑）
    filtered = filtered.filter(idx => !this.associatedDeepReaderIds.has(idx.id));

    // 5. 排序（替代现有 sortIndexes）
    const sorted = this.applySort(filtered);

    // ... 渲染逻辑（同现有） ...
}
```

### 4.5 排序实现

```typescript
private applySort(indexes: IndexListItem[]): IndexListItem[] {
    const sorted = [...indexes];
    switch (this.sortKey) {
        case 'time-desc': return sorted.sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        case 'time-asc': return sorted.sort((a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        case 'name-asc': return sorted.sort((a, b) =>
            a.pdf_name.localeCompare(b.pdf_name, 'zh'));
        case 'name-desc': return sorted.sort((a, b) =>
            b.pdf_name.localeCompare(a.pdf_name, 'zh'));
        case 'author-asc': return sorted.sort((a, b) =>
            (a.author || 'zzz').localeCompare(b.author || 'zzz', 'zh'));
        case 'author-desc': return sorted.sort((a, b) =>
            (b.author || 'zzz').localeCompare(a.author || 'zzz', 'zh'));
        case 'status': return this.sortIndexes(sorted); // 现有逻辑
        default: return sorted;
    }
}
```

### 4.6 Chips 数量计算

每次 `renderGrid()` 时更新 chips 上的数量：

```typescript
private updateFilterCounts(): void {
    const base = this.indexes.filter(idx => !this.associatedDeepReaderIds.has(idx.id));
    // 应用当前搜索词后的数量（不应用类型/作者筛选，避免循环）
    const searched = this.searchQuery
        ? base.filter(idx => idx.pdf_name.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
            (idx.author && idx.author.toLowerCase().includes(this.searchQuery.toLowerCase())))
        : base;

    const counts = {
        all: searched.length,
        pdf: searched.filter(idx => idx.fileType === 'pdf').length,
        epub: searched.filter(idx => idx.fileType === 'epub').length,
        weread: searched.filter(idx => this.wereadMappingCache.has(idx.id)).length,
    };
    // 更新 DOM 中 chips 的文字
}
```

### 4.7 下拉菜单实现

使用原生 DOM 构建 popover（不用第三方库），点击外部关闭：

```typescript
private showSortDropdown(anchorEl: HTMLElement): void {
    const menu = document.body.createDiv({ cls: 'deeppdf-lib-dropdown' });
    // 定位到锚点下方
    // 渲染选项列表
    // 点击选项 → 更新 sortKey → renderGrid() → 关闭菜单
    // 点击外部 → 关闭菜单
}
```

---

## 5. 样式方案

### 5.1 Filter Bar

```css
.deeppdf-lib-filter-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 24px;
    border-bottom: 1px solid var(--background-modifier-border);
}

.deeppdf-lib-type-chip {
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 12px;
    cursor: pointer;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-primary);
    color: var(--text-muted);
}

.deeppdf-lib-type-chip.active {
    background: var(--interactive-accent);
    color: #fff;
    border-color: var(--interactive-accent);
}
```

### 5.2 下拉菜单

```css
.deeppdf-lib-dropdown {
    position: fixed;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    box-shadow: var(--shadow-s);
    z-index: 1000;
    padding: 4px;
}
```

---

## 6. 边界条件

| 场景 | 处理 |
|------|------|
| 无作者书籍 | 归入「未知作者」，筛选 key 为 `__unknown__` |
| `fileType` 为空 | 不匹配任何类型筛选，只在「全部」中显示 |
| 搜索 + 筛选组合 | 先文本搜索 → 再类型筛选 → 再作者筛选 → 排序 |
| 筛选结果为空 | 显示「未找到匹配书籍」空状态（复用现有） |
| 书单卡片 | 不受类型/作者筛选影响，仅在无搜索词时显示在最前 |
| 排序中处理中书籍 | 按「添加时间」排序时，处理中的书按实际 created_at 排序（不再强制排最前） |
| Chips 数量 | 基于搜索结果计算（不含类型/作者筛选），避免循环依赖 |

---

## 7. 不做的事情

- 不修改 `IndexListItem` 数据结构
- 不新增用户自定义标签系统
- 不修改侧边栏（SidebarView）
- 不修改 Agent 系统
- 不引入第三方 UI 库
- 不修改 `render()` 的整体结构，只在工具栏和网格之间插入 filter bar
