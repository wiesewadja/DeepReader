# Spec: 奚童预设 — AI 配置简化

> 版本: 2.0 | 日期: 2026-05-20 | 状态: 待实施
> 基于 2026-05-20 grill-me 会议决策

## 1. 目标

将 AI 配置从"4 个预设选择"简化为**单一奚童预设**（MIMO + SiliconFlow），降低新手认知负担，同时保留专家模式供高级用户自由定制。

**目标用户**：首次安装 DeepReader 的 Obsidian 用户，不懂 AI 服务商概念。

**核心约束**：
- 尚未发布，无向后兼容负担
- 不自行提交代码，需用户审查

## 2. 预设结构

### 2.1 只保留一个预设：奚童

| Provider | 角色 | 模型 | Key 字段 |
|----------|------|------|----------|
| 小米 MIMO | chat | mimo-v2.5 | `providers.xiaomi.apiKey`（Token Plan Key） |
| 小米 MIMO | pageindex | mimo-v2.5 | 同上 |
| 小米 MIMO | proposition | mimo-v2.5 | 同上 |
| 小米 MIMO | tts | mimo-v2.5-tts-voicedesign | 同上 |
| SiliconFlow | router | Step-3.5-Flash | `providers.siliconflow.apiKey` |
| SiliconFlow | embedding | Qwen/Qwen3-Embedding-0.6B | 同上 |
| SiliconFlow | reranker | Qwen/Qwen3-Reranker-0.6B | 同上 |
| — | imagegen | null（专家模式配置） | — |

### 2.2 删除的预设

- `siliconflow-all`（硅基流动 · 全功能）
- `deepseek-economy`（DeepSeek · 精简）
- `openai-standard`（OpenAI · 标准）

已配置这些预设的用户数据不丢失——`detectCurrentPreset()` 返回 null，降级为"自定义配置"标签。

## 3. Key 管理

### 3.1 小米双 Key

小米 MIMO 支持两种计费模式，复用现有 `AIProviderAccount.fallbackApiKey` 字段：

| 字段 | 含义 | 优先级 |
|------|------|--------|
| `providers.xiaomi.apiKey` | Token Plan Key（包量/套餐） | 优先使用 |
| `providers.xiaomi.fallbackApiKey` | API Key（按量付费） | 自动 fallback |

### 3.2 运行时 Fallback 规则

```
resolveRoleConfig() 对小米角色的处理：
1. 优先用 apiKey（Token Plan）
2. 请求失败且错误码 ∈ {401, 402, 429} → 自动重试 fallbackApiKey
3. 其他错误（网络超时、500 等）→ 不触发 fallback，正常报错
```

### 3.3 defaultProviders()

保留全部 8 个预创建（minimax, deepseek, kimi, siliconflow, openai, xiaomi, sensenova, mineru），空 Key 不影响运行，专家模式直接可用。

## 4. 降级规则

### 4.1 setupComplete 判定（宽松模式）

- 填了小米 Key 即算 `setupComplete = true`
- 不要求 SiliconFlow Key

### 4.2 SiliconFlow Key 缺失时的降级

| 角色 | 有 SiliconFlow | 无 SiliconFlow |
|------|---------------|----------------|
| router | Step-3.5-Flash (SF) | mimo-v2.5 (MIMO fallback) |
| embedding | Qwen3-Embedding-0.6B (SF) | null（禁用，降级 BM25） |
| reranker | Qwen3-Reranker-0.6B (SF) | null（禁用） |

### 4.3 小米 Key 缺失

对话全不可用。setupComplete 不会为 true（除非用户在专家模式手动标记）。

## 5. UI 设计

### 5.1 Tab 合并

**"AI 服务"和"模型配置"合并为 1 个 Tab**。总 Tab 数 6 → 5：

| Tab ID | 名称 | 图标 |
|--------|------|------|
| `llm` | AI 服务 | bot |
| `profile` | 用户画像 | user |
| `reading` | 阅读模式 | book-open |
| `general` | 通用 | wrench |
| `weread` | 微信读书 | book-marked |

