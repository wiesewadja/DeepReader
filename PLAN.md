# 实现方案：微信读书功能增强

## 概览

将 weread 插件的核心功能融入 DeepReader，提升微信读书集成的完整性和用户体验。

## Spec 拆分

- **Spec 1**（当前）：同步体验 + 划线视图 + UI 优化 → 详见 `SPEC-1.md`
- **Spec 2**（后续）：模板系统 + 数据展示 + 功能扩展 → 详见 `SPEC-2.md`

## 架构决策

1. **API 层复用** — 继续使用现有的 `WereadApiClient` 网关模式，新增热门划线 API
2. **模板系统** — 引入 Nunjucks 模板，支持 3 内置主题 + 用户自定义
3. **缓存策略** — 热门划线使用文件缓存，TTL 7 天
4. **定时同步** — 利用 Obsidian 插件生命周期，支持可配置间隔

## 当前状态

### 已有功能
- API Key 认证 + 验证
- 笔记同步（高亮、笔记、章节）
- 高亮导入到章节文件
- 书架匹配（title-author）
- 5 个 AI 工具
- 基本设置界面

### 缺失功能
- 定时自动同步
- 同步日志
- 热门划线
- 模板系统
- 阅读统计文档
- Daily Notes 集成

---

## 任务列表

### 阶段 1：同步体验增强

#### 任务 1：定时自动同步

**描述：** 实现可配置间隔的定时同步功能，在插件加载时启动定时器。

**验收条件：**
- [ ] 设置中可配置同步间隔（5/10/15/30/60 分钟）
- [ ] 插件加载时自动启动定时同步
- [ ] 插件卸载时清除定时器
- [ ] 同步过程中显示进度通知

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 测试通过：npm run test:run
- [ ] 手动检查：Obsidian 中启用插件，等待定时同步触发

**依赖：** 无

**涉及文件：**
- src/config/settings.ts（新增设置项）
- src/main.ts（启动定时器）
- src/weread/sync/scheduled-sync.ts（新增）

**参考 weread 插件：**
- `main.ts:467-499` — `setupScheduledSync()` 定时同步实现
- `settings.ts:86-87` — `scheduledSyncToggle/scheduledSyncInterval` 设置项

**预估范围：** S

---

#### 任务 2：同步日志持久化

**描述：** 记录每次同步的结果，包括时间、数量、成功/失败状态，持久化到设置中。

**验收条件：**
- [ ] 同步完成后自动记录日志
- [ ] 日志包含：时间戳、同步数量、成功/失败、错误信息
- [ ] 设置页可查看最近 10 条同步日志
- [ ] 日志超过 10 条自动清理旧的

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 测试通过：npm run test:run
- [ ] 手动检查：执行同步后查看设置页日志

**依赖：** 无

**涉及文件：**
- src/weread/types.ts（新增 SyncLogEntry 类型）
- src/config/settings.ts（新增 syncLogs 字段）
- src/weread/sync/sync-engine.ts（同步后记录日志）
- src/settings/sections/weread-section.ts（显示日志）

**参考 weread 插件：**
- `models.ts:519-529` — `SyncLogEntry` 类型定义
- `settings.ts:95-98` — `syncLogs` 字段和 `addSyncLog` 方法
- `syncNotebooks.ts:145-156` — 同步日志记录逻辑

**预估范围：** S

---

#### 任务 3：同步进度通知优化

**描述：** 优化同步进度的 UI 展示，使用更清晰的进度条和状态提示。

**验收条件：**
- [ ] 同步过程中显示进度条
- [ ] 显示当前同步的书籍名称
- [ ] 同步完成后显示汇总信息
- [ ] 失败时显示错误提示

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：执行同步观察进度 UI

**依赖：** 任务 1

**涉及文件：**
- src/weread/sync/sync-engine.ts（emitProgress）
- src/settings/sections/weread-section.ts（进度 UI）

