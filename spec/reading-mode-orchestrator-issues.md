# 拆分 Issues —— ReadingModeService 重构（垂直切片）

> **状态**：spec `reading-mode-orchestrator-split.md` 已定稿（2026-07-06）。
> **约定依据**：`.project-rules/05-conventions.md`（提交类型 / 不自行提交）、`AGENTS.md`（每个重要功能进 `.worktrees/<branch>` + 测试工程师代理验证 + 提交前方案审查）、engineering-workflow `planning-and-task-breakdown`（小原子、可验证、垂直切片）。
> **拆分原则**：每个 Issue 是一个**可独立验证、可独立交付**的垂直切片（一个模块提取 = 一个完整可测单元），行为零变更，合并后外部调用方无感知。

---

## 通用约定

- **分支**：`refactor/reading-mode-<module>`，在 `.worktrees/` 下独立 worktree 实施。
- **提交类型**：`refactor: <subject>`（遵循 `.project-rules/05-conventions.md`，不自行提交，需审查后合入）。
- **门禁（每个 Issue 合入前）**：
  1. L1 单元 + L2 冒烟 + L3 轻量 E2E 全绿（按 spec 测试用例）。
  2. 调用**测试工程师代理**跑对应测试层验证。
  3. 代码审查（五轴：正确性 / 可读性 / 架构 / 安全 / 性能）通过。
- **DoD 模板**：范围完成 / 稳定公共面经 Shell 委托且签名不变 / 测试达标 / 无新增 `any` / 不破坏 `ScrollPatchService` 契约。

---

## I0 — 测试防护网 + 死码清理【前置，不可跳过】

- **Size**: M ｜ **依赖**: 无 ｜ **Branch**: `refactor/reading-mode-test-harness`
- **目标**：建立行为等价基线，移除已确认死码，降低后续切片回归风险。
- **范围**：
  - 补契约测试覆盖 `activate → deactivate` 与翻页主路径（保行为等价基线）。
  - 死码处理：`markExcerpt`（L1274，已确认全仓无调用）直接删除；`setFabUnread` / `getViewContent` / `setCallbacks`（grep 无外部调用，待本 Issue 二次确认）确认无用后一并删除。
- **验收标准**：
  - 新增基线测试可重复运行且不依赖手动 Obsidian 操作。
  - 死码删除后 `npm run build`（tsc -noEmit）通过，无悬空引用。
- **测试**：L1（基线契约测试）+ L2 冒烟。

---

## I1 — Extract PageMemoryStore（纯逻辑，风险最低）

- **Size**: S ｜ **依赖**: I0 ｜ **Branch**: `refactor/reading-mode-pagememory`
- **目标**：抽出页码记忆模块，零 DOM、可 100% 单测。
- **范围（迁入 `src/components/reading-mode/page-memory-store.ts`）**：
  - 方法：`loadLastPagesFromDisk`、`recordPage`、`scheduleSave`、`flushSave`、`findMostRecentInFolder`、`getBookLastReadTime`、`openMostRecent`。
  - 字段：`pageMemory / lastReadAt / _saveTimer / _pluginId`。
  - Shell 保留公开方法并**委托**给 `PageMemoryStore`；构造时注入 `app` + `pluginId`。
- **验收标准**：
  - Shell 仍公开 `flushSave / findMostRecentInFolder / getBookLastReadTime / openMostRecent`，签名不变。
  - `openMostRecent` 行为与原实现逐字节等价（经 L3 验证）。
- **测试**：L1（记录/淘汰/持久化/`findMostRecentInFolder` 全覆盖）+ L2。

---

## I2 — Extract Chapter（Detection + Navigator）

- **Size**: M ｜ **依赖**: I0 ｜ **Branch**: `refactor/reading-mode-chapter`
- **目标**：抽出章节识别与翻章动作（二者强耦合，作为一个垂直切片一次交付，避免半状态）。
- **范围**：
  - `ChapterDetection`（`chapter-detection.ts`）：`isChapterFile`、`getBookNameFromFile`、`extractChapterName`、`getChapterNavigation`（含 MOC 排除）。
  - `ChapterNavigator`（`chapter-navigator.ts`）：`navigateToPrev`、`navigateToNext`、`openFile`；字段 `_jumpToLastPage` 移入共享 `ReadingModeContext`（见 spec 风险 R2）。
  - Shell 委托 `getChapterNavigation / navigateToPrev / navigateToNext`；`getChapterNavigation` 经 `context` 提供给 PaginationCoordinator。
- **验收标准**：
  - 章节判定（路径 `DeepReader/` + frontmatter + MOC 排除）行为等价。
  - `_jumpToLastPage` 跨章末页恢复逻辑不变（经 L3 验证）。
- **测试**：L1（`isChapterFile` / `getChapterNavigation` 排序 / `extractChapterName` 正则）+ L3（翻章前后）。

---

## I3 — Extract ChatWidgetCoordinator

