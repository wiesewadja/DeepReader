# 拆分 ReadingModeService 上帝对象

## 问题描述

`src/components/reading-mode/reading-mode-orchestrator.ts` 中的 `ReadingModeService` 类是当前代码库最典型的**上帝对象**：

- **1,427 LOC**，约 **50 个公共方法**，同时承担 5+ 类职责：分页（含 scrolling 降级）、章节识别、翻章、选区/划线、聊天协调（奚童悬浮球 + 移动端 Fab）、移动端 navbar、顶栏/书籍检测、事件接线、页码记忆持久化。
- 分页器 `PagePaginator`（839 LOC）已先行抽出，但其余职责仍堆在同一类里。
- 构造签名 `constructor(app, callbacks, pluginId)`（L102-110）本身已是窄依赖注入、**不持有 plugin 引用**——拆分基础良好，问题在于类内部未按职责分层。

**根因**：长期增量开发，新职责（聊天悬浮球、移动端适配、blockId 跳转、页码记忆）持续塞进同一个类，缺少"抽到子模块"的纪律。

**代价**：
1. 单文件改动回归面巨大（任意一行变更都可能影响阅读模式整体）；
2. 单测极难写（方法高度依赖 `app` / DOM / 事件，无法隔离）；
3. 并行开发冲突频繁（多人改同一文件）；
4. 新人上手成本高（需通读 1,400 行才敢动）。

## 目标架构

把 `ReadingModeService` 拆为 **1 个 facade（Shell）+ 5 个深模块**。每个深模块：窄接口、复杂实现、单一职责。Shell 退化为生命周期编排器 + 稳定公共面 + `ScrollPatchService` 契约实现。

```
                    ReadingModeShell  (facade, 保留 activate/deactivate/start/stop + 稳定公共面)
                    implements ScrollPatchService
                   /        |         |         |          \
        PageMemoryStore  ChapterDetection  ChapterNavigator  PaginationCoordinator  ChatWidgetCoordinator
        (零 DOM)          (Obs-API)        (Obs-API)          (DOM 重耦合)            (DOM 重耦合)
                  \            \______________|_________________/
                   └─────────── 共享 ReadingModeContext（见下）──────────┘
```

### 模块 1：PageMemoryStore（纯逻辑 + 持久化，零 DOM）
- **职责**：页码记忆的读写、淘汰、落盘。
- **迁入方法**：`loadLastPagesFromDisk`、`recordPage`、`scheduleSave`、`flushSave`、`findMostRecentInFolder`、`getBookLastReadTime`、`openMostRecent`；字段 `pageMemory / lastReadAt / _saveTimer / _pluginId`。
- **依赖**：`app`（取 vault 路径）、`pluginId`。
- **接口草图**：`recordPage(fp, page)`、`flushSave(): Promise<void>`、`findMostRecentInFolder(fp)`、`getBookLastReadTime(fp)`、`openMostRecent(): Promise<boolean>`。
- **价值**：纯逻辑、确定性、可 100% 单测覆盖——**优先抽，风险最低、测试收益最高**。

### 模块 2：ChapterDetection（Obs-API，纯逻辑为主）
- **职责**：章节文件判定与导航信息计算（含 MOC 排除）。
- **迁入方法**：`isChapterFile`、`getBookNameFromFile`、`extractChapterName`、`getChapterNavigation`。
- **依赖**：`app`。
- **接口草图**：`isChapterFile(file): boolean`、`getChapterNavigation(): ChapterNavigation | null`、`getBookNameFromFile(file): string`。

### 模块 3：ChapterNavigator（Obs-API）
- **职责**：翻章动作。
- **迁入方法**：`navigateToPrev`、`navigateToNext`、`openFile`；字段 `_jumpToLastPage`（跨模块共享态，见风险 R2）。
- **依赖**：`ChapterDetection` + 回调 `onStopReadingTTS`。
- **接口草图**：`navigateToPrev(): Promise<boolean>`、`navigateToNext(): Promise<boolean>`。