**参考 weread 插件：**
- `syncNotebooks.ts:84-103` — 进度条 DOM 构建和更新
- `syncNotebooks.ts:158-170` — 同步完成状态显示
- `style.css` — `.weread-notice-progress` 样式

**预估范围：** S

---

### 检查点：同步体验

- [ ] 定时同步功能正常
- [ ] 同步日志正确记录
- [ ] 进度通知显示正常
- [ ] 请用户确认后再继续

---

### 阶段 2：划线视图增强

#### 任务 4：热门划线 API 集成 + 渲染格式统一

**描述：** 新增热门划线 API 调用能力，并统一渲染格式保持与 ExcerptService 一致。

**验收条件：**
- [ ] WereadApiClient 新增 getBestBookmarks 方法
- [ ] 支持按章节获取热门划线
- [ ] 返回格式与 weread 插件兼容
- [ ] 热门划线渲染使用 `> [!quote]+ 🔥 热门划线` 格式
- [ ] 用户划线 + 热门使用 `> [!quote]+ 📌🔥 高亮` 组合格式
- [ ] 保留 `^blockId` 用于双向链接

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 测试通过：npm run test:run
- [ ] 手动检查：同步后查看笔记文件中的热门划线格式

**依赖：** 无

**涉及文件：**
- src/weread/api/client.ts（新增方法）
- src/weread/types.ts（新增类型）
- src/weread/render/markdown-renderer.ts（渲染热门划线）

**参考 weread 插件：**
- `api-v2.ts:88-101` — `getBestBookmarks()` 方法
- `api-router.ts:164-211` — 批量获取逻辑
- `themes/notebookTemplate.njk:18-61` — 热门划线渲染模板
- `syncNotebooks.ts:226-288` — 热门划线合并逻辑

**UI 统一规范：**
- callout 类型：`[!quote]`（与 ExcerptService 高亮一致）
- 颜色 emoji：🟡🔴🟠🟢🔵🩷（与 ExcerptService 一致）
- 热门标记：`🔥`（新增，与 weread 一致）
- 用户标记：`📌`（与 weread 一致）
- blockId：`^bookmarkId`（用于双向链接）

**预估范围：** M

---

#### 任务 5：热门划线缓存

**描述：** 实现热门划线的文件缓存，避免重复 API 调用。

**验收条件：**
- [ ] 缓存存储在 .weread-cache/ 目录
- [ ] 缓存 TTL 默认 7 天
- [ ] 缓存命中时直接读取，不调用 API
- [ ] 支持手动清除缓存

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：同步后查看缓存文件

**依赖：** 任务 4

**涉及文件：**
- src/weread/cache/popular-highlights-cache.ts（新增）
- src/config/settings.ts（新增缓存 TTL 设置）

**参考 weread 插件：**
- `popularHighlightsCache.ts` — 完整缓存实现
- `settings.ts:108` — `popularHighlightsCacheTtl` 设置项
- `models.ts:619-630` — `PopularHighlightCache` 类型

**预估范围：** S

---

#### 任务 6：同步引擎集成热门划线

**描述：** 在同步引擎中集成热门划线获取和合并逻辑。

**验收条件：**
- [ ] 同步时获取热门划线（缓存优先）
- [ ] 热门划线合并到高亮列表
- [ ] 设置中可开关热门划线同步
- [ ] 热门划线数据保存到 syncState

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：同步后查看笔记文件中的热门划线

**依赖：** 任务 4, 任务 5

**涉及文件：**
- src/weread/sync/sync-engine.ts（同步热门划线）
- src/weread/types.ts（扩展 Highlight 类型）
- src/config/settings.ts（新增开关）

**参考 weread 插件：**
- `syncNotebooks.ts:226-288` — 热门划线合并逻辑
- `models.ts:389-405` — `Highlight` 类型扩展（isPopular, popularCount）

**预估范围：** M

---

### 检查点：划线视图

