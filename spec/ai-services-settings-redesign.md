# AI 服务设置页重构

> 状态：ready-for-agent
> 来源：grill-me 交互讨论（见对话记录）
> 分支：`feat/volcark-agent-plan`
>
> 🎨 **UI 设计稿**：[`spec/ui-designs/ai-services-settings.html`](ui-designs/ai-services-settings.html)
> （浏览器打开可交互预览：点击 plan 卡片看角色预览切换、输 SF Key 看 reranker 即时变化、亮/暗主题切换）

## Problem Statement

DeepReader 的「AI 服务」设置页目前是「新手配置 / 专家模式」二元分层：

- 新手区硬编码到单一预设（先是奚童，后改 agent-plan），把主 Key、MIMO Key、SiliconFlow Key 三组**平级铺开**，层级混乱——新用户分不清哪个必填、哪个可选，也不知道 volcark 和 MIMO 其实是**平级的两个入口**，可以二选一。
- 真正的"其他服务商 Key 配置"和"逐角色调整"被折叠在「专家模式」门槛后，多数用户根本不会展开，导致配了 deepseek/kimi 的 Key 也无法在角色里用上。

结果是：新用户配置路径绕、可选项淹没必选项；进阶用户被一道"专家模式"的墙挡住。两个最大的 plan 入口（火山方舟 Agent Plan、小米 MIMO Token Plan）没有在 UX 上被突出为"选一个就行"。

## Solution

去掉「新手 / 专家」二元分层，改为**三层统一布局**，所有用户可见可用：

1. **Plan 快速选择**（常态显示）——两张平级卡片：火山方舟 Agent Plan / 小米 MIMO Token Plan，二选一。每张卡片**内嵌自己的 API Key 输入框**，选中哪张哪张激活。下方一行可选的 SiliconFlow Key（embedding + reranker 增强）。
2. **角色分配**（常态显示）——列出所有角色当前分配（chat / router / pageindex / proposition / embedding / reranker / tts / imagegen）。点 plan 卡片时显示**预览态**（不写入 settings），填 SF Key 时 embedding/reranker 行即时预览更新。点「确认配置」后写入 settings，之后可逐角色手动微调（即时保存）。每个角色的选择器**只能选已配置 Key 的服务商**。
3. **其他服务商 Key**（折叠，常态收起）——DeepSeek / Kimi / Minimax / OpenAI / SenseNova 等。展开填 Key 后，对应 provider 即时加入角色选择器的可选列表。

核心交互模型：**预览 + 确认**。点卡片 / 填 SF Key 只改预览，点「确认配置」才 applyPreset 写入。确认后角色区的手动微调是直接操作（即时保存）。

## User Stories

1. 作为新用户，我想在打开 AI 服务设置时第一眼就看到两个主流服务商（火山方舟、小米 MIMO），这样我能立刻知道"选一个就行"，而不是面对一堆选项。
2. 作为新用户，我想选了火山方舟卡片后，那张卡片的 Key 输入框自动激活，这样我不用找去哪里填 Key。
3. 作为新用户，我想在选 plan 后立刻看到角色分配会变成什么（chat 用什么模型、router 用什么模型），这样我确信"选这个 plan 就能拿到这些模型"，不用猜。
4. 作为新用户，我想这个角色预览标记为"预览态"（尚未生效），这样我清楚还要点确认才真正应用。
5. 作为新用户，我想在填完主 Key 后点「确认配置」一次性生效，这样配置路径短且有掌控感。
6. 作为新用户，我想 SiliconFlow Key 作为单独一行可选项放在 plan 卡片下方，这样我知道它是"增强项"而非必填。
7. 作为新用户，我想填上 SiliconFlow Key 后，embedding 和 reranker 两行的预览即时从"未配置"变成具体模型名，这样我能看到增强带来的变化。
8. 作为新用户，我想在还没填任何 Key 时点「测试连接」得到"请至少填写一个 Key"的提示，这样我不会误以为配置成功。
9. 作为已配置用户，我想重新进入设置页时看到当前已就绪的状态摘要（哪个 plan、哪些功能可用、哪些缺失），这样我清楚当前配置健康度。
10. 作为已配置用户，我想点「重新配置」回到 plan 选择界面，这样我能切换 plan。
11. 作为进阶用户，我想角色分配区常态可见（不藏在专家模式后），这样我能直接看到并微调每个角色的服务商和模型。
12. 作为进阶用户，我想每个角色的选择器只列出已配置 Key 的服务商，这样我不会选到一个没 Key 的服务商导致调用失败。
13. 作为进阶用户，我想手动改某个角色的服务商后即时保存，这样不用再点一次确认。
14. 作为进阶用户，我想在页面底部展开"其他服务商 Key"折叠区填入 DeepSeek/Kimi 等 Key，这样这些服务商即时出现在角色选择器里。
15. 作为进阶用户，我想折叠区默认收起，这样普通服务商的 Key 配置不干扰主流的 plan 选择。
16. 作为切换 plan 的用户，我想从火山方舟切到 MIMO 时，角色预览整块替换为新 plan 的默认模型，这样切换反馈即时明确。
17. 作为配置了三组 Key 的用户，我想点「测试连接」并行测试所有已填的 Key 并显示各自延迟，这样我能验证 Key 是否有效。
18. 作为配置完成的用户，我想看到明确的完成提示（哪些功能可用、哪些未启用），这样我知道接下来能否用语音、重排序等功能。
19. 作为有自定义配置的用户，我想在不匹配任何预设时看到"自定义配置"状态并提供"重置为默认"，这样我能一键回到标准配置。
20. 作为 Obsidian 用户，我想这个设置页在窄屏（移动端）下两个 plan 卡片能纵向堆叠、Key 输入框占满宽度，这样在小屏上也能完成配置。

