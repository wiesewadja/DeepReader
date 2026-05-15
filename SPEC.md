# SPEC: DeepReader 配置 UI 重构

> 状态: Draft | 范围: 中等重构 | 目标: 信息架构重组 + 视觉打磨 + 分层设计

---

## 1. 目标

重组配置 UI 的 Tab 布局、改善分组逻辑和视觉层次，使新手用户能 3 步完成配置，高级用户能灵活控制所有参数。

### 核心原则

- **分层设计**: 新手看到简化视图（预设 + Key），高级用户展开完整控制
- **语义分组**: 每个Tab 内容内聚、命名直观，用户能预测设置在哪里
- **渐进披露**: 高频设置直接可见，低频设置折叠隐藏
- **不增加新功能**: 仅重组现有设置，不新增设置项（缺失的 Langsmith/HITL 等另开任务）

---

## 2. 信息架构变更

### 现状问题

| Tab | 问题 |
|-----|------|
| AI 服务 | 混合了快速配置、配置摘要、高级服务商账号三层内容 |
| 服务配置 | 混合了 AI 角色分配 + PDF 索引参数 + SenseNova Key + reranker 权重 |
| 高级 | 只有 3 项，太空洞 |
| 阅读模式 | 混合了阅读样式 + 主动引导两个概念 |

### 新 Tab 布局（横向 Tab 条）