- [ ] 热门划线正确获取和缓存
- [ ] 笔记文件中热门划线显示正常
- [ ] 热门划线格式与 ExcerptService 统一（`[!quote]+ 🔥`）
- [ ] 用户划线 + 热门组合格式正确（`📌🔥`）
- [ ] blockId 保留用于双向链接
- [ ] 请用户确认后再继续

---

### 阶段 3：模板系统

#### 任务 7：模板引擎集成

**描述：** 集成 Nunjucks 模板引擎，支持自定义笔记渲染格式。

**验收条件：**
- [ ] 安装 nunjucks 依赖
- [ ] 实现模板渲染器
- [ ] 支持日期格式化等过滤器

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 测试通过：npm run test:run

**依赖：** 无

**涉及文件：**
- src/weread/render/template-engine.ts（新增）
- package.json（新增依赖）

**参考 weread 插件：**
- `renderer.ts` — 完整 Nunjucks 渲染器实现
- `renderer.ts:6-50` — 日期格式化等过滤器

**预估范围：** M

---

#### 任务 8：内置模板

**描述：** 实现 3 个内置模板：合并式、分离式、官方风格。

**验收条件：**
- [ ] 合并式模板（划线 + 想法 inline）
- [ ] 分离式模板（划线在前，想法在后）
- [ ] 官方风格模板（详细元数据）
- [ ] 默认使用合并式模板

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：切换模板后同步查看效果

**依赖：** 任务 7

**涉及文件：**
- src/weread/render/templates/（新增目录）
- src/weread/render/markdown-renderer.ts（重构）

**参考 weread 插件：**
- `themes/notebookTemplate.njk` — 合并式模板
- `themes/separatedTemplate.njk` — 分离式模板
- `themes/wereadOfficialTemplate.njk` — 官方风格模板
- `settings.ts:20-51` — `BUILT_IN_THEMES` 定义

**预估范围：** M

---

#### 任务 9：模板配置 UI

**描述：** 在设置页实现模板选择和自定义编辑功能。

**验收条件：**
- [ ] 下拉选择内置模板
- [ ] 支持复制内置模板为自定义模板
- [ ] 支持编辑自定义模板
- [ ] 支持预览模板效果

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：设置页模板选择和编辑

**依赖：** 任务 7, 任务 8

**涉及文件：**
- src/settings/sections/weread-section.ts（模板 UI）
- src/config/settings.ts（模板配置）

**参考 weread 插件：**
- `components/themeManagerModal.ts` — 主题管理模态框
- `components/templateEditorWindow.ts` — 模板编辑器
- `settingTab.ts` — 设置页实现

**预估范围：** M

---

### 检查点：模板系统

- [ ] 模板切换正常工作
- [ ] 自定义模板可保存和编辑
- [ ] 请用户确认后再继续

---

### 阶段 4：UI 优化（对齐 weread 风格）

#### 任务 10：书架卡片 UI 重设计

**描述：** 将书架卡片从网格布局改为列表式布局，对齐 weread 插件的视觉风格。

**验收条件：**
- [ ] 卡片圆角从 `8px` 改为 `12px`
- [ ] 封面圆角从 `4px` 改为 `8px`
- [ ] 封面尺寸固定为 `88px x 120px`
- [ ] 标签样式改为 pill 形状 (`border-radius: 999px`)
- [ ] 图标按钮改为圆形 (`border-radius: 50%`)
- [ ] 卡片 hover 效果 (`background: var(--background-modifier-hover)`)
- [ ] 封面添加 hover 效果（微浮起）

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：书架视图显示效果与 weread 一致

**依赖：** 无

**涉及文件：**
- src/views/library-view.css（样式重写）
- src/views/library/library-card-builder.ts（结构调整）

**参考 weread 插件：**
- `style.css:1415-1465` — `.weread-bookshelf-card` 卡片样式
- `style.css:1433-1457` — 封面样式
- `style.css:1488-1500` — 标签样式
- `style.css:1510-1530` — 图标按钮样式

**预估范围：** M

---

#### 任务 11：进度条和动画优化

