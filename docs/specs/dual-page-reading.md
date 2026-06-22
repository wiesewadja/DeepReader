# Spec: 分页模式自动双页显示

## Objective

让 DeepReader 的分页阅读模式在“足够宽的展开视口”下自动并排显示两页（类似纸质书展开），当视口变窄、存在分屏、或侧边栏未收起时自动缩回单页。

用户故事：
- 作为用户，我在大屏单页阅读时，如果当前只有阅读页且工作区完全展开，希望一屏看到两页，减少翻页次数。
- 作为用户，当我把 Obsidian 窗口缩小、打开侧边栏、或进入分屏时，双页应自动退回单页，不破坏阅读体验。
- 作为用户，如果我讨厌自动双页，可以在设置里关闭它。

成功标准（可验证）：
1. 视口宽度 ≥ 1400px、rootSplit 只有 1 个 leaf、左右侧栏均收起、且设置为“自动双页”时，分页模式显示为两页并排。
2. 上述任一条件不满足时，立即回退为单页，且不出现内容截断、页码跳变。
3. 双页下按 ←/→、翻页按钮、触摸滑动一次翻一“屏”（前进/后退 2 个逻辑页）。
4. 双页下底部页码指示器显示范围，如 `3-4 / 20`；单页下显示 `3 / 20`。
5. 双页下 TTS 朗读当前屏内两页段落；页码记忆仍按当前屏左侧页码保存。
6. 总逻辑页数（用于记忆/进度）保持与单页一致；双页只是渲染层面的 spread 组合。
7. 设置面板提供“宽屏展开时自动双页”开关，默认开启，持久化到 `data.json`。
8. L1 单元测试通过；L3 `npm run e2e-light` 不回归。

## Tech Stack

- 语言/框架：TypeScript + Obsidian API（DOM 操作，无前端框架）
- 布局：CSS Multi-column（复用现有分页方案）
- 响应式：ResizeObserver + workspace layout 状态检查
- 状态：插件 `DeepPDFSettings` + `pageMemory`（不变）
- 无新增运行时依赖

## Commands

```bash
# 构建（生成 bin/main.js / bin/styles.css）
npm run build

# L1 单元测试
npm run test:run

# L3 轻量 E2E
npm run e2e-light

# 部署到 test-vault
npm run deploy

# 代码更新后重建 graphify 索引
graphify update .
```

## Project Structure

```
src/components/reading-mode/
  page-paginator.ts            # 分页核心：双页布局计算、翻页、页码
  reading-mode-orchestrator.ts # 协调：传入设置、恢复页码、监听 workspace 变化
  reading-mode.css             # 分页/双页样式
  viewport-state.ts            # 新增：判断当前是否满足“单页全展开”条件
src/config/settings.ts         # 新增 autoDualPage 字段
src/settings/sections/reading-section.ts  # 新增自动双页开关
tests/unit/                    # 新增 viewport-state / page-math 单元测试
docs/specs/dual-page-reading.md # 本文件
```

## Code Style

命名与现有项目保持一致：camelCase，私有字段加 `_`，日志用 `serviceLog`。

```typescript
// 示例：计算当前是双页 spread 还是单页
private get isDualPageMode(): boolean {
  if (!this.scrollView) return false;
  if (!this.options.autoDualPage) return false;
  return isViewportFullyExpanded(this.app) && this.scrollView.clientWidth >= DUAL_PAGE_MIN_WIDTH;
}

// 示例：从滚动位置推导当前屏左侧页码
private updateCurrentPageFromScroll(): void {
  if (!this.scrollView) return;
  const viewWidth = this.scrollView.clientWidth;
  if (viewWidth === 0) return;

  const spreadIndex = Math.round(this.scrollView.scrollLeft / viewWidth);
  const newLeftPage = this.isDualPageMode
    ? spreadIndex * 2 + 1
    : spreadIndex + 1;

  if (newLeftPage !== this._currentPage) {
    this._currentPage = Math.max(1, Math.min(newLeftPage, this._totalPages));
    this.options.onPageChange?.(this._currentPage, this._totalPages);
  }
}
```

## Testing Strategy

