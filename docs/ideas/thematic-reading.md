# 主题阅读（Thematic Reading）

## Problem Statement

用户在 DeepReader 中只能以单本书为单位与 AI 对话。当用户围绕某个主题同时阅读多本书时（如塔勒布四部曲），无法在一次对话中跨书提问、比较观点。主题阅读是深度阅读的核心场景，目前被「一次一本」的架构限制住了。

## Recommended Direction

采用渐进式策略：V1 实现「书签堆」（多选书籍 → 一次性跨书对话），数据模型和 API 按「书架分组」设计，为 V2 持久化书单预留升级路径。

V1 的核心交互：用户在书架工具栏点击「主题阅读」按钮 → 书架进入多选模式，卡片出现勾选框 → 用户点选 2-5 本书（上限 5 本，满 5 后未选卡片灰掉不可点）→ 底部浮出确认栏显示「已选 N 本 · 开始主题阅读」→ 点击确认后侧边栏 Topbar 切换为书单模式（文字列表展示成员书名 + 书单名称）→ 进入跨书对话模式，AI 在用户指定的书单范围内进行 Syntopical 分析。

V2 在 V1 基础上增加：书架支持创建命名分组（如「塔勒布四部曲」「认知偏差」），分组持久化，可反复进入同一个主题阅读会话，封面堆叠 UI。

## 现状审查：底层能力的真实状态

Syntopical 节点和跨书模式的基础设施**部分存在**，但有几处关键缺口需要补齐：

### 已就绪
- LangGraph S3 Syntopical 节点：可执行多书融合分析，LLM prompt + 结果格式完整
- `syntopicalSearch()`：并行搜索所有已索引书籍，按相关性排序取 top 5
- `ReadingTopbar.setCrossBookMode()`：存在但只改两个文字（"跨书籍阅读" / "多本书籍"）
- `SearchFilters.booklists` 类型已定义，`SessionManager` 内部已追踪
- `SessionManager.switchToCrossBookMode()`：存在，可切换模式 + 清理消息 + 显示欢迎语

### 需要补齐（V1 必须做的改动）
1. **`syntopicalSearch()` 没有范围过滤** — 当前扫描所有 `.pageindex/` 书籍，按相关性选 top 5。书单的核心价值是**约束搜索范围到用户指定的几本书**，需要给 `syntopicalSearch()` 加 `bookIds?: string[]` 参数
2. **Router 进入 Syntopical 的条件过严** — 需要「关键词 + LLM depth≥2」双条件。书单模式下应跳过关键词检测，直接允许 Syntopical 路由
3. **数据传递链路不存在** — 书单信息需要从 BooklistStore → AgentChatController → configurable → syntopicalSearch()，当前完全没有这条通路
4. **BookManager 是单书状态模型** — `_currentIndexId` 等全是单值，需要增加「当前书单」状态和模式切换
5. **Session 绑定单 indexId** — `startNewSession(indexId: string)` 和 session 匹配逻辑需要适配 booklistId
6. **多书 docDescription** — 当前从单本书笔记读 `## 📝 全书摘要`，多本书需要合并

## Key Assumptions to Validate

- [ ] 用户同时阅读的相关书籍数量在 2-5 本范围内——可通过 V1 使用数据验证
- [ ] 约束搜索范围（只搜书单内的书）比全库搜索的质量明显更好——A/B 测试
- [ ] 用户能理解「跨书对话」与「单书对话」的切换——Topbar 视觉变化是否足够清晰
- [ ] 不需要主题阅读方法论引导（如 Adler 五步法）——V1 先观察，如用户困惑再 V2 加

## MVP Scope (V1)

### In
1. **数据模型**: `Booklist` 接口（id, name, bookIds, createdAt）+ `InMemoryBooklistStore`
2. **书架多选模式**: LibraryView 工具栏增加「主题阅读」按钮，点击后进入多选模式——卡片出现勾选框，最多勾选 5 本（满 5 后未选卡片灰掉），底部浮出确认栏（已选 N 本 · 开始主题阅读 · 取消）
3. **Topbar 书单模式**: ReadingTopbar 新增 `setCurrentBooklist(booklist)` 方法，V1 用文字列表展示书单成员（如「3本：反脆弱、随机漫步、黑天鹅」），不做封面堆叠
4. **BookManager 模式切换**: 新增 `selectBooklist(booklist)` 方法，内部记录 `_currentBooklist` 状态，与 `_currentIndexId` 互斥
5. **Session 适配**: SessionManager 的 `startNewSession()` 支持 booklistId 作为 session 标识，`saveToCache()` / `restoreFromSessionStore()` 的 indexId 匹配逻辑适配
6. **syntopicalSearch 范围过滤**: `syntopicalSearch()` 新增 `bookIds?: string[]` 参数，传入时只搜索指定书籍
7. **数据传递链路**: `activeBooklistId` 通过 configurable → `SharedContext`（或新字段）→ Syntopical 节点
8. **Router 书单模式感知**: 书单模式下跳过关键词检测，直接允许 Syntopical 路由
9. **退出机制**: Topbar 展示退出按钮或点击书单名称可切回单书模式