**描述：** 优化进度条样式，添加过渡动画，提升视觉体验。

**验收条件：**
- [ ] 进度条高度从 `6px` 改为 `4px`
- [ ] 进度条圆角从 `3px` 改为 `2px`
- [ ] 添加宽度过渡动画 (`transition: width 0.3s ease`)
- [ ] 同步进度通知使用相同样式

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：进度条动画流畅

**依赖：** 无

**涉及文件：**
- src/views/library-view.css（进度条样式）
- src/settings/sections/weread-section.ts（同步进度样式）

**参考 weread 插件：**
- `style.css:1227-1259` — `.weread-notice-progress` 进度条样式

**预估范围：** S

---

#### 任务 12：响应式布局

**描述：** 使用 Container Queries 实现响应式布局，窄屏时切换为网格布局。

**验收条件：**
- [ ] 使用 `container-type: inline-size`
- [ ] 窄屏 (<600px) 切换为网格布局
- [ ] 封面自适应宽度
- [ ] 工具栏在窄屏时折叠筛选选项

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：调整窗口宽度查看响应式效果

**依赖：** 任务 10

**涉及文件：**
- src/views/library-view.css（响应式样式）

**参考 weread 插件：**
- `style.css:1035-1040` — `.weread-bookshelf-view` container 设置
- `style.css:1556-1631` — 窄屏响应式样式

**预估范围：** M

---

#### 任务 13：书籍摘录 UI 重设计

**描述：** 重设计书籍摘录模态框和笔记展示样式，对齐 weread 书籍详情视图的视觉风格。

**验收条件：**
- [ ] 预览卡片圆角从 `8px` 改为 `6px`
- [ ] 标签样式改为 pill 形状 (`border-radius: 999px`)
- [ ] 添加左侧颜色边线（高亮类型）
- [ ] 按钮样式对齐 weread（`padding: 8px 20px`, `border-radius: 6px`）
- [ ] 摘录内容区域添加 hover 效果
- [ ] 元数据标签使用更小字体 (`12px`)

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：摘录模态框显示效果

**依赖：** 无

**涉及文件：**
- src/components/excerpt/excerpt-modal.css（样式重写）
- src/components/excerpt/excerpt-modal.ts（结构微调）

**参考 weread 插件：**
- `style.css:3882-3914` — `.weread-book-detail-hl-card` 高亮卡片样式
- `style.css:3971-4016` — `.weread-book-detail-note-card` 笔记卡片样式
- `style.css:4018-4050` — `.weread-book-detail-popular-card` 热门划线样式

**UI 统一规范：**
- 卡片圆角：`6px`（与 weread 一致）
- 左侧边线：`3px solid` 颜色边线
- 标签：pill 形状 (`border-radius: 999px`)
- 按钮：`padding: 8px 20px`, `border-radius: 6px`
- 字体大小：正文 `13px`，元数据 `12px`

**预估范围：** M

---

#### 任务 14：书籍详情视图（新增）

**描述：** 新增类似 weread 的书籍详情视图，展示书籍元数据、划线、笔记、热门划线、书评。

**验收条件：**
- [ ] 顶部显示封面、标题、作者、评分、进度
- [ ] Tab 栏切换：划线、笔记、热门划线、书评
- [ ] 划线卡片使用左侧颜色边线
- [ ] 热门划线使用橙色边线 + 🔥 标记
- [ ] 笔记卡片显示引用原文 + 想法
- [ ] 操作按钮：复制、跳转微信读书

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：书籍详情视图显示效果

**依赖：** 任务 13

**涉及文件：**
- src/weread/views/book-detail-view.ts（新增）
- src/weread/views/book-detail-view.css（新增）
- src/main.ts（注册视图）

**参考 weread 插件：**
- `components/wereadBookDetailView.ts` — 完整视图实现
- `style.css:3266-3867` — 视图样式

**预估范围：** L

---

### 检查点：UI 优化