- **L1 单元测试**：
  - `viewport-state.test.ts`：覆盖 rootSplit children 数量、侧栏 collapsed、宽度阈值、setting 开关等组合的判定结果。
  - `page-paginator-dual.test.ts`：覆盖 `getSpreadForPage`、`_currentPage` 递增 ±2、奇数页收尾、页码指示器格式化。
- **L3 轻量 E2E**：在 `tests/e2e-light/` 或现有阅读模式流程中增加断言：宽屏下 `.markdown-preview-view` 具有 `deeppdf-dual-page` 类；缩小窗口后类被移除。
- **手工验证**：在 test-vault 打开一本书，最大化/分屏/开关侧边栏，观察双页 ↔ 单页切换及页码指示器。
- 不强制要求新增覆盖率阈值，但核心判定逻辑必须被单元测试覆盖。

## Boundaries

- **Always**：
  - 修改后运行 `npm run test:run` 与 `npm run e2e-light`。
  - 保持 `pageMemory` 和 `last-page-store` 的页码语义不变（仍按逻辑页保存）。
  - 使用 `serviceLog` 记录布局切换、resize 等关键事件。
  - 代码改动后执行 `graphify update .`。
- **Ask First**：
  - 引入新依赖。
  - 修改 `ReadingModeCallbacks` 接口或 `PagePaginatorOptions` 的 public 签名。
  - 改变 `DeepPDFSettings` 的迁移规则（本次新增字段属于常规扩展，无需额外迁移，但需确认默认值写入）。
- **Never**：
  - 在双页模式下破坏单页布局。
  - 提交未通过的测试。
  - 将 API key / 用户数据写入 spec 或测试。

## Implementation Plan

### Phase 1 — 能力检测

新增 `src/components/reading-mode/viewport-state.ts`：
- `isViewportFullyExpanded(app: App): boolean`
- 判定条件：
  1. `app.workspace.rootSplit.children.length === 1`
  2. `app.workspace.leftSplit.collapsed === true`
  3. `app.workspace.rightSplit.collapsed === true`
- 提供单元测试，使用 mock workspace。

### Phase 2 — 设置开关

1. `src/config/settings.ts`：新增 `autoDualPage: boolean`，默认值 `true`；`DEFAULT_SETTINGS` 同步。
2. `src/settings/sections/reading-section.ts`：添加 Toggle “宽屏展开时自动双页”。
3. `reading-mode-orchestrator.ts`：把设置传入 `PagePaginatorOptions`。

### Phase 3 — PagePaginator 双页改造

1. 在 `PagePaginatorOptions` 增加 `autoDualPage: boolean`。
2. 增加 `isDualPageMode` getter，结合 `autoDualPage`、宽度阈值、`isViewportFullyExpanded`。
3. `updateColumnSizing`：
   - 双页：设置 `--deeppdf-col-width: 50%`（CSS 变量），列间距/边距归零，让每列宽度正好为视口一半。
   - 单页：保持现有逻辑。
   - 切换时给 `scrollView` 添加/移除 `deeppdf-dual-page` class。
4. `calculatePages` / `countActualPages`：
   - 单页：`Math.ceil(scrollWidth / viewWidth)`（保持现有）。
   - 双页：逻辑页数 = `Math.ceil(scrollWidth / (viewWidth / 2))`。
5. `nextPage` / `prevPage`：
   - 双页下滚动 `viewWidth`，`_currentPage += 2` / `-= 2`。
6. `updateCurrentPageFromScroll`：
   - 双页下当前屏左侧页码 = `round(scrollLeft / viewWidth) * 2 + 1`。
7. `getPageParagraphs`：
   - 双页下返回当前屏 `page` 与 `page + 1` 的段落（并集）。
8. `getCurrentPageText`：
   - 双页下合并当前屏两页文本。
9. `updateControls`：
   - 双页下指示器格式化为 `${leftPage}-${rightPage} / ${total}`；
   - 若最后一屏只剩一页，则显示 `${leftPage} / ${total}`。
10. `handleResize`：
    - 单双页切换时保持当前屏左侧页码不变，重新计算 `scrollLeft`。