### Out
- 封面堆叠 UI → V2 视觉优化
- 书架分组管理 UI（创建/编辑/删除分组）→ V2
- 书单持久化存储 → V2
- 书单分享/导出 → 不做
- 主题阅读方法论引导 → 不做，观察后再定
- AI 推荐分组（基于内容相似度）→ 不做

## Not Doing (and Why)

- **AI 推荐分组** — 用户明确选择了纯手动，且 AI 分组需要 embedding 相似度计算，V1 不值得投入
- **主题 MOC / 综合笔记生成** — 用户明确表示不需要显式成果物，对话体验即成果
- **阅读进度跟踪扩展到书单维度** — 书单级的「读了多少」在 V1 不必要，单书进度已够
- **书单内排序/推荐阅读顺序** — 增加复杂度，V1 不需要
- **拖拽交互** — 书架卡片拖拽进分组是 V2 的交互，V1 用点击多选足够
- **封面堆叠 UI** — V1 用文字列表即可验证核心交互，封面堆叠是视觉锦上添花，放 V2

## V2 预留设计

数据模型从一开始就按书架分组设计，V1 只是用内存实现的子集：

```typescript
interface Booklist {
  id: string;           // booklist-{timestamp}
  name: string;         // V1 默认 "{N}本书的跨书对话"，V2 用户自定义
  bookIds: string[];    // IndexListItem.id 数组
  createdAt: string;
  updatedAt?: string;
}

interface BooklistStore {
  create(name: string, bookIds: string[]): Booklist;
  get(id: string): Booklist | null;
  list(): Booklist[];
  update(id: string, changes: Partial<Booklist>): Booklist;
  delete(id: string): void;
}
```

V1 实现 `InMemoryBooklistStore`，V2 替换为 `PersistedBooklistStore`（JSON 文件或 settings 字段）。上层代码无需改动。

## 改动影响面

### 涉及的文件和改动类型

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `src/views/library-view.ts` | 修改 | 工具栏「主题阅读」按钮、多选模式状态机、卡片勾选框、底部确认栏 |
| `src/views/library-view.css` | 修改 | 多选模式样式：勾选框、选中态、底部确认栏浮动 |
| `src/components/reading-topbar/reading-topbar.ts` | 修改 | 新增 `setCurrentBooklist()` + 退出按钮 |
| `src/components/reading-topbar/reading-topbar.css` | 修改 | 书单模式样式 |
| `src/views/sidebar/book-manager.ts` | 修改 | 新增 `_currentBooklist` 状态 + `selectBooklist()` + `loadMultipleIndexes()` |
| `src/views/sidebar/session-manager.ts` | 修改 | session 适配 booklistId |
| `src/views/sidebar/sidebar-host.ts` | 修改 | host 接口增加 booklist 相关方法 |
| `src/views/sidebar/sidebar-view.ts` | 修改 | 串联 booklist 选择到各控制器 |
| `src/agent/utils/syntopical-search.ts` | 修改 | `syntopicalSearch()` 增加 `bookIds` 过滤参数 |
| `src/agent/graph/nodes/router.ts` | 修改 | 书单模式下跳过关键词检测 |
| `src/agent/graph/shared-context.ts` | 修改 | 新增 `activeBooklistId` / `booklistBookIds` 字段 |
| `src/agent/graph/nodes/syntopical.ts` | 修改 | 从 configurable 读取 bookIds 并传给 syntopicalSearch |
| `src/views/sidebar/agent-chat-controller.ts` | 修改 | 构建 configurable 时传入 booklist 信息 |
| `src/types/index.ts` | 新增 | `Booklist` 接口 + `BooklistStore` 接口 |
| 新文件 `src/stores/booklist-store.ts` | 新建 | `InMemoryBooklistStore` 实现 |

### 不需要改动的部分
- LangGraph 图结构（节点/边定义不变）
- Syntopical prompt 模板（输入格式不变，只是搜索范围缩小）
- 书籍索引/嵌入系统
- 阅读进度跟踪
- TTS/引用管理
- 微信读书同步

## Open Questions

- 多书索引同时加载时的内存/性能上限是多少？5 本？10 本？
- Syntopical 节点的 prompt 是否需要调整以适配「用户主动选书」vs「AI 被动判断需要跨书」？（当前 prompt 假设用户问了跨书问题，书单模式下用户可能问简单问题）
- 书签堆的「书单名称」是让用户输入还是自动生成（如「3本书的跨书对话」）？建议 V1 自动生成
- 跨书 session 的聊天记录是否需要标记每条消息涉及的书籍？
- 书单模式下，用户的当前阅读章节（ContextManager 追踪的）如何处理？是否需要多书章节上下文？
