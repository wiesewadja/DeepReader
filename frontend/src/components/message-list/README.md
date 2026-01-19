# MessageList 组件

消息列表容器组件，用于管理和渲染聊天消息。

## 功能特性

- 消息管理：添加、更新、删除、清空消息
- 自动滚动：添加新消息时自动滚动到底部
- 空状态：无消息时显示友好提示
- 回调支持：支持消息操作回调（重新生成、复制、跳转引用等）
- 类型安全：完整的 TypeScript 类型支持

## 使用示例

```typescript
import { MessageList } from './components/message-list/message-list';
import { MessageData } from './components/message/message';

// 创建消息列表
const messageList = new MessageList({
    onRegenerate: (messageId) => {
        console.log('重新生成消息:', messageId);
    },
    onCopy: (messageId) => {
        console.log('复制消息:', messageId);
    },
    onCopyWithCitation: (messageId) => {
        console.log('复制消息和引用:', messageId);
    },
    onCitationJump: (citation) => {
        console.log('跳转到引用:', citation);
    }
});

// 添加到 DOM
document.body.appendChild(messageList.getElement()!);

// 添加用户消息
const userMessage: MessageData = {
    id: 'msg-1',
    role: 'user',
    content: '你好，请介绍一下这个 PDF 文档',
    timestamp: new Date().toISOString()
};
messageList.addMessage(userMessage);

// 添加 AI 消息
const aiMessage: MessageData = {
    id: 'msg-2',
    role: 'assistant',
    content: '这是一个关于深度学习的文档...',
    timestamp: new Date().toISOString(),
    citations: [
        {
            pdf_name: 'deep-learning.pdf',
            page: 5,
            snippet: '深度学习是机器学习的一个分支...'
        }
    ]
};
messageList.addMessage(aiMessage);

// 更新消息内容（用于流式输出）
messageList.updateMessage('msg-2', {
    content: '这是一个关于深度学习的完整介绍...',
    isStreaming: false
});

// 获取所有消息
const messages = messageList.getMessages();

// 清空所有消息
messageList.clearMessages();

// 销毁组件
messageList.destroy();
```

## API

### 构造函数

```typescript
constructor(callbacks: MessageCallbacks = {})
```

### 方法

- `addMessage(messageData: MessageData): Message` - 添加消息
- `updateMessage(messageId: string, updates: Partial<MessageData>): void` - 更新消息
- `getMessage(messageId: string): Message | undefined` - 获取指定消息
- `getMessages(): Message[]` - 获取所有消息
- `getMessagesData(): MessageData[]` - 获取所有消息数据
- `removeMessage(messageId: string): void` - 删除指定消息
- `clearMessages(): void` - 清空所有消息
- `scrollToBottom(): void` - 滚动到底部
- `scrollToMessage(messageId: string): void` - 滚动到指定消息
- `destroy(): void` - 销毁组件

### 回调

```typescript
interface MessageCallbacks {
    onRegenerate?: (messageId: string) => void;
    onCopy?: (messageId: string) => void;
    onCopyWithCitation?: (messageId: string) => void;
    onCitationJump?: (citation: CitationData) => void;
}
```

## 样式

组件使用 Obsidian 主题变量，自动适配不同主题。样式类名以 `deeppdf-` 前缀开头，避免冲突。