### Phase 4 — CSS

`src/components/reading-mode/reading-mode.css`：
- 新增 `.deeppdf-reading-mode.deeppdf-paginated.deeppdf-dual-page .markdown-preview-view`：
  - `column-width: 50%`
  - `column-gap: 0`
  - 左右 padding 设为 0（上下保留 60px）
  - 可预留 `column-rule` 作为两页间分隔线（如视觉需要）
- 保持 `@media (max-width: 600px)` 对分页的禁用逻辑优先于双页。

### Phase 5 — 恢复页码同步

`reading-mode-orchestrator.ts`：
- 恢复页码时根据当前是单/双页计算 `targetScroll`：
  - 单页：`(page - 1) * viewWidth`
  - 双页：`floor((page - 1) / 2) * viewWidth`

### Phase 6 — 测试与验证

1. 补充单元测试。
2. 运行 `npm run test:run`。
3. 运行 `npm run e2e-light`。
4. 手动在 test-vault 验证：
   - 宽屏单 leaf 无侧栏 → 双页
   - 打开右侧栏 → 单页
   - 分屏 → 单页
   - 关闭自动双页设置 → 始终单页
   - 跨章回退到最后一页 → 正确显示最后一屏

## Tasks

- [ ] **Task 1: 新增 viewport 展开检测**  
  - Acceptance: `isViewportFullyExpanded` 在 rootSplit 多 leaf、侧栏未收起、非阅读模式下均返回 false；单 leaf 且左右侧栏收起时返回 true。  
  - Verify: `npm run test:run` 中新增测试通过。  
  - Files: `src/components/reading-mode/viewport-state.ts`, `tests/unit/viewport-state.test.ts`

- [ ] **Task 2: 添加自动双页设置**  
  - Acceptance: `DeepPDFSettings` 含 `autoDualPage`，设置面板可开关，默认值 true，切换后即时生效。  
  - Verify: 构建后检查 `bin/main.js` 含新字段；在 test-vault 设置面板可见。  
  - Files: `src/config/settings.ts`, `src/settings/sections/reading-section.ts`, `src/components/reading-mode/reading-mode-orchestrator.ts`

- [ ] **Task 3: PagePaginator 支持双页布局与翻页**  
  - Acceptance: 双页模式下 CSS 列宽为视口一半；`nextPage`/`prevPage` 一次翻两逻辑页；总逻辑页数计算正确；指示器显示范围。  
  - Verify: 单元测试 + 在 Obsidian 中手动翻页。  
  - Files: `src/components/reading-mode/page-paginator.ts`, `tests/unit/page-paginator-dual.test.ts`

- [ ] **Task 4: 更新阅读模式 CSS**  
  - Acceptance: 双页类激活时 `.markdown-preview-view` 应用双页样式；移动端/窄屏禁用双页；单页样式无回归。  
  - Verify: 肉眼检查 + `npm run build` 成功。  
  - Files: `src/components/reading-mode/reading-mode.css`

- [ ] **Task 5: 恢复页码与 resize 适配**  
  - Acceptance: 从记忆页码恢复时，单/双页下均滚动到正确屏；窗口缩放导致单双页切换时，当前左侧页码保持不变。  
  - Verify: 在 test-vault 打开书籍，调整窗口/侧栏，观察页码与滚动位置。  
  - Files: `src/components/reading-mode/reading-mode-orchestrator.ts`, `src/components/reading-mode/page-paginator.ts`

- [ ] **Task 6: 运行测试与 E2E**  
  - Acceptance: `npm run test:run` 与 `npm run e2e-light` 全部通过。  
  - Verify: 命令输出 0 失败。  
  - Files: `tests/unit/*`, `tests/e2e-light/*`（如需要）

- [ ] **Task 7: 更新 graphify 索引**  
  - Acceptance: `graphify update .` 成功退出，无异常。  
  - Verify: `graphify-out/` 时间戳更新。  
  - Files: `graphify-out/`

## Open Questions

- 无。所有关键细节（自动触发条件、翻页单位、页码显示、TTS 范围、奇数页处理）已在本 spec 中确认。