## Implementation Decisions

### 模块改动

- **`src/settings/sections/llm-section.ts`**（主要重构对象）
  - 删除「展开专家设置」折叠门槛，改为三层常态/折叠混合布局。
  - `renderQuickSetup` 重构为：plan 卡片区（含内嵌 Key + SF Key 行）+ 角色预览区 + 操作按钮。
  - 新增角色预览渲染：根据 `selectedPresetId` + SF Key 填写状态，展示各角色预览分配。
  - 原 `renderExpertArea` 拆解：角色分配部分提升为常态显示的 `renderRoleAssignment`；provider grid 保留为底部折叠的 `renderOtherProviders`。
  - `LLMState` 调整：保留 `selectedPresetId`；预览态与已提交态的区分由"是否 setupComplete + selectedPresetId 是否等于当前实际 preset"判断。

- **`src/config/presets.ts`**（不改数据结构，仅可能新增一个纯函数）
  - 新增纯函数 `computePreviewRoles(presetId: string, providersWithKeys: Set<string>): Record<RoleType, { provider: string; model: string } | null>`。
  - 它是 `buildRolesFromPreset` + `getAllAdditionalProviders` 的薄封装，供 UI 预览与单测共用，**无副作用**（不碰 settings）。

- **`src/settings/components/role-card.ts`**（角色选择器）
  - 角色的 provider/model 下拉只列出"已配置 Key 的服务商"。需确认现有 `getAvailableProvidersForRole` 是否已按"有 Key"过滤，未过滤则补上。

### 关键交互

- **plan 卡片内嵌 Key**：每张卡片（volcark / MIMO）内嵌一个 Key 输入框，选中态高亮，Key 输入即时（debounce）存入 `settings.providers[<id>].apiKey`。
- **SF Key 行**：独立一行，输入即时存 `settings.providers['siliconflow'].apiKey`。
- **角色预览**：点 plan 卡片 → `state.selectedPresetId` 变 → 角色区用 `computePreviewRoles(selectedPresetId, configuredProviderSet)` 算出预览。预览态视觉标记（如"(预览)"后缀或浅色样式）。
- **SF Key 影响预览**：SF Key 一旦填入，`configuredProviderSet` 含 `siliconflow` → reranker/embedding 行预览即时切到 SF 模型。
- **确认配置**：点「确认配置」→ `applyPreset(selectedPresetId, primaryKey, settings, ..., additionalKeys)` 写入 settings + `setupComplete = true`。预览转正式。
- **确认后微调**：角色选择器手动改动 → 即时 `saveSettings`（直接操作，无需再确认）。
- **底部折叠区**：默认收起。展开后是其他 provider 的 Key 卡片网格；填 Key 后对应 provider 即时进入角色选择器可选列表（无需重新部署/重载）。

### 预览态 vs 已提交态的区分

- 预览态：`setupComplete === false` 或 `forceShowQuickSetup === true` 或 `selectedPresetId !== detectCurrentPreset(roles)?.id`。
- 预览态下角色区显示 `computePreviewRoles` 的结果，标记"(预览)"。
- 已提交态：`setupComplete === true` 且 selectedPresetId 匹配当前实际配置 → 角色区读 `settings.roles`，无预览标记，可手动改。