- **Size**: M ｜ **依赖**: I0 ｜ **Branch**: `refactor/reading-mode-chat`
- **目标**：抽出奚童悬浮球 + 移动端 Fab + 聊天态 + 移动端 navbar 显隐。
- **范围（迁入 `chat-widget-coordinator.ts`）**：
  - 方法：`updateXitongWidgetVisibility`、`notifyChatStarted`、`notifyChatReplyReceived`、`clearChatThinking`、`setXitongReading`、`setFabUnread`、`initMobileFab`、`toggleMobileNavbar`。
  - 字段：`xitongWidget / mobileFab / isChatThinking / hasUnreadChatReply / lastSidebarOpen`。
  - Shell 的 `layout-change` / `resize` handler **必须回调** `ChatWidgetCoordinator.updateVisibility()`（不可重排到别处，见 spec 风险 R3）；共享态保留在该 Coordinator，Shell 经 context 暴露必要读取。
- **验收标准**：
  - 聊天悬浮球可见性随右边栏开合变化、移动端 navbar 在 activate 时隐藏——行为等价（L3）。
  - `notifyChatStarted / notifyChatReplyReceived / clearChatThinking / setXitongReading` 公开签名不变（外部 `agent-chat-controller` / `tts-*` 无感知）。
- **测试**：L3（悬浮球可见性 + 移动端 navbar + 聊天态联动）。

---

## I4 — Extract PaginationCoordinator【最高风险】

- **Size**: L ｜ **依赖**: I0 ｜ **Branch**: `refactor/reading-mode-pagination`
- **目标**：抽出分页生命周期 + scrolling 降级 + blockId 路由 + scroll-patch 对接。
- **范围（迁入 `pagination-coordinator.ts`）**：
  - 方法：`waitForRenderAndInitPaginator`、`getPageParagraphs`（含 scrolling 降级分支 L162-178）、`highlightElement`（降级 L190-194）、`clearHighlight`（降级 L205-209）、`nextPage`、`isDualPageMode`、`scrollToElementInColumn`、`jumpToBlockId`、`setupHashChangeHandler`、`teardownHashChangeHandler`、`getDualPageMetrics`、paginator 引用、`installScrollPatch/uninstallScrollPatch` 调用。
  - paginated 分支委托 `PagePaginator`（已封装），scrolling 分支为自有逻辑。
  - **`ScrollPatchService` 契约（CRITICAL）**：`ReadingModeShell` 继续 `implements ScrollPatchService`；`scrollToElementInColumn` 内部委托本 Coordinator，但 `installScrollPatch(this)` 传入的 `this` 必须是 Shell 稳定实例（见 spec 风险评估 CRITICAL）。
- **验收标准**：
  - `activate` 顺序约束满足：CSS 类 + preview 切换 → 200ms → 分页器初始化；scroll-patch / hashchange 仅 paginated（L408-426）。
  - blockId 跳转经 `ScrollPatchService` 全链路可用（L3 重点）。
  - 公开方法 `nextPage / isDualPageMode / getPageParagraphs / highlightElement / clearHighlight / scrollToElementInColumn` 签名与行为不变。
- **测试**：L2 + L3（分页翻页 / 双页 / blockId 跳转 / scroll-patch）全绿，建议本 Issue 额外加 L3 重点回归。

---

## I5 — Shell 瘦身 + 全量验证【收口】

- **Size**: M ｜ **依赖**: I1 + I2 + I3 + I4 ｜ **Branch**: `refactor/reading-mode-shell-slim`
- **目标**：Shell 收敛为纯 facade，跑全量测试确认整体行为等价。
- **范围**：
  - 删除 Shell 中已委托出去的方法体，仅保留生命周期编排 + 稳定公共面 + `ScrollPatchService` 实现 + `SelectionToolbar` 生命周期。
  - 全仓 L1 + L2 + L3 跑绿；外部调用方（`main.ts` / `sidebar-view` / `tts-*` / `library-view` / `agent-chat-controller`）无接口变更。
- **验收标准（总闸）**：
  - `reading-mode-orchestrator.ts`（Shell）< ~400 LOC；每个子模块 < ~400 LOC。
  - 行为零回归；无新增 `any`；`ScrollPatchService` 契约由单一稳定实例满足。
- **测试**：L1 + L2 + L3 全套通过。

---

## 依赖与并行建议

```
I0 ──► ( I1 ∥ I2 ∥ I3 ∥ I4 ) ──► I5
```

- **I1 / I2 / I3 / I4 可并行**：各自只新增一个模块文件 + 改 Shell 委托，职责不重叠，可分别开 worktree 并行开发，最后顺序合入（注意 Shell 文件合并冲突，建议按 I1→I2→I3→I4 顺序 rebase）。
- **I0 必须先合**（防护网 + 死码），I5 必须最后（收口验证）。

## 提交顺序示例（单线合入时）

```
refactor: 建立阅读模式测试防护网并清理死码        (I0)
refactor: 抽出 PageMemoryStore 页码记忆模块        (I1)
refactor: 抽出 Chapter 识别与翻章模块              (I2)
refactor: 抽出 ChatWidgetCoordinator               (I3)
refactor: 抽出 PaginationCoordinator 并守住 ScrollPatchService 契约 (I4)
refactor: Shell 收敛为 facade 并全量验证           (I5)
```

---

*每个 Issue 实施前请把本切片方案整理后告知用户审查（AGENTS.md 约定），用户确认后开 worktree、提交、并调用测试工程师代理验证。*