### 模块 4：PaginationCoordinator（DOM 重耦合，最大模块）
- **职责**：分页器生命周期 + scrolling 降级 + blockId 路由 + scroll-patch 对接。
- **迁入方法**：`waitForRenderAndInitPaginator`、`getPageParagraphs`（含 scrolling 降级分支 L162-178）、`highlightElement`（含降级 L190-194）、`clearHighlight`（含降级 L205-209）、`nextPage`、`isDualPageMode`、`scrollToElementInColumn`、`jumpToBlockId`、`setupHashChangeHandler`、`teardownHashChangeHandler`、`getDualPageMetrics`、`paginator` 引用、`installScrollPatch/uninstallScrollPatch` 调用。
- **依赖**：`activeContainerEl`、`currentFile`、`style`、回调 `navigateToPrev/Next`、`recordPage`、`getChapterNavigation`。
- **说明**：`PagePaginator` 已完整封装分页模式（页码/双页/控制栏 DOM/监听/高亮/翻页），本模块对 paginated 分支是**委托**，对 scrolling 分支是**自有逻辑**，二者都迁入此模块统一管理。

### 模块 5：ChatWidgetCoordinator（DOM 重耦合）
- **职责**：奚童悬浮球 + 移动端 Fab + 聊天态 + 移动端 navbar 显隐。
- **迁入方法**：`updateXitongWidgetVisibility`、`notifyChatStarted`、`notifyChatReplyReceived`、`clearChatThinking`、`setXitongReading`、`setFabUnread`、`initMobileFab`、`toggleMobileNavbar`；字段 `xitongWidget / mobileFab / isChatThinking / hasUnreadChatReply / lastSidebarOpen`。
- **依赖**：`app`、`activeContainerEl`、回调 `onQuickQuestion / onRevealSidebar`。
- **接口草图**：`notifyChatStarted()`、`notifyChatReplyReceived()`、`clearChatThinking()`、`setXitongReading(reading)`、`updateVisibility()`。

### 模块 6：ReadingModeShell（facade，保留）
- **保留**：`activate / deactivate / start / stop`、`setStyle / setAutoEnable / setCallbacks`、`switchToReadingView`、CSS 类增删与作用域、`notifyBookDetected`、`initChapterNav / initSelectionToolbar`（SelectionToolbar 生命周期仍由 shell 管，它已是独立类）、全部 Accessor（`getCurrentFile / getCurrentIndexId / getActiveContainerEl / getPaginator / getStyle / getAutoEnable`）、字段 `isActive / currentFile / activeContainerEl / style / autoEnable / app / callbacks`。
- **必须继续 `implements ScrollPatchService`**（见风险评估 CRITICAL），否则 `scroll-patch.ts` 断链。

### 选区（SelectionToolbar）
`initSelectionToolbar` / `markExcerpt` 属选区职责。建议：SelectionToolbar 生命周期留在 shell（已是独立类，shell 只管创建/销毁）；`markExcerpt`（L1274）经 grep 全仓无调用者，**确认为死码**，不在拆分范围强制处理，可在 Phase 0 一并删除（见死码清单）。

## 共享上下文 ReadingModeContext

为避免每个子模块各自持有整个 plugin / 重复私有共享态，Shell 构造一个共享上下文传给各子模块：

```typescript
interface ReadingModeContext {
  app: App;
  callbacks: ReadingModeCallbacks;        // 裁剪后的稳定子集
  pluginId: string;
  // 共享可变态（必须集中，不可各模块私存副本）
  currentFile: TFile | null;
  isActive: boolean;
  style: "paginated" | "scrolling";
  activeContainerEl: HTMLElement | null;
  // 跨模块钩子
  getChapterNavigation(): ChapterNavigation | null;  // 来自 ChapterDetection
  navigateToPrev(): Promise<boolean>;               // 来自 ChapterNavigator
  navigateToNext(): Promise<boolean>;
  recordPage(fp: string, page: number): void;       // 来自 PageMemoryStore
  onStopReadingTTS(): void;                         // 回调转发
  jumpToLastPage: boolean;                          // 跨章回退标记（R2）
}
```