```
┌──────────────────────────────────────────────────────────────────┐
│  [bot] AI 服务  │  [cpu] 模型配置  │  [book] 阅读  │  [user] 画像  │  [wrench] 通用  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tab 内容区（整页滚动）                                           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- Tab 条横向排列在顶部，类似 Obsidian 原生设置页（Settings → Editor/Files 等）
- 删除左侧纵向导航栏，内容区占满宽度，`max-width` 限制阅读舒适度

#### 变更明细

| 设置项 | 原位置 | 新位置 | 理由 |
|--------|--------|--------|------|
| AI 角色分配（核心 + 增强） | 服务配置 | **模型配置** | 与服务商账号解耦 |
| PDF 索引参数（页数/Token/摘要） | 服务配置（折叠） | **通用** | 低频，与 AI 模型无关 |
| Reranker 权重 | 服务配置（折叠） | **模型配置**（reranker 角色内） | 属于该角色的参数，就近放置 |
| SenseNova Key | 服务配置（独立卡片） | **模型配置**（TTS 角色内） | 信息图依赖 TTS 通道，合并 |
| 主动引导 + 冷却时间 | 阅读模式 | **通用** | 功能开关，非阅读样式 |
| 语音书信回复 | 高级 | **通用** | 与 TTS 角色配置同层 |
| 调试日志 | 高级 | **通用** | 开发者设置 |
| Skills 重载 | 高级 | **通用** | 开发者设置 |

#### 不变

- **AI 服务 Tab**: 快速配置流程保持不变，配置摘要保持不变
- **用户画像 Tab**: 完全不变

---

## 3. 视觉改善

### 3.1 Tab 导航改为横向

**现状**: 左侧纵向导航栏（160px 宽），占空间且与 Obsidian 原生设置风格不一致。

**改善**:
- 改为顶部横向 Tab 条，与 Obsidian 原生设置页风格一致
- 每个 Tab 带 Lucide 图标 + 文字，水平排列
- 图标方案: AI 服务→`lucide:bot` / 模型配置→`lucide:cpu` / 阅读→`lucide:book-open` / 用户画像→`lucide:user` / 通用→`lucide:wrench`
- 使用 Obsidian 的 `setIcon(el, 'bot')` API 渲染图标（内置 Lucide 支持）
- 内容区占满宽度，`max-width: 680px` 居中
- 删除 `deeppdf-settings-nav` 的左侧栏样式，改为 `deeppdf-settings-tabs` 横向样式
- 删除 CSS 中 `flex-direction: row` 的左右分栏，改为纵向布局（Tab 条在上，内容在下）

### 3.2 模型配置 Tab 的角色卡片

**现状**: 所有角色平铺，每个角色是可折叠区块，点击展开后显示服务商下拉 + 模型输入 + 测试按钮 + 模型列表获取 + 思考控制 + batch size，信息量过大。

**改善**:
- 角色 header 显示当前配置摘要（如 `主对话 · DeepSeek · deepseek-chat`）
- 折叠内容保持不变（服务商 + 模型 + 测试 + 高级选项）
- 核心角色（chat/router/pageindex）默认不折叠，可选角色默认折叠

### 3.3 配置摘要卡片

**现状**: 纯文字（`当前方案：SiliconFlow 全能` + `对话: model · 语义搜索: model`）。

**改善**:
- 分角色显示状态标签（`✓ 已配置` / `⚠ 未配置`）
- 用 badge 展示各角色的 provider + model

### 3.4 折叠区块交互优化

**现状**: 每次折叠/展开都调用 `renderTabContent()` 销毁重建整个 DOM，导致闪烁。

**改善**:
- 使用 CSS `display: none` / `display: block` 切换，不重建 DOM
- 或保持重建但在 `toggleSection()` 中只更新折叠区块本身，不重建整个 Tab

### 3.5 增大间距和内边距

**现状**: 设置项行间距紧凑，可折叠区块内部 padding 偏小，整体感觉挤压。

**改善**:
- `.setting-item` 上下 padding 从 `12px` → `16px`
- 卡片内边距从 `16px 20px` → `20px 24px`
- 可折叠区块内边距从 `0 16px` → `0 20px`
- 折叠内容区 padding 从 `8px 0 12px` → `12px 0 16px`
- Tab 条高度增大，每个 Tab item 加 `padding: 10px 20px`
- 卡片间距从 `margin-bottom: 16px` → `margin-bottom: 20px`

### 3.6 统一 Section Header 样式

**现状**: 多种 header 样式混用（`h3`、`h4`、`h5`、自定义 div）。

**改善**:
- Tab 标题用 `h3`
- 分组标题用卡片 header
- 角色名用统一的折叠 header 样式

---

## 4. 代码结构

### 4.1 文件拆分

**现状**: `setting-tab.ts` 1474 行单体类。

**改善**: 按职责拆分为独立渲染函数，保持主类只做 Tab 路由。

```
src/settings/
├── setting-tab.ts          # 主类（Tab 路由 + 共享状态）~200行
├── sections/
│   ├── llm-section.ts      # AI 服务 Tab 渲染（快速配置 + 摘要 + 高级）
│   ├── model-section.ts    # 模型配置 Tab 渲染（角色分配）
│   ├── reading-section.ts  # 阅读模式 Tab 渲染
│   ├── profile-section.ts  # 用户画像 Tab 渲染
│   └── general-section.ts  # 通用 Tab 渲染
├── components/
│   ├── collapsible.ts      # 可折叠区块组件
│   ├── role-card.ts        # 角色配置卡片组件
│   └── provider-card.ts    # 服务商账号卡片组件
└── settings.css            # 不变
```

### 4.2 共享状态传递

主类通过方法参数传递所需依赖，不使用全局状态：

```typescript
interface SectionContext {
  plugin: DeepPDFPlugin;
  containerEl: HTMLElement;
  expandedSections: Set<string>;
  toggleSection(id: string): void;  // 局部刷新，不重建整个Tab
}
```

---

## 5. 代码风格

- 保持 Obsidian Setting API 的使用模式（`new Setting(container).setName().addToggle()`）
- CSS class 命名保持 `deeppdf-` 前缀
- 主布局从左右分栏改为上下结构（横向 Tab + 内容区）
- TypeScript strict mode，不使用 `any`（消除现有 `as any` 转型）
- 函数式组件：每个 section 是导出函数 `export function renderXxxSection(ctx: SectionContext): void`

---

## 6. 测试策略

- 不写 UI 测试（Obsidian 插件 UI 难以在 Node.js 环境测试）
- 验证方式：手动测试 + `npm run build` 编译通过
- 重点验证：
  - Tab 切换不丢失展开状态
  - 设置值修改后立即保存
  - 折叠/展开不闪烁
  - 响应式布局（窄屏水平 Tab 条）

---

## 7. 边界

### 必须做
- 重组 Tab 布局（5 → 5 Tab，但内容重新分配）
- 拆分 setting-tab.ts 为多个文件
- 优化折叠/展开交互（不重建整个 DOM）
- 每个 Tab 加图标

### 先问再做
- 是否保留「切换方案」按钮（会清空当前配置重新走快速配置）
- 折叠区块的默认展开策略（核心角色默认展开？）

### 不做
- 不新增设置项（Langsmith、HITL、autoTTS 等缺失项另开任务）
- 不引入新依赖（不用 React/Svelte 等框架）
- 不改 CSS 预处理器（保持原生 CSS）
- 不改 DeepPDFSettings 接口
- 不改设置持久化逻辑

---

## 8. 实施计划

### Phase 1: 代码拆分（无功能变更）
- 提取 `components/collapsible.ts`
- 提取 `components/role-card.ts`
- 提取 `components/provider-card.ts`
- 提取各 section 文件
- 主类只保留 Tab 路由
- 验证: build 通过，功能不变

### Phase 2: 信息架构重组
- 重新分配 Tab 内容（模型配置 / 通用 / 阅读分离）
- 更新 Tab 名称和图标
- 验证: 所有设置项可找到

### Phase 3: 视觉打磨
- 角色 header 显示配置摘要
- 配置摘要卡片加状态标签
- 统一 header 样式
- 折叠交互优化（CSS 切换代替 DOM 重建）
- 验证: 手动测试各 Tab
