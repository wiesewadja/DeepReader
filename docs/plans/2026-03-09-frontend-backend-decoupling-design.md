# 前后端解耦设计文档

## 背景

当前 DeepReader 插件的前端与后端耦合紧密，后端未连接时前端无法正常使用。这不符合插件的最佳实践——插件应该能够独立加载和运行，后端服务应该是可选的增强功能。

## 设计目标

1. **完全独立模式**：前端完全不依赖后端，可以正常加载和渲染 UI
2. **渐进增强**：后端连接后提供额外功能（PDF 索引、文档搜索、章节获取等）
3. **智能提示**：在用户尝试使用后端功能时才提示连接需求
4. **前端 Agent 独立工作**：即使后端未连接，前端 Agent 仍可使用 LLM API 回答问题（用户手动提供上下文时效果更好）

## 架构分析

### 前端 Agent 能力矩阵

| 功能 | 无后端 | 有后端 |
|------|--------|--------|
| LLM 对话 | ✅ 可用 | ✅ 可用 |
| 用户手动提供上下文 | ✅ 可用 | ✅ 可用 |
| PDF 索引 | ❌ 不可用 | ✅ 可用 |
| 自动文档搜索 | ❌ 不可用 | ✅ 可用 |
| 章节获取 | ❌ 不可用 | ✅ 可用 |
| 跨书籍搜索 | ❌ 不可用 | ✅ 可用 |

### 后端依赖功能清单

**重度依赖（需要弹窗提示）**：
- PDF/EPUB 索引
- 索引管理（删除、重建）
- 跨书籍搜索
- 书籍列表刷新

**轻度依赖（降级可用）**：
- 发送消息：Agent 自动切换到基础模式
- 搜索文档：显示"后端未连接"提示

## UI 设计

### 状态指示器

在阅读顶栏（ReadingTopbar）右侧添加连接状态指示器：

```
🟢 已连接    # 绿色圆点 + tooltip "后端已连接"
🔴 未连接    # 红色圆点 + tooltip "后端未连接"
🔄 连接中    # 旋转图标 + tooltip "正在连接..."
```

### 后端功能按钮

需要后端的功能按钮在未连接时：
- 显示为灰色
- 添加视觉提示（如半透明）
- 点击时弹窗提示："此功能需要连接后端服务。请启动后端：`uv run uvicorn...`"

### 消息提示

当后端未连接时，Agent 回答前添加系统提示：
```
ℹ️ 后端未连接，使用基础模式回答。连接后端可获得更精确的上下文支持。
```

## 实现方案

### 阶段 1：启动流程解耦

**目标**：插件加载时不阻塞，直接渲染主 UI

**变更文件**：
- `frontend/src/main.ts`
- `frontend/src/views/sidebar-view.ts`

**关键改动**：
1. 移除 `onload()` 中的 `await this.checkServerConnection()`
2. 改为异步检查，不阻塞 UI 渲染
3. `SidebarView.onOpen()` 直接渲染主 UI，不等待连接检查

### 阶段 2：状态管理

**目标**：建立清晰的连接状态管理和通知机制

**变更文件**：
- `frontend/src/views/sidebar-view.ts`
- `frontend/src/components/reading-topbar/reading-topbar.ts`

**关键改动**：
1. 添加连接状态枚举：`connected | disconnected | connecting`
2. 实现状态变更通知机制
3. ReadingTopbar 添加状态指示器组件

### 阶段 3：UI 组件改造

**目标**：所有 UI 组件支持"后端未连接"状态

**变更文件**：
- `frontend/src/components/reading-topbar/reading-topbar.ts`
- `frontend/src/components/index-manager/index-manager.ts`
- `frontend/src/components/chat-input/chat-input.ts`

**关键改动**：
1. ReadingTopbar 添加状态指示器
2. IndexManager 按钮根据连接状态显示/禁用
3. ChatInput 输入框始终可用

### 阶段 4：交互逻辑优化

**目标**：所有需要后端的操作都有合适的降级或提示

**变更文件**：
- `frontend/src/views/sidebar-view.ts`
- `frontend/src/agent/agent-loop.ts`

**关键改动**：
1. 移除所有 `if (!this.isConnected) return` 的硬性拦截
2. 索引操作改为弹窗提示
3. Agent 对话时注入连接状态信息

## 代码变更清单

### 文件修改

1. **frontend/src/main.ts**
   - 移除 `checkServerConnection()` 的 await
   - 改为后台异步检查

2. **frontend/src/views/sidebar-view.ts**
   - 移除 `showDisconnectedUI()` 全屏提示
   - 修改 `checkConnectionAndRender()` 为非阻塞
   - 添加状态变更通知方法
   - 修改所有后端依赖检查逻辑

3. **frontend/src/components/reading-topbar/reading-topbar.ts**
   - 添加连接状态指示器
   - 添加 `setConnectionStatus()` 方法
   - 索引按钮根据状态禁用

4. **frontend/src/components/index-manager/index-manager.ts**
   - 索引操作按钮根据连接状态禁用

5. **frontend/src/components/chat-input/chat-input.ts**
   - 输入框始终可用
   - 移除 `setDisabled()` 中的连接状态检查

6. **frontend/src/agent/agent-loop.ts**
   - Agent 系统提示中注入连接状态

### 样式文件

7. **frontend/src/styles.css**
   - 添加状态指示器样式
   - 添加禁用按钮样式

## 测试计划

### 测试场景

1. **后端未启动时**
   - [ ] 插件可以正常加载
   - [ ] 侧边栏可以正常打开
   - [ ] UI 正常渲染，显示"未连接"状态
   - [ ] 输入框可以输入
   - [ ] 发送消息后 Agent 可以回复（基础模式）
   - [ ] 点击索引按钮时弹窗提示

2. **后端启动后**
   - [ ] 状态自动更新为"已连接"
   - [ ] 所有功能正常可用
   - [ ] 索引按钮可点击

3. **后端断开时**
   - [ ] 状态自动更新为"未连接"
   - [ ] 正在进行的操作有合适提示
   - [ ] 后续操作有降级处理

### 边缘情况

- 启动时后端未连接，中途启动后端
- 启动时后端已连接，中途断开后端
- 网络不稳定导致连接状态频繁变化

## 回滚方案

如果出现问题，可以通过以下方式快速回滚：
1. 恢复 `checkConnectionAndRender()` 的阻塞逻辑
2. 恢复 `showDisconnectedUI()` 全屏提示

## 后续优化

1. **离线缓存**：缓存索引列表、对话历史等数据，支持离线浏览
2. **重连机制**：后端断开后自动尝试重连
3. **状态持久化**：保存连接状态，避免每次启动都检查