> 设计取舍：用单一 `ReadingModeContext` 而非"每模块直接拿 plugin"。理由——保持子模块窄依赖、避免重现上帝对象耦合；`currentFile/isActive/style/activeContainerEl/jumpToLastPage` 这些本就跨模块共享的可变态集中管理，杜绝各副本不一致。

## 稳定公共面（必须保留）

以下方法被 `main.ts / sidebar-view / tts-* / library-view / agent-chat-controller` 外部调用，**重构后必须由 Shell facade 继续公开（直接委托子模块）**，否则上述调用方全断：

| 方法/字段 | 外部调用方 |
|---|---|
| `setAutoEnable` / `setStyle` / `start` / `stop` | `main.ts` |
| `getCurrentIndexId` | `main.ts`、`sidebar-view` 委派 |
| `clearHighlight` / `highlightElement` / `nextPage` | `sidebar-view` |
| `getPageParagraphs` | `sidebar-view`、`tts-controller`、`tts-domain` |
| `getCurrentPage` / `isDualPageMode` | `sidebar-view`、`tts-controller`、`tts-domain` |
| `openMostRecent` | `sidebar-view` |
| `getBookLastReadTime` / `findMostRecentInFolder` | `library-view` |
| `clearChatThinking` / `notifyChatStarted` / `notifyChatReplyReceived` | `agent-chat-controller`、`session-domain` |
| `setXitongReading` | `tts-controller`、`tts-domain` |
| `scrollToElementInColumn` | `scroll-patch.ts`（经 `ScrollPatchService`） |

## 实施计划

> 按本项目约定（AGENTS.md）：每个重要改动进 `.worktrees/<branch>` 独立分支，完成后由测试工程师代理跑测试再合并。每阶段：**抽模块 → Shell 委托 → 跑 L1/L2/L3 → 合入分支**。全程**行为零变更**。

- **Phase 0 — 防护与死码确认**
  - 补契约测试覆盖 `activate → deactivate` 与翻页（保行为等价基线）。
  - 确认死码：`markExcerpt`（已确认无用）、`setFabUnread` / `getViewContent` / `setCallbacks`（grep 无外部调用，待 Phase 0 确认；确认无用则删除）。
- **Phase 1 — 抽 PageMemoryStore**（最低风险、最高测试收益）
  - 抽出纯逻辑模块；Shell 保留 `flushSave` 等公开方法并委托。
  - L1 单测：记录/淘汰/持久化/`findMostRecentInFolder`。
- **Phase 2 — 抽 ChapterDetection + ChapterNavigator**
  - 两模块联动（导航依赖识别）；`getChapterNavigation` 经 context 提供给 PaginationCoordinator。
  - L1 单测：`isChapterFile`（MOC 排除、frontmatter）、`getChapterNavigation` 排序。
- **Phase 3 — 抽 ChatWidgetCoordinator**
  - 聊天态 + Fab + 悬浮球 + 移动端 navbar 迁入；Shell 的 `layout-change/resize` handler 回调其 `updateVisibility()`（不可重排到别处）。
- **Phase 4 — 抽 PaginationCoordinator**（最高风险）
  - 迁入分页生命周期 + scrolling 降级 + blockId 路由；`ScrollPatchService` 仍由 Shell 实现（见 CRITICAL）。
  - L2/L3 重点验证：分页翻页、双页、blockId 跳转、scroll-patch。
- **Phase 5 — Shell 瘦身 + 全量验证**
  - Shell 收敛为 facade（目标 < ~400 LOC）；全仓 L1 + L2 + L3 跑绿；外部调用方无变更。

