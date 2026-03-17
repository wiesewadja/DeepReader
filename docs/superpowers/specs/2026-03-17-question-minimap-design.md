# Question Minimap 设计文档

## 概述

在对话消息列表右侧添加一个类似 VSCode minimap 的导航组件。用户消息块突出显示，AI 消息块辅助展示增加美观度，块位置与消息实际滚动位置同步。用户可点击快速跳转到对应提问。

## 目标

- 提供用户提问的可视化总览，方便定位
- 快速跳转到用户提问位置
- 极简、美观、非侵入式的 UI 设计
- 与消息列表滚动位置同步

## 视觉设计

### 布局示意

```
┌───────────────────────────────────────────────────────┬──────┐
│ ╭─────────────────────────────────────────────────╮   │ ▓▓▓▓ │ ← 用户块（深色，大）
│ │ 可视区域                                        │   │ ░░  │ ← AI 块（浅色，小）
│ │                                                 │   │ ▓▓▓▓ │
│ │  [用户] 第一章的核心观点是什么？                  │   │ ░░  │
│ │                                                 │   │ ════ │ ← 视口指示器（hover 时显示）
│ │  [AI] 第一章的核心观点是关于...                  │   │ ░░  │
│ │                                                 │   │      │
│ ╰─────────────────────────────────────────────────╯   │ ▓▓▓▓ │
│                                                       │ ░░  │
│  [用户] 作者为什么这样论证？                           │      │
│                                                       │      │
└───────────────────────────────────────────────────────┴──────┘
```

### 规格参数

| 属性 | 值 | 说明 |
|------|-----|------|
| minimap 宽度 | 18px | 紧凑但易于点击 |
| 用户消息块高度 | 8px | 固定高度，突出显示 |
| AI 消息块高度 | 3px | 固定高度，辅助展示 |
| 块间距 | 2px | 视觉分隔 |
| 用户消息颜色 | `--text-muted` | 深色块，突出显示 |
| AI 消息颜色 | `--background-modifier-hover` | 浅色块，背景融合 |
| 视口指示器颜色 | `--text-faint` (灰色) | hover 时显示 |

### 视口指示器

| 属性 | 值 |
|------|-----|
| 宽度 | 100% minimap 宽度 |
| 高度 | 按比例计算（当前视口高度 / 总内容高度） |
| 背景 | 半透明灰色 `--text-faint` |
| 显示时机 | 仅在 hover minimap 时显示 |
| 边框 | 无 |

### Tooltip 设计

| 属性 | 值 |
|------|-----|
| 最大宽度 | 200px |
| 内边距 | 6px 10px |
| 背景 | `--background-primary` |
| 边框 | `--background-modifier-border` |
| 圆角 | 6px |
| 字体 | 12px |
| 内容 | 问题前 30 字符 + "..." |
| 位置 | 跟随鼠标，向左偏移 10px |
| 显示时机 | 仅 hover 用户消息块时 |

## 交互行为

### 状态机

```
                    hover 用户块
┌─────────────┐ ─────────────────→ ┌─────────────┐
│   默认状态   │                    │  显示 tooltip │
└─────────────┘                    └─────────────┘
       ↑                                  │
       │                                  │
       │         click / mouseleave       │
       └──────────────────────────────────┘

                    hover minimap
┌─────────────┐ ─────────────────→ ┌─────────────────┐
│  无视口指示器 │                    │ 显示视口指示器   │
└─────────────┘                    └─────────────────┘
       ↑                                  │
       │         mouseleave minimap       │
       └──────────────────────────────────┘
```

### 交互规则

1. **hover 用户消息块**
   - 显示 tooltip，内容为问题摘要
   - tooltip 跟随鼠标移动
   - 显示视口指示器（灰色）

2. **click 用户消息块**
   - 平滑滚动到对应消息
   - tooltip 消失
   - 消息居中显示

3. **hover AI 消息块**
   - 无 tooltip
   - 鼠标样式保持默认
   - 显示视口指示器

4. **click AI 消息块**
   - 无交互（或可选：滚动到对应位置）

5. **hover minimap 区域**
   - 显示视口指示器（灰色半透明）

6. **mouseleave minimap**
   - tooltip 立即消失
   - 视口指示器消失

7. **滚动消息列表**
   - minimap 块位置同步更新
   - 视口指示器位置同步（若正在 hover）

## 技术设计

### 组件结构

```
frontend/src/components/question-minimap/
├── index.ts                    # 导出
├── question-minimap.ts         # 主组件
└── question-minimap.css        # 样式
```

### 组件接口

