# TopNav 组件

可复用的顶部导航栏组件，包含 Logo、索引选择器、状态指示器和操作按钮。

## 功能特性

- **Logo 和标题** - 显示 DeepPDF 品牌
- **索引选择器** - 下拉选择 PDF 索引
- **状态指示器** - 显示服务器连接状态
- **管理索引按钮** - 打开索引管理界面
- **设置按钮** - 可选的设置入口

## 使用示例

```typescript
import { TopNav } from './components/top-nav/index.js';

// 创建 TopNav 实例
const topNav = new TopNav({
    onIndexChange: (indexId) => {
        console.log('选择的索引:', indexId);
    },
    onManageIndexes: () => {
        console.log('打开索引管理');
    },
    showSettings: true,
    onSettings: () => {
        console.log('打开设置');
    }
});

// 添加到容器
container.appendChild(topNav.getElement()!);

// 设置连接状态
topNav.setStatus('connected');

// 设置索引列表
topNav.setIndexes([
    { id: 'idx1', pdf_name: 'Document 1', node_count: 100 },
    { id: 'idx2', pdf_name: 'Document 2', node_count: 200 }
]);

// 设置选中的索引
topNav.setSelectedIndex('idx1');

// 获取当前选中的索引
const currentIndex = topNav.getSelectedIndex();
const currentIndexText = topNav.getSelectedIndexText();

// 禁用/启用组件
topNav.setIndexSelectDisabled(true);
topNav.setManageButtonDisabled(false);

// 销毁组件
topNav.destroy();
```

## API

### 构造函数选项 (TopNavOptions)

| 属性 | 类型 | 必需 | 描述 |
|------|------|------|------|
| onIndexChange | (indexId: string) => void | 否 | 索引切换回调 |
| onManageIndexes | () => void | 否 | 管理索引回调 |
| showSettings | boolean | 否 | 是否显示设置按钮 |
| onSettings | () => void | 否 | 设置按钮回调 |

### 公共方法

#### setStatus(status: ConnectionStatus)
设置连接状态。

- `loading` - 检查中...
- `connected` - 已连接
- `disconnected` - 未连接
- `error` - 连接失败

#### setIndexes(indexes: IndexListItem[])
设置索引列表。

#### setSelectedIndex(indexId: string)
设置选中的索引。

#### getSelectedIndex(): string
获取当前选中的索引 ID。

#### getSelectedIndexText(): string
获取当前选中的索引文本。

#### setIndexSelectDisabled(disabled: boolean)
禁用或启用索引选择器。

#### setManageButtonDisabled(disabled: boolean)
禁用或启用管理按钮。

#### destroy()
销毁组件，清理事件监听器和 DOM 元素。

## 样式

组件使用 `main.css` 中定义的 Obsidian CSS 变量，确保与主题一致。

### 主要样式类

- `.deeppdf-top-nav` - 导航容器
- `.deeppdf-nav-left` - 左侧区域
- `.deeppdf-nav-right` - 右侧区域
- `.deeppdf-logo` - Logo
- `.deeppdf-index-select` - 索引选择器
- `.deeppdf-status` - 状态指示器
- `.deeppdf-manage-btn` - 管理按钮