## 测试用例

- **L1 单元**：
  - `PageMemoryStore`：`recordPage` 写入与淘汰、`flushSave` 落盘、`findMostRecentInFolder` 排序、`getBookLastReadTime`。
  - `ChapterDetection`：`isChapterFile`（路径 `DeepReader/` + frontmatter `source/book/pdf_name` + 排除 `pdf-moc/epub-moc`）、`extractChapterName` 去编号正则、`getChapterNavigation` 同序排序。
- **L2 冒烟**（`npm run smoke:core`）：章节文件 `activate` / `deactivate` / 翻页不报错。
- **L3 轻量 E2E**（`npm run e2e-light`）：
  - 分页翻页 + 双页模式 + `scrollToElementInColumn`（blockId 跳转经 `ScrollPatchService`）。
  - 章节前/后翻（`navigateToPrev/Next`，含 `_jumpToLastPage` 跨章末页恢复）。
  - 聊天悬浮球可见性随右边栏开合变化；移动端 navbar 在 activate 时隐藏。
  - `deactivate` 后页码记忆被 `recordPage` 写入、下次 `activate` 恢复。

## 风险评估

- **CRITICAL — `ScrollPatchService` 契约**：`ReadingModeService implements ScrollPatchService`（L57），`activate` 中 `installScrollPatch(this)`（L422）把自身实例塞进 `scroll-patch.ts` 的全局 `activeServices` 集合，按 `isActive / activeContainerEl / scrollToElementInColumn` 路由 blockId 跳转。**重构后必须仍由同一个满足契约的实例提供这三个成员**。建议：Shell 继续 `implements ScrollPatchService`，`scrollToElementInColumn` 内部委托 `PaginationCoordinator`；切勿把契约转移给会被频繁重建的子模块实例。
- **HIGH — `activate` 顺序约束**：CSS 类添加 + `switchToReadingView()` → `setTimeout(200)` 后 `waitForRenderAndInitPaginator`；`installScrollPatch` / `setupHashChangeHandler` 仅 paginated 模式启用（L408-426）。子模块初始化顺序必须与现有一致。
- **MEDIUM**：
  - R1 `waitForRenderAndInitPaginator` 构造 `PagePaginator` 时把 `navigateToPrev/Next`、`getChapterNavigation`、`recordPage` 作为回调注入——分页器初始化同时耦合翻章/识别/持久化，须经 context 满足。
  - R2 `_jumpToLastPage` 由 `ChapterNavigator.navigateToPrev` 写、由 `PaginationCoordinator` 读 → 必须放 `ReadingModeContext` 共享态。
  - R3 聊天共享态 `isChatThinking / hasUnreadChatReply` 被外部通知方法写、被 `layout-change/resize` 与 `activate` 触发的 `updateXitongWidgetVisibility` 读 → 事件与聊天链路在共享态汇合，`ChatWidgetCoordinator` 自管、但 Shell handler 必须回调它。
  - R4 `setStyle` 内部 `deactivate()+activate()` 牵动全部子模块，必须留在 Shell。
- **LOW — 死码**：`markExcerpt`（已确认）、`setFabUnread / getViewContent / setCallbacks`（待确认）。确认无用则删除，不在拆分范围强制处理。

## 预期效果 / 完成定义（DoD）

- `reading-mode-orchestrator.ts`（Shell）收敛至 **< ~400 LOC**；每个子模块 **< ~400 LOC**。
- 行为零回归：全部外部调用方（`main.ts` 等）保持绿，无接口签名变更。
- 测试：L1（纯逻辑模块高覆盖）+ L2 + L3 全绿。
- 类型卫生：拆分过程**不新增 `any`**；公开 API 签名类型完整。
- 无未确认死码遗留；`ScrollPatchService` 契约由单一稳定实例继续满足。