- [ ] 书架卡片样式与 weread 一致
- [ ] 进度条动画流畅
- [ ] 响应式布局正常
- [ ] 摘录模态框样式与 weread 一致
- [ ] 书籍详情视图功能完整
- [ ] 请用户确认后再继续

---

### 阶段 6：数据展示

#### 任务 15：阅读统计文档生成

**描述：** 新增命令生成 Markdown 格式的阅读统计报告。

**验收条件：**
- [ ] 新增命令：微信读书：生成阅读统计
- [ ] 生成包含年度/月度/总体统计的 Markdown
- [ ] 包含阅读时长、天数、偏好分类等
- [ ] 文件保存到配置的目录

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：执行命令后查看生成的文档

**依赖：** 无

**涉及文件：**
- src/main.ts（新增命令）
- src/weread/stats/stats-generator.ts（新增）
- src/config/settings.ts（统计文档目录）

**参考 weread 插件：**
- `syncReadingStats.ts` — 完整统计文档生成实现
- `syncReadingStats.ts:44-278` — `buildMarkdown()` 函数
- `api.ts:495-499` — `getReadingStats()` API 调用

**预估范围：** M

---

#### 任务 16：书架视图增强

**描述：** 增强 library-view 中的微信读书书籍展示，显示封面和进度。

**验收条件：**
- [ ] 显示书籍封面缩略图（使用 `88px x 120px` 尺寸）
- [ ] 显示阅读进度百分比（使用 `4px` 进度条）
- [ ] 显示同步状态标签（`.deeppdf-lib-type-weread`）
- [ ] 显示笔记/评论数量标签（`.deeppdf-lib-type-stat`）
- [ ] 支持按最近阅读排序

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：书架视图显示效果

**依赖：** 任务 10

**涉及文件：**
- src/views/library/library-weread-bridge.ts（增强）
- src/views/library-view.css（样式）

**参考 weread 插件：**
- `components/wereadBookshelf.ts:552-614` — `renderBookCard()` 方法
- `components/wereadBookshelf.ts:680-708` — `renderBadges()` 方法

**预估范围：** M

---

### 检查点：数据展示

- [ ] 统计文档生成正常
- [ ] 书架视图显示正常
- [ ] 书籍详情视图功能完整
- [ ] 请用户确认后再继续

---

### 阶段 7：功能扩展

#### 任务 17：Daily Notes 集成

**描述：** 将当日微信读书笔记自动写入 Daily Note。

**验收条件：**
- [ ] 同步后检查当日有阅读的书籍
- [ ] 将笔记引用写入 Daily Note 指定区间
- [ ] 设置中可开关此功能
- [ ] 设置中可配置写入区间标记

**验证方法：**
- [ ] 构建通过：npm run build
- [ ] 手动检查：同步后查看 Daily Note

**依赖：** 无

**涉及文件：**
- src/weread/sync/daily-notes-writer.ts（新增）
- src/config/settings.ts（新增设置）
- src/main.ts（同步后调用）

**参考 weread 插件：**
- `fileManager.ts:23-57` — `saveDailyNotes()` 方法
- `fileManager.ts:59-71` — `getDailyNotePath()` 方法
- `syncNotebooks.ts:427-449` — `saveToJounal()` 方法
- `settings.ts:57-60` — Daily Notes 相关设置项

**预估范围：** M

---

### 检查点：全部完成

- [ ] 所有功能正常工作
- [ ] 所有测试通过
- [ ] UI 样式与 weread 一致
- [ ] 可提交审查

---

## 风险与应对

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| 热门划线 API 限流 | 中 | 实现缓存，减少调用频率 |
| Nunjucks 包体积 | 低 | 按需引入，tree-shaking |
| 定时同步性能 | 低 | 后台执行，不阻塞 UI |
| 模板兼容性 | 中 | 提供默认模板，向后兼容 |

## 待确认问题

1. 模板系统是否需要支持导出/导入？
2. 阅读统计文档是否需要图表可视化？
3. Daily Notes 写入格式是否有特定要求？
