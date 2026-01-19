# ChatInput 组件

ChatInput 是一个多行文本输入组件，专为聊天界面设计。

## 功能特性

- ✅ 支持 Enter 发送消息
- ✅ 支持 Shift+Enter 换行
- ✅ 自动调整高度（最大高度限制）
- ✅ 发送按钮（输入为空时禁用）
- ✅ 禁用状态支持
- ✅ 可访问性（ARIA 属性）
- ✅ 使用 Obsidian 原生主题变量

## 使用示例

```typescript
import { ChatInput } from './components/chat-input';

// 创建聊天输入组件
const chatInput = new ChatInput({
    onSend: (message: string) => {
        console.log('发送消息:', message);
        // 处理发送逻辑
    },
    placeholder: '请输入消息...',
    disabled: false,
    minRows: 1,
    maxRows: 5,
    maxHeight: 150,
    onKeyDown: (event: KeyboardEvent) => {
        console.log('键盘事件:', event);
    }
});

// 添加到 DOM
document.body.appendChild(chatInput.getElement()!);

// 方法使用示例
chatInput.setValue('Hello, world!');          // 设置输入内容
const value = chatInput.getValue();           // 获取输入内容
chatInput.clear();                            // 清空输入
chatInput.focus();                            // 聚焦输入框
chatInput.setPlaceholder('新的占位符');        // 设置占位符
chatInput.setDisabled(true);                  // 禁用输入框

// 销毁组件
chatInput.destroy();
```

## API

### 构造函数选项

```typescript
interface ChatInputOptions {
    onSend: (message: string) => void;        // 发送回调（必需）
    onKeyDown?: (event: KeyboardEvent) => void; // 键盘事件回调（可选）
    placeholder?: string;                     // 初始占位符文本
    disabled?: boolean;                       // 初始禁用状态
    minRows?: number;                         // 最小行数（默认 1）
    maxRows?: number;                         // 最大行数（默认 5）
    maxHeight?: number;                       // 最大高度（像素，默认 150）
}
```

### 公共方法

- `getValue(): string` - 获取输入内容
- `setValue(value: string): void` - 设置输入内容
- `clear(): void` - 清空输入
- `focus(): void` - 聚焦输入框
- `setPlaceholder(text: string): void` - 设置占位符
- `setDisabled(disabled: boolean): void` - 设置禁用状态
- `getElement(): HTMLElement | null` - 获取组件元素
- `destroy(): void` - 销毁组件

## 样式定制

组件使用 Obsidian 原生主题变量，自动适配不同主题。如需自定义样式，可以覆盖以下 CSS 类：

- `.deeppdf-chat-input` - 容器
- `.deeppdf-chat-input-wrapper` - 输入框包装器
- `.deeppdf-chat-input-textarea` - 文本输入框
- `.deeppdf-chat-input-button-wrapper` - 按钮包装器
- `.deeppdf-chat-input-send-btn` - 发送按钮

## 键盘快捷键

- `Enter` - 发送消息
- `Shift+Enter` - 换行

## 可访问性

组件支持以下可访问性特性：

- `aria-label="聊天输入框"` - 输入框标签
- `aria-multiline="true"` - 多行文本标识
- `aria-label="发送消息"` - 发送按钮标签
- 禁用状态下的视觉和语义反馈