删除 `model` Tab，其内容（角色矩阵）移入 AI 服务 Tab 的专家折叠区域。

### 5.2 新手区域（setupComplete === false）

无预设卡片选择，直接显示奚童配置表单：

```
开始使用 DeepReader
填写 API Key 即可开始

小米 MIMO
  Token Plan Key  [________key________] 👁
  API Key         [________key________] 👁
  （二选一即可，优先使用 Token Plan）

SiliconFlow
  API Key  [________key________] 👁

[测试连接]  [确认配置 →]

还没有 Key？前往注册（免费）  ← SiliconFlow 注册链接
```

**测试连接**：所有填了值的 Key 都验证，不要求全填。每个 Key 独立显示测试结果（✓/✗）。

**确认配置**：
1. 至少填一个小米 Key，否则 Notice 提示
2. `applyPreset('xitong', ...)` 写入角色映射
3. 根据是否填了 SiliconFlow Key 决定降级
4. `setupComplete = true`
5. 保存 + 重置 Agent

### 5.3 配置摘要（setupComplete === true）

简洁状态提示，不暴露模型细节给普通用户：

**全功能可用**：
```
奚童配置 · 已就绪 ✓

所有功能可用

[重新配置]

▶ 展开专家设置
```

**部分可用（无 SiliconFlow）**：
```
奚童配置 · 部分功能不可用

⚠ 向量搜索、重排序未配置
  补填 SiliconFlow Key 可启用全部功能

[重新配置]

▶ 展开专家设置
```

**用户自定义过角色**：
```
自定义配置

⚠ 向量搜索、重排序未配置
  补填 SiliconFlow Key 可启用全部功能

[重置为奚童默认]    ← 需二次确认

▶ 展开专家设置
```

### 5.4 重新配置 / 重置按钮

| 状态 | 按钮文字 | 行为 |
|------|---------|------|
| 奚童默认 | 重新配置 | 打开 Key 输入表单，只改 Key |
| 自定义配置 | 重置为奚童默认 | 弹出确认 → 覆盖所有角色为奚童默认 + 打开 Key 表单 |

### 5.5 专家设置（底部折叠）

展开后包含三个区域：

1. **服务商账号管理** — 复用现有 `renderProviderList()`，显示所有 provider 的 Key 输入
2. **角色矩阵** — 从 `model-section.ts` 迁移过来的 8 角色 provider+模型分配
3. **MinerU PDF 解析** — 从当前位置保留，移入折叠区域

### 5.6 imagegen

仅在专家模式的角色矩阵中配置，奚童预设不涉及。

## 6. 功能开关

- `PROPOSITION_ENABLED` 保持 `false`
- 奚童预设中 proposition 模型已配置为 `mimo-v2.5`，但功能未启用
- 用户可在专家模式中手动开启

## 7. 代码变更清单

### 7.1 数据层（src/config/）

| 文件 | 变更 |
|------|------|
| `presets.ts` | PRESETS 从 4 条改为 1 条（奚童）；`ProviderPreset` 增加 `secondaryProvider?` 和 `secondaryRoleAssignments?` 字段支持双 Provider；`buildRolesFromPreset()` 支持双 Provider 角色；`detectCurrentPreset()` 适配新映射 |
| `settings.ts` | `defaultRoles()` 更新：router → `{ provider: 'siliconflow', model: 'Step-3.5-Flash' }`，embedding → `{ provider: 'siliconflow', model: 'Qwen/Qwen3-Embedding-0.6B' }`，reranker → `{ provider: 'siliconflow', model: 'Qwen/Qwen3-Reranker-0.6B' }` |
| `providers.ts` | `resolveRoleConfig()` 小米 fallback 仅 401/402/429 触发；移除 router 的特殊 fallback 逻辑（router 现在归 SiliconFlow） |
| `ai-roles.ts` | 无变更（`fallbackApiKey` 字段已存在） |
| `types.ts` | 无变更 |

### 7.2 UI 层（src/settings/）

