# HoverPopover 接管机制

> AI 聊天消息里 [[...]] wiki 链接的 hover 弹窗——从"自建 div + document.body" 改造
> 为"用 Obsidian HoverPopover 全权接管"，修复 6 个 bug 让弹窗在所有场景下都显示。
>
> 配套阅读：[wiki-link-system.md](./wiki-link-system.md)（链接后处理）、
> [internal-links-bug-locks.test.ts](../../tests/unit/components/message/internal-links-bug-locks.test.ts)（11 个黄金测试）、
> commit `5d6c9382`（fix commit）。

---

## 目录

1. [设计意图：为什么必须用 Obsidian HoverPopover](#why)
2. [改造前后对比](#before-after)
3. [接管机制 7 步骤](#7-takeover)
4. [失败兜底：trigger('hover-link') 接管](#fallback)
5. [修复的 6 个 bug 列表](#6-bug-bugs-fixed)
6. [关键源文件](#files)
7. [已知限制](#limits)

---

## 设计意图 (why)

DeepReader AI 聊天消息里频繁出现 `[[书名/章节#^block|别名]]` wiki 链接。**用户 hover 时弹窗**——**显示该章节的精选内容**——是核心交互。

**前实现问题**：

- **自建 div + document.body.appendChild**——popover **不在 Obsidian 容器内**——**关闭面板时 popover 不自动消失**
- **`removeAttribute('title')` + MutationObserver 持续删 title**——阻断 Obsidian 内部 hover 触发器
- **`hoverParent: HoverParent = { hoverPopover: null }` 普通对象字面量**——Obsidian 接管 popover 失败
- **fallback 路径 `trigger('hover-link')` 实际不工作**——bug 修复前用户报告"弹窗有时不弹"

**核心洞察**：Obsidian **暴露了 `HoverPopover` 类**——它**自己**管理显示/隐藏/定位/动画。**我们只需要创建它 + 填内容**——**不重复造轮子**——**生命周期由 Obsidian 自管**。

---

## 改造前后对比 (before-after)

| 维度 | 旧实现 | 新实现 |
|---|---|---|
| **popover DOM** | `document.createElement('div')` + `document.body.appendChild` | `new HoverPopover(hoverParent, link, 0).hoverEl` |
| **挂载位置** | `document.body` 末尾 | Obsidian `hoverParent` 容器（MarkdownView/leaf） |
| **生命周期** | 手 `setTimeout(unload, 150)` | `HoverPopover.unload()` 自管 |
| **定位** | 手算 `getBoundingClientRect` + `style.position = 'fixed'` | `new HoverPopover(parent, targetEl, waitTime)` 自管 |
| **淡入动画** | 手 `requestAnimationFrame` + `requestAnimationFrame` | `popover.hoverEl` + `class` 由 Obsidian CSS |
| **title 行为** | `removeAttribute` + MutationObserver 持续删 | 保留（Obsidian 自管） |
| **fallback** | `trigger('hover-link', { hoverParent: { hoverPopover: null } })` 失败 | 先 `unload()` 我们的 popover，**再** `trigger('hover-link', { hoverParent: 真实容器 })` |
| **失败处理** | fallback 失败 → 什么都不显示 | fallback 失败 → Obsidian 用默认预览接管 |

---

## 接管机制 7 步骤 (takeover)

```typescript
link.addEventListener('mouseenter', (_event) => {
  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  cleanup();
  lastTarget = link;

  showTimer = setTimeout(async () => {
    if (lastTarget !== link || isLoading) return;
    isLoading = true;

    // 1. 立刻创建 HoverPopover —— Obsidian 接管挂载 + 显示
    const popover = new HoverPopover(hoverParent, link, 0);
    activePopover = popover;

    // 2. 准备 Component 容器（管 MarkdownRenderer 子组件生命周期）
    const component = new Component();
    activeComponent = component;

    // 3. 填 hoverEl 骨架（Obsidian 自管位置 + 动画）
    const root = popover.hoverEl;
    root.classList.add('popover', 'deeppdf-link-preview');
    const headerEl = root.createDiv({ cls: 'deeppdf-link-preview-header' });
    const contentEl = root.createDiv({ cls: 'deeppdf-link-preview-content markdown-preview-view' });
    const footerEl = root.createDiv({ cls: 'deeppdf-link-preview-footer', text: '查看原文 ›' });
    footerEl.addEventListener('click', () => link.click());

    // 4. 异步加载内容
    let result: PreviewResult | null = null;
    try {
      result = await resolveWikiLinkPreview(app, href);
    } catch (e) {
      log('[DeepPDF] Preview resolve failed:', e);
    }

    if (lastTarget !== link || activePopover !== popover) {
      cleanup();
      isLoading = false;
      return;
    }

    if (!result) {
      // 5. 失败：交给 Obsidian 默认 hover-link 处理
      cleanup();
      app.workspace.trigger('hover-link', { source: 'deeppdf', hoverParent, targetEl: link, linktext: href });
      isLoading = false;
      return;
    }

    // 6. 填头部 + 内容
    headerEl.innerHTML = '<span class="deeppdf-link-preview-book">《' + escapeHtml(result.bookName) + '》</span>' + ...;
    await MarkdownRenderer.render(app, result.text, contentEl, '', component);

    // 7. 鼠标进入 popover 不关闭（hoverEl 事件）
    popover.hoverEl.addEventListener('mouseenter', () => { ... });
    popover.hoverEl.addEventListener('mouseleave', () => { ... });

    isLoading = false;
  }, 200);
});
```

### 关键设计要点

| 要点 | 原因 |
|---|---|
| `waitTime=0` | 我们已经异步等了 200ms（showTimer），HoverPopover **立即显示** |
| `lastTarget === link` 检查 | 用户已 hover 到别处 → **不填内容** + cleanup |
| `activePopover !== popover` 检查 | 二次保险——并发 hover 切换 |
| `cleanup()` 在失败时 | 让 Obsidian 的 `trigger('hover-link')` 接管时不冲突 |
| `footerEl.addEventListener('click', () => link.click())` | 复用 link 原有 click handler（blockId 跳转、阅读模式适配） |

### `hoverParent` 真实容器

**关键修复**：之前是普通对象字面量 `{ hoverPopover: null }`——**Obsidian 接管失败**。现在：

```typescript
const hoverParent: HoverParent = ((): HoverParent => {
  const activeLeaf = app.workspace.getActiveViewOfType(MarkdownView)
    ?? (app.workspace.getLeavesOfType('markdown')[0] as unknown as HoverParent | undefined);
  return activeLeaf ?? (document.body as unknown as HoverParent);
})();
```

**3 段 fallback**：

1. **优先** 取当前激活的 `MarkdownView`（实现了 `HoverParent` 接口）
2. **次选** 任意 markdown leaf
3. **兜底** `document.body`（任何情况下都不为 null）

---

## 失败兜底 (fallback)

**`resolveWikiLinkPreview` 返回 null 的 5 个场景**（详见源码注释）：

| 场景 | 概率 |
|---|---|
| `vault.adapter.read` 抛错（文件被删/未索引） | **中** |
| `pathParts.length < 2`（AI 输出 `[[single-file]]`） | 低 |
| blockId 找不到（AI 编造 / 文件结构变了） | **高** |
| lines 为空 | 极低 |
| 抛错（catch 兜底） | **中** |

**修复前**：

```typescript
} else {
  app.workspace.trigger('hover-link', {
    source: 'deeppdf',
    hoverParent: { hoverPopover: null },  // ← null，永远失败
    targetEl: link,
    linktext: href
  });
}
```

**修复后**：

```typescript
if (!result) {
  cleanup();  // 卸掉我们的 popover（如果有）
  app.workspace.trigger('hover-link', {
    source: 'deeppdf',
    hoverParent,  // ← 真实容器
    targetEl: link,
    linktext: href
  });
  isLoading = false;
  return;
}
```

**关键差异**：
1. `cleanup()` 卸掉我们刚创建的 popover
2. `hoverParent` 是真实容器（Obsidian 能挂载）
3. Obsidian 的"页面预览"插件会接管，创建默认 popover

---

## 修复的 6 个 bug 列表 (bugs-fixed)

**锁测试位置**：`tests/unit/components/message/internal-links-bug-locks.test.ts`（11 个黄金测试）

| Bug | 修复 | 测试 |
|---|---|---|
| **1. fallback trigger 不显示** | `hoverParent` 用真实容器（不再是 `{}` 字面量） | `Bug 1` 单测 |
| **2. link.title 永久删除** | 完全删 `removeAttribute` + MutationObserver | `Bug 2 修复` 单测 |
| **3. 单段路径 fallback 失败** | 真实 `hoverParent` + 先 `cleanup()` 再 `trigger` | `Bug 3` 单测 |
| **4. popover 挂 document.body** | HoverPopover 挂真实容器 | `Bug 4 修复` 单测 |
| **5. 流式期间删 title** | 删除 `removeAttribute` 逻辑 | `Bug 5 修复` 单测 |
| **6. hoverPopover 永远 null** | 显式 `new HoverPopover` 设给 hoverParent | `Bug 6` 单测 |

**测试机制**：
- 用 `vi.useFakeTimers` + `Promise.resolve()` 排空 microtask（**不**用墙钟 setTimeout）
- `App` mock 暴露 `getActiveViewOfType` / `getLeavesOfType` / `trigger`
- `HoverPopover` mock 真实化：暴露 `hoverEl` + 自动挂到 parent

---

## 关键源文件 (files)

| 文件 | 职责 |
|---|---|
| `src/components/message/internal-links.ts` | setupInternalLinks + hover 处理（433 行） |
| `tests/__mocks__/obsidian.ts` | App + HoverPopover 真实化 mock |
| `tests/unit/components/message/internal-links-bug-locks.test.ts` | 11 个黄金测试 |
| `src/components/message/message.css` | `.deeppdf-link-preview` + `.deeppdf-link-preview--visible` 样式 |

---

## 已知限制 (limits)

1. **单 link 串行 hover** —— 当前 `isLoading` 标志位防止并发，但**等待 200ms**让用户感知到延迟
2. **`app.workspace.getLeavesOfType('markdown')[0]` 类型推断问题** —— `WorkspaceLeaf` 实际**不**严格实现 `HoverParent`，用了 `as unknown as HoverParent` 跳过分型
3. **MarkdownView 的 `previewMode.renderer` 路径** —— d.ts 暴露 `previewMode: MarkdownPreviewView` 直接用 `.containerEl`，**不需要** `.renderer` 中转
4. **失败时 Obsidian 默认 popover 内容由"页面预览"插件决定** —— 我们**不**控制其内容样式
5. **流式期间 disableHoverPreview=true** —— 不绑 mouseenter，但**仍走 setup**——**不删 title 是因为根本不删**——流式期间 title 保留
6. **`.antigravitycli/` 工作目录污染** —— 用户自己 untracked——不影响 hover 弹窗

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 commit `5d6c9382` 的 HoverPopover 接管机制文档。7 步接管流程 + 失败兜底 + 6 bug 修复 + 11 黄金测试 |