### 范围内但不改数据结构

- `presets.ts` 的 `PRESETS`（agent-plan / xitong）保持不变。
- `applyPreset` / `buildRolesFromPreset` / `getAllAdditionalProviders` / `detectCurrentPreset` 保持不变，仅新增 `computePreviewRoles` 封装。

## Testing Decisions

### 测试哲学

只测外部行为，不测实现细节。UI 渲染走冒烟测试（Obsidian 运行时），纯逻辑走单元测试。

### 测试缝隙（唯一逻辑 seam）

新增纯函数 `computePreviewRoles(presetId, providersWithKeys)`：

- **为什么是它**：重构后所有"角色预览"的正确性都汇聚到这一个函数。它是 `buildRolesFromPreset` 的无副作用封装，输入（presetId + 哪些 provider 有 Key）→ 输出（各角色分配）。把它测透，UI 只需验证"渲染了它返回的结果"。
- **单元测试**（`tests/unit/config/presets.test.ts` 或新建 `compute-preview-roles.test.ts`）覆盖：
  - agent-plan + 无额外 Key → 只有 volcark 角色，tts/reranker 为 null
  - agent-plan + xiaomi Key → tts 启用
  - agent-plan + siliconflow Key → reranker 启用
  - agent-plan + 两者都有 → 全角色启用
  - xitong + siliconflow Key → embedding/reranker 启用
  - xitong + 无 SF Key → embedding/reranker 为 null
  - 未知 presetId → 返回空 / 抛错（按实现约定）
- **先例**：`tests/unit/config/apply-preset.test.ts` 已有同类测试范式（applyPreset 的多 provider 组合），可直接借鉴。

### UI 测试

- 冒烟测试（`scripts/smoke/`）：验证设置页打开 → 两个 plan 卡片渲染 → 点卡片角色预览切换 → 填 Key + 确认后 settings 写入。
- 不为 UI 渲染细节写单元测试（DOM 断言脆弱，收益低）。

### 不新增的 seam

- 不为 role-card 的下拉过滤逻辑单独抽函数测试——它依赖 `settings.providers` 的 Key 状态，属于 UI 集成范畴，冒烟覆盖即可。
- 不为预览态判断逻辑（setupComplete 等）单独抽函数——它是几个布尔/字符串的简单组合，放 UI 侧。

## Out of Scope

- **不改 `presets.ts` 数据结构**：agent-plan / xitong 的 `roleAssignments` / `additionalProviders` 保持现状。`secondary*` 旧字段的清理（之前 review 提到的）不在本次范围。
- **不新增 provider**：不增加新的服务商。
- **MIMO fallback（按量付费 Key）**：不占 plan 卡片区的主位置；归入底部折叠区或角色选择器层面处理。
- **不改 `applyPreset` 的签名或降级逻辑**：现有多 provider 降级（无 Key 的 provider 角色置 null / router 降主模型）保持不变。
- **不改默认配置**：`settings.ts` 的 `defaultRoles` 是否用 volcark（之前 review 的产品决策点）不在本次重构范围，本次只改设置页 UI 布局。
- **不改 embedding 模型选择**：`doubao-embedding-vision` 用作文本 embedding（已实测可用）不在本次讨论。
- **不引入动画过渡**：plan 切换时角色预览整块替换，不做淡入淡出。
- **不改 `renderConfigSummary`（已配置后的摘要视图）**的逻辑，仅可能微调文案适配新布局。

## Further Notes

- **历史背景**：本分支 `feat/volcark-agent-plan` 已完成"新增 volcark provider + 多 provider 预设 + 默认切火山方舟 + tracer bug 修复"，并已实测 volcark agent plan 的 chat/embedding 可用（需 ark- 套餐 Key + plan 端点）。本次重构是在其基础上的 UI 层改进。
- **volcark Key 类型陷阱**：火山方舟 `/api/plan/v3` 端点只认 `ark-` 前缀的套餐 Key，标准按量 Key 会 401。UI 文案宜提示用户填 ark- Key。
- **维度一致性**：agent-plan 用 `doubao-embedding-vision`（默认 2048 维，可配 1024）。建库自动探测维度写入 `book-meta.json`，查询走火山默认值，两侧一致 + `book-search-v2.ts` 的维度不匹配检测兜底。本次不显式钉死 dimensions（可作为后续优化）。
- **rollout**：重构后建议冒烟验证一遍完整流程（选 plan → 填 Key → 确认 → 角色生效 → 底部展开配其他 Key → 角色选择器可选），再合并。
