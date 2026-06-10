# UI 组件架构

> DeepReader 的 42 个 UI 组件组织——统一基类 `Component` + 16 子目录 + 4 大类功能划分。
>
> 配套阅读：[系统鸟瞰.md 第 2 层 UI 层](../architecture/系统鸟瞰.md#layers)、
> [features/ui.md](../features/ui.md)（产品视角 F-22~F-25）、
> [views/](../views/)（顶层视图 + sidebar/library/zlibrary）。

---

## 目录
1. [Component 基类：render + destroy 抽象](#component)
3. [16 子目录 × 4 大类功能](#categories)
5. [与 views/ 的边界](#views-boundary)
6. [已知限制](#limitations-inference)

---

## Component 基类

**位置**：`src/components/component.ts`（20 行）

```typescript
export abstract class Component {
    protected el: HTMLElement | null = null;

    abstract render(): HTMLElement;
    getElement(): HTMLElement | null { return this.el; }

    destroy(): void {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}
```

**3 个方法**：

| 方法 | 职责 | 必须 |
|---|---|---|
| `render()` | 返回根 HTMLElement | ✓ abstract |
| `getElement()` | 获取根元素 | 默认实现 |
| `destroy()` | 销毁（remove from DOM + 引用置空） | 默认实现 |

**关键设计**：
- **不依赖框架**——直接操作 DOM（`HTMLElement` / `createEl`），不引入 React / Vue
- **`el` 字段受保护**——子类可访问，外部只通过 `getElement()`
- **`destroy()` 必须显式调**——**没有自动 GC**，忘记 destroy 会导致内存泄漏

### Component 子类模式

```typescript
export class ChatInput extends Component {
  render(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'deepreader-chat-input';
    // ... 子组件挂载
    return container;
  }

  destroy() {
    super.destroy();  // 必须先调父类
    this.textarea?.removeEventListener('input', this.handler);
    // ... 清理事件监听
  }
}
```

**关键**：`destroy()` 调 `super.destroy()` + 清理自己的事件 / 订阅。

---

## Categories

**位置**：`src/components/`

### 类 1：聊天核心 (3 子目录)

| 目录 | 文件 | 职责 |
|---|---|---|
| `chat-input/` | `chat-input.ts` (939 行) | 用户输入框 + 语音按钮 + 发送逻辑 |
| `message/` | `message.ts` (650 行) + 5 配套 | 单条消息渲染 + streaming + 工具调用展示 |
| `message-list/` | `message-list.ts` | 消息列表虚拟滚动 |

**chat-input 939 行**是最大组件——包含文本输入 / 文件拖拽 / 语音按钮 / 上下文标签 / 草稿保存 5 个子功能。

### 类 2：阅读控制 (5 子目录)

| 目录 | 职责 |
|---|---|
| `reading-mode/` | 阅读模式编排（5 文件，1019 行 orchestrator） |
| `reading-topbar/` | 阅读顶部工具栏 + 吉祥物表情 |
| `question-minimap/` | 章节问题缩略图 |
| `excerpt/` | 选区管理 + 模态框 |
| `header/` | 顶部 Header（书名 / 进度） |

`reading-mode-orchestrator.ts` 1019 行是阅读模式的状态机——管理"分页 / 目录 / 高亮 / 工具栏 / 移动端 FAB" 5 个子模块。

### 类 3：输入增强 (4 子目录)

| 目录 | 职责 |
|---|---|
| `file-suggest/` | `@` 触发文件建议 |
| `folder-suggest/` | `/` 触发文件夹建议 |
| `context-tags/` | 当前上下文标签（书 / 章节） |
| `agent-mode-toggle/` | 检视 / 分析 / 主题 模式切换 |

### 类 4：系统级 (4 子目录)

| 目录 | 职责 |
|---|---|
| `chat-settings-modal/` | 模型 / 角色 / 温度设置 |
| `index-manager/` | 索引管理（重建 / 暂停 / 进度） |
| `drawer/` | 右侧抽屉（书库 / 历史 / 记忆） |
| `top-nav/` | 顶部导航（设置 / 帮助） |

### 其他（独立组件）

- `confirm-modal.ts` —— 通用确认模态框
- `task-progress-card.ts` —— 任务进度卡
- `index-status-badge.ts` —— 索引状态徽章

---

## Key Components

| 组件 | 行数 | 复杂点 |
|---|---|---|
| `chat-input.ts` | 939 | 5 子功能合一：文本 / 拖拽 / 语音 / 标签 / 草稿 |
| `reading-mode-orchestrator.ts` | 1019 | 5 子模块状态管理（分页 / 目录 / 高亮 / 工具栏 / FAB） |
| `message.ts` | 650 | streaming 渲染 + 工具调用展示 + 引用块 |

**共同特征**：

- **单一文件大组件**（不拆 .vue / .tsx）
- **大量 DOM 操作**（`createDiv` / `addClass` / `createSpan` / ...）
- **手写事件管理**（`addEventListener` + `removeEventListener` 对应）
- **状态机内置**（如 reading-mode 的 5 子模块状态）

**为什么这么大**：
1. **不用框架**——所有 DOM 操作手写（`document.createElement` / `el.appendChild`）
2. **不抽 hooks**——没用 useState / useEffect
3. **业务 + 视图不分**——一个 .ts 文件同时管 state + render

**设计代价**：
- 修改时心智负担大（一个文件 939 行要 scroll 来 scroll 去）
- 但**对 Obsidian 插件**这种小规模应用，**避免 React / Vue 启动开销**是合理的

---

## Views Boundary

`src/views/` 装**顶层视图**（5 个），`src/components/` 装**可复用组件**（42 个）。

### 视图 → 组件

```typescript
// src/views/sidebar/sidebar-view.ts
import { ChatInput } from '../../components/chat-input';
import { MessageList } from '../../components/message-list';
import { AgentModeToggle } from '../../components/agent-mode-toggle';

class SidebarView {
  onOpen() {
    this.chatInput = new ChatInput().render();
    this.messageList = new MessageList().render();
    // ...
  }
}
```

**单向依赖**：views 引用 components，components 不知道 views 存在。

### 通信模式

**props down, events up**：

```typescript
// views 调组件方法
this.messageList.appendMessage(newMessage);

// 组件抛事件回 views
this.chatInput.onSend = (text) => {
  this.controller.chat(text);
};
```

**不通过 props**——直接调方法 + 回调函数。**没有完整的 prop drilling 机制**。

---

## Limitations [INFERENCE]

### 通用

- **没有自动 destroy** —— 组件销毁靠手动调 `destroy()`，**忘记就内存泄漏**
- **没有组件复用** —— `new ChatInput().render()` 每次新建，**不会跨视图共享状态**
- **没有 prop validation** —— 父传子用 `any` 风格，**类型不严格**
- **没有测试覆盖 [INFERENCE]** —— 42 个组件，**0 个组件单测**（vitest 都是逻辑层单测）
- **没有 i18n** —— 中文硬编码在 `render()` 字符串里
- **没有 dark mode 适配** —— Obsidian 主题切换时**部分组件颜色不响应**
- **没有虚拟化** —— 长消息列表（100+ 条）**全量渲染**，性能差

### 大组件

- **chat-input 939 行** —— 5 子功能耦合，**改一处影响所有**
- **reading-mode 1019 行** —— 5 子模块状态**没有 external store**（如 Redux），全在组件内
- **message 650 行** —— streaming + 工具展示 + 引用块**混在一个文件**

### 与 views 的耦合

- **直接调组件方法**（非 props）—— 改组件签名需要同步改所有 views
- **没有事件总线** —— 跨组件通信靠**父组件中介**或**全局 event**

### 缺失

- **没有 Storybook** —— 组件**无法独立预览**
- **没有 a11y 支持** —— ARIA labels / keyboard nav 缺失
- **没有动画系统** —— 状态切换**生硬切换**，无 transition

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/components/*` 42 文件的架构视角文档。Component 基类 + 4 大类 16 子目录 + 3 个 800+ 行大组件 + 11 条已知限制 |
