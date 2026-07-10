# 成就徽章系统（含「学习之星」）实施计划

> 状态：待评审（用户已确认「从零新建」，star 来源等决策为推荐默认值，可调）
> 目标：新增一套成就徽章系统，「学习之星」的解锁条件 = 累计获得 100 颗黄色星星。

---

## 0. 背景与结论

上一轮核查确认：DeepReader 代码库中**不存在**任何成就徽章 / 星星计数 / 游戏化机制。现有 `徽章` 命中均为：索引状态徽章、微信读书划线数标签、划线黄色、阅读层次（ReadingLevel），均与成就无关。

因此本任务是从零构建，不是改配置。下文给出完整设计、文件清单、接入点与验证方式。

---

## 1. 核心概念（数据模型）

单一星星货币 = **黄色星星**（🌟 / 🟡 视觉）。「黄黄的星星」即该货币的口语化表达，无多色分级。
成就 = 对星星累计数 / 特定行为计数的条件封装。

```ts
// src/achievements/types.ts
export interface StarState {
  totalStars: number;          // 累计获得（含已消费的，用于成就判定）
  earnedLog: StarEarnRecord[]; // 最近 N 条流水（用于 UI 展示）
}

export interface StarEarnRecord {
  reason: StarReason;          // 'note' | 'highlight' | 'index' | 'finish_book'
  amount: number;
  at: number;                  // epoch ms
}

export type AchievementId = string;

export interface AchievementDef {
  id: AchievementId;
  name: string;                // 中文名，如「学习之星」
  description: string;         // 解锁条件描述
  icon: string;                // Obsidian icon id
  /** 判定函数：给定当前状态返回是否已解锁 */
  isUnlocked: (ctx: UnlockContext) => boolean;
}

export interface UnlockContext {
  totalStars: number;
  counters: Record<string, number>; // 行为计数器（笔记数、划线数…）
}

export interface AchievementState {
  unlocked: AchievementId[];
  counters: Record<string, number>;
}
```

---

## 2. Star 来源（⚠️ 推荐默认值，可调）

首次版本采用「具体可观测行为」作为赚星来源，避免模糊规则：

| 行为 | 接入点（实施时确认） | 星星 | 说明 |
|------|----------------------|------|------|
| 写一条笔记 | `src/agent/tools/write-note.ts:127` `writeNoteTool.execute`（同时需确认 UI 笔记入口是否走同一路径） | +1 | 每条笔记 |
| 创建一个划线 | `src/services/highlight-service.ts:71` `saveHighlight` | +1 | 每次划线 |
| 完成一本书的索引 | `src/views/sidebar/domains/book-domain.ts:824` `book:changed` 事件（仅 progress 完成态） | +3 | 每本建索引完成 |
| 读完一本书 | `src/services/profile-builder.ts:431` `progress>=100` 判定处 | +10 | 每本读完 |

> 说明：以上数值为初始平衡值，便于真实使用下可达 100 星。可按你的产品判断调整（例如划线 +1 可能过快，可改为「每 5 条划线 +1」）。
> 防刷：同一笔记/划线以内容 hash 去重，避免重复刷星。

---

## 3. 成就目录（初始集）

`src/achievements/definitions.ts` 注册，至少含：

| id | 名称 | 条件 | 说明 |
|----|------|------|------|
| `learning_star` | **学习之星** | `totalStars >= 100` | **本任务目标** |
| `first_note` | 初出茅庐 | `counters.notes >= 1` | 写第一条笔记（演示系统通用性） |
| `bookworm` | 博览群书 | `counters.indexed >= 10` | 完成 10 本书索引 |

> 仅 `learning_star` 为本次硬性需求；另两个用于验证系统是「通用成就框架」而非写死单条。

---

## 4. 模块与文件清单（全部新建，遵循 AGENTS.md 红线）

```
src/achievements/
  types.ts            // §1 类型
  store.ts            // 持久化：plugin.saveData/loadData 子键 'achievements'，原子读写
  star-service.ts     // awardStars(reason, amount) + getState()；落盘 + 发事件
  achievement-service.ts // 注册 definitions、evaluate() 判定、记录 unlocked、发事件
  definitions.ts      // §3 成就目录（含 learning_star）
  events.ts           // StarEventMap: 'star:earned' / 'achievement:unlocked'
  index.ts            // 初始化：loadStore → 注入到 main.ts 与设置分区

src/settings/sections/achievement-section.ts  // 新增「成就」设置分区
src/settings/setting-tab.ts                    // 改：tabs 数组加 {id:'achievement',name:'成就',icon:'award'}，renderTabContent 加分发
```

**持久化约束**：不静态 import Node 核心模块；用 Obsidian `plugin.saveData/loadData`。store 读写时先 `loadData()` 全量 → 读写 `data.achievements` 子键 → `saveData(data)`，绝不覆盖 `settings`。

---

## 5. UI 设计（设置「成就」分区）

- 顶部：当前星星总数 🌟 `N` / 100（学习之星进度条）。
- 徽章网格：每个成就一张卡（图标 + 名称 + 描述 + 状态：`已解锁` / `还差 X 星` 或 `进度 N/M`）。
- 解锁瞬间：通过 `achievement:unlocked` 事件弹一个轻量 toast（复用现有 `components/message` 或 Obsidian `Notice`），不阻断操作。
- 样式：复用现有 `deeppdf-*` CSS 约定，支持浅/深色（项目强制要求主题切换）。

---

## 6. 接入方式（最小侵入）

- `main.ts` `onload`：实例化 `AchievementService`，注入 `StarService`。
- 在 §2 表格的 4 个接入点各加一行 `starService.awardStars(reason, amount)`（行为计数同步 +1）。
- 每次 `awardStars` 后调用 `achievementService.evaluate()` 重算解锁态，新解锁则发 `achievement:unlocked`。
- 设置分区渲染时从 store 读当前状态。

---

## 7. 验证

- **单元测试**（vitest，`src/achievements/__tests__/`）：
  - `star-service.test.ts`：awardStars 累加正确、去重生效、持久化往返。
  - `achievement-service.test.ts`：`learning_star` 在 totalStars<100 不解锁、=100 解锁；`first_note`/`bookworm` 判定正确。
  - `definitions.test.ts`：目录含 `learning_star` 且条件为 `>=100`。
- **分模块跑**（遵循红线，不动全量）：`npx vitest run src/achievements`。
- **冒烟**：`node scripts/smoke/smoke.mjs` 选相关场景；手动在 Obsidian 内写笔记/划线验证星星 +1 与徽章更新。
- **回归**：确保现有 `npm run test:run` 不因此新功能变红（新增模块独立，无侵入性破坏）。

---

## 8. 风险与可逆性

- 纯新增模块 + 4 处单行接入，无对现有逻辑的行为修改；任一处可单独回退。
- 持久化走独立子键，误删不影响 `settings`。
- 若 star 数值需调，只改 §2 表，不动其余代码。

---

## 9. 待你确认的两点（默认已填，可改）

1. **Star 来源与数值**（§2）：是否认可「笔记+1 / 划线+1 / 建索引+3 / 读完+10」？还是你想换成别的口径（如按阅读时长、按每日连续打卡）？
2. **初始成就集**（§3）：除「学习之星」外，是否要顺带做 `first_note` / `bookworm` 两个演示成就？还是本期只做「学习之星」一个？