```typescript
interface QuestionMinimapProps {
  /** 消息列表数据 */
  messages: MessageData[];
  /** 消息容器元素（用于计算滚动位置） */
  containerEl: HTMLElement;
  /** 点击回调，返回消息 ID */
  onMessageClick: (messageId: string) => void;
}

interface MinimapBlock {
  id: string;
  role: 'user' | 'assistant';
  /** 块在 minimap 中的 Y 位置（像素） */
  top: number;
  /** 块的高度（固定：用户 8px，AI 3px） */
  height: number;
  /** tooltip 内容（仅用户消息） */
  tooltipContent?: string;
}
```

### 位置计算算法

```typescript
// 常量定义
const USER_BLOCK_HEIGHT = 8;
const AI_BLOCK_HEIGHT = 3;
const BLOCK_GAP = 2;

function calculateBlockPositions(
  messages: MessageData[],
  containerEl: HTMLElement,
  minimapHeight: number
): MinimapBlock[] {
  const blocks: MinimapBlock[] = [];
  const containerScrollHeight = containerEl.scrollHeight;

  let currentTop = 0;

  for (const msg of messages) {
    if (msg.hidden) continue;

    // 计算消息在容器中的相对位置
    const msgEl = containerEl.querySelector(`[data-message-id="${msg.id}"]`);
    if (!msgEl) continue;

    const msgTop = (msgEl as HTMLElement).offsetTop;
    const topPercent = msgTop / containerScrollHeight;

    const height = msg.role === 'user' ? USER_BLOCK_HEIGHT : AI_BLOCK_HEIGHT;

    blocks.push({
      id: msg.id,
      role: msg.role,
      top: topPercent * (minimapHeight - height),
      height,
      tooltipContent: msg.role === 'user'
        ? truncateText(msg.content, 30)
        : undefined,
    });
  }

  return blocks;
}

// 计算视口指示器位置
function calculateViewportIndicator(
  containerEl: HTMLElement,
  minimapHeight: number
): { top: number; height: number } {
  const viewportHeight = containerEl.clientHeight;
  const scrollHeight = containerEl.scrollHeight;
  const scrollTop = containerEl.scrollTop;

  const viewportPercent = viewportHeight / scrollHeight;
  const scrollTopPercent = scrollTop / scrollHeight;

  return {
    top: scrollTopPercent * minimapHeight,
    height: Math.max(viewportPercent * minimapHeight, 20), // 最小 20px
  };
}
```

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `components/question-minimap/index.ts` | 新建 | 组件导出 |
| `components/question-minimap/question-minimap.ts` | 新建 | 主组件实现 |
| `components/question-minimap/question-minimap.css` | 新建 | 样式定义 |
| `components/message-list/message-list.ts` | 修改 | 集成 minimap |
| `components/message-list/message-list.css` | 修改 | 布局调整 |
| `styles/main.css` | 修改 | 导入 minimap 样式 |

### 集成方式

在 `MessageList` 组件中：

```typescript
// message-list.ts
class MessageList extends Component {
  private minimap: QuestionMinimap | null = null;

  render(): HTMLElement {
    // ... 现有代码

    // 创建 minimap（在容器右侧，绝对定位）
    this.minimap = new QuestionMinimap({
      containerEl: this.messagesContainer,
      onMessageClick: (id) => this.scrollToMessage(id),
    });
    container.appendChild(this.minimap.getElement());

    return container;
  }

  // 添加消息后更新 minimap
  addMessage(messageData: MessageData): Message {
    const message = super.addMessage(messageData);
    this.updateMinimap();
    return message;
  }

  // 更新 minimap 数据
  private updateMinimap(): void {
    if (this.minimap) {
      this.minimap.updateMessages(this.getMessagesData());
    }
  }
}
```

## 性能考虑

1. **位置计算优化**
   - 使用 `ResizeObserver` 监听容器尺寸变化
   - 使用 `MutationObserver` 监听消息增删
   - 防抖处理（150ms）

2. **滚动同步优化**
   - 监听容器滚动事件
   - 使用 `requestAnimationFrame` 更新视口指示器
   - 防抖 scroll 事件（50ms）

3. **tooltip 优化**
   - 使用 `requestAnimationFrame` 更新位置
   - 防抖 mousemove 事件（100ms）

## 可访问性

- minimap 区域添加 `aria-label="对话导航"`
- 用户消息块添加 `role="button"` 和 `aria-label="跳转到：{问题摘要}"`
- 支持键盘导航（Tab 聚焦，Enter 跳转）

## 未来扩展

- [ ] 支持拖拽 minimap 快速滚动
- [ ] 高亮当前视口区域
- [ ] 支持书签/收藏功能