| 文件 | 变更 |
|------|------|
| `setting-tab.ts` | `SettingsTabId` 删除 `'model'`；`tabs` 数组删除 model 条目；`renderTabContent()` 删除 model case；AI 服务 Tab 渲染函数签名变更（传入 expandedSections） |
| `sections/llm-section.ts` | 重写 `renderQuickSetup()`：移除预设卡片网格，改为奚童双 Key 表单 + SiliconFlow Key；重写 `renderConfigSummary()`：简化为状态提示；折叠区域增加角色矩阵（从 model-section 迁移）；增加重置按钮逻辑 |
| `sections/model-section.ts` | **删除**（内容合并到 llm-section.ts 的折叠区域） |

### 7.3 预设数据结构变更

```typescript
// presets.ts — ProviderPreset 扩展
export interface ProviderPreset {
  id: string;
  label: string;
  description: string;
  provider: string;           // 主 Provider
  free: boolean;
  recommended?: boolean;
  website?: string;
  roleAssignments: Partial<Record<RoleType, string>>;  // 主 Provider 角色

  // 奚童预设新增：第二 Provider
  secondaryProvider?: string;
  secondaryRoleAssignments?: Partial<Record<RoleType, string>>;
  secondaryWebsite?: string;
}
```

奚童预设数据：
```typescript
{
  id: 'xitong',
  label: '奚童',
  description: 'MIMO 对话 + SiliconFlow 搜索，一个配置全搞定',
  provider: 'xiaomi',
  free: false,
  recommended: true,
  website: 'https://platform.xiaomimimo.com',
  roleAssignments: {
    chat: 'mimo-v2.5',
    pageindex: 'mimo-v2.5',
    proposition: 'mimo-v2.5',
    tts: 'mimo-v2.5-tts-voicedesign',
  },
  secondaryProvider: 'siliconflow',
  secondaryRoleAssignments: {
    router: 'Step-3.5-Flash',
    embedding: 'Qwen/Qwen3-Embedding-0.6B',
    reranker: 'Qwen/Qwen3-Reranker-0.6B',
  },
  secondaryWebsite: 'https://cloud.siliconflow.cn',
}
```

### 7.4 applyPreset() 变更

需支持双 Provider：
```typescript
function applyPreset(presetId: string, primaryApiKey: string, settings: DeepPDFSettings, secondaryApiKey?: string): void {
  // 1. 填写主 Provider Key
  // 2. 如果有 secondaryProvider，填写第二 Provider Key
  // 3. 根据 roleAssignments + secondaryRoleAssignments 分配角色
  // 4. 未填 secondaryApiKey 的角色降级处理
}
```

## 8. 测试策略

### 8.1 构建验证

```bash
npm run build    # 编译通过
npm run test:run # 单元测试通过
```

### 8.2 手动测试场景

| 场景 | 步骤 | 预期 |
|------|------|------|
| 新手完整配置 | 填 Token Plan Key + SF Key → 测试 → 确认 | 摘要显示"已就绪 ✓"，7 角色全部可用 |
| 仅小米 Key | 填 Token Plan Key → 确认 | 摘要显示"部分不可用"，router 降级到 mimo-v2.5 |
| 测试连接 | 只填小米 Key → 测试 | 小米 Key 显示 ✓，SF 不显示结果 |
| 重新配置 | 点击"重新配置" | 打开 Key 表单，预填已有值 |
| 重置为默认 | 专家模式改角色 → 点"重置" | 弹确认 → 角色回到奚童默认 |
| Token Plan 耗尽 | 对话触发 429 → 自动切 API Key | 对话继续，无感知 |
| 专家模式 | 展开 → 改角色 → 关闭 | 角色变更持久化 |

## 9. 不做的事

- 不做数据迁移（未发布，无老用户）
- 不做预设卡片选择 UI（只有一个预设）
- 不做 proposition 功能开关 UI（保持 PROPOSITION_ENABLED=false）
- 不做 imagegen 快速配置（仅专家模式）
- 不改其他 Tab（profile, reading, general, weread）
- 不改 `AIProviderAccount` 接口（`fallbackApiKey` 已存在）
