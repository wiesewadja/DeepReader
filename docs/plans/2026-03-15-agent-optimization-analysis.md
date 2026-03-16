# Agent 优化分析：多轮调用、等待体验、Skill 系统

## 问题 1：多轮调用的必要性和精简方案

### 现状分析

从测试日志看，一个简单的"这本书讲什么"问题触发了：
```
迭代 1: get_toc
迭代 2: search_doc (top_k=2)
迭代 3: search_doc (top_k=1)
迭代 4: 生成回答
```

**共 4 轮迭代，总耗时 50.3s**

### 为什么需要多轮？

1. **LLM 的决策模式**：每轮只能做一件事
   - 第 1 轮：看到问题 → 决定获取目录
   - 第 2 轮：看到目录 → 决定搜索内容
   - 第 3 轮：觉得信息不够 → 再次搜索
   - 第 4 轮：信息足够 → 生成回答

2. **信息渐进式获取**：LLM 不知道需要什么信息，只能逐步探索

3. **当前工具设计的局限性**：
   - `get_toc` 只返回结构，没有摘要
   - `search_doc` 返回片段，可能不够完整

### 精简方案

#### 方案 A：合并工具调用（推荐）

**思路**：让 LLM 在第一轮就并行调用多个工具

```typescript
// 当前：顺序调用
迭代1: get_toc
迭代2: search_doc
迭代3: search_doc

// 优化后：并行调用
迭代1: get_toc + search_doc (同时执行)
迭代2: 生成回答
```

**实现方式**：
1. 在系统提示中明确指导：
   > "对于'讲什么'类问题，同时调用 get_toc 和 search_doc"

2. 工具描述优化：
   ```typescript
   description: `【检视阅读】搜索文档内容。
   建议：与 get_toc 配合使用，一次调用两个工具以加快响应。`
   ```

#### 方案 B：创建组合工具

**新工具**：`quick_overview`

```typescript
description: `【检视阅读】快速获取书籍概览。
内部自动执行：get_toc + search_doc(核心主题)
适合回答"这本书讲什么"类问题。`
```

**优点**：
- 1 轮迭代完成
- 减少 LLM 决策成本

**缺点**：
- 灵活性降低
- 可能获取过多不需要的信息

#### 方案 C：降低最大迭代 + 智能提前终止

```typescript
const maxIterations = 5;  // 从 10 降到 5

// 智能终止：如果连续 2 轮只获取信息没有输出内容
if (noOutputCount >= 2 && hasEnoughInfo) {
  forceSummarize = true;
}
```

### 推荐方案

**组合使用 A + C**：
1. 优化提示词，鼓励并行调用工具
2. 降低最大迭代到 5-7
3. 增加智能提前终止逻辑

---

## 问题 2：减轻用户等待焦虑

### 现状

- 简单问题：30-50 秒
- 复杂问题：可能超过 1 分钟
- 用户看到：转圈的 🤔 图标 + "思考中..."

### 等待心理学

用户焦虑来源于：
1. **不确定性**：不知道在做什么
2. **无进度感**：看不到进展
3. **无控制感**：无法干预

### 优化方案

#### 方案 A：增强进度反馈

**当前状态**：
```
🤔 思考中...
```

**优化后**：
```
🔍 [检视阅读] 浏览目录结构...
   ✓ 已获取 26 个章节

🔍 [检视阅读] 搜索「核心主题」...
   ✓ 找到 3 个相关章节

🧐 [分析阅读] 翻阅「前言」...
   ✓ 正在整理回答...
```

**实现**：
- 每个工具执行后立即更新状态
- 显示已完成的步骤
- 预估剩余时间（可选）

#### 方案 B：流式输出中间结果

**思路**：让 LLM 边思考边输出

```
AI: 让我先看看这本书的目录...
    （工具执行中）

AI: 目录显示这本书分为四个部分...
    我再搜索一下具体内容...

AI: 根据[[前言]]，这本书主要讲述...
```

**优点**：
- 用户感觉"动起来了"
- 减少心理等待时间

**缺点**：
- 需要修改 LLM 调用方式
- 可能输出不连贯

#### 方案 C：预估 + 承诺

**思路**：先快速给出预判，再详细执行

```
AI: 这是一个关于日本经济经验的书，
    让我查找更多细节来给您完整回答...
    （预计 20 秒）
```

**实现**：
1. 第一轮 LLM 调用只输出预判（max_tokens=100）
2. 第二轮详细执行

#### 方案 D：后台处理 + 通知

**思路**：对于复杂问题，允许后台处理

```
AI: 这个问题需要深入分析多本书，
    我会在后台处理，完成后通知您。
    您可以继续其他对话。
```

### 推荐方案

**优先实现 A + C**：
1. 增强进度反馈（改动小，效果好）
2. 先给出简短预判（需要调整提示词）

---

## 问题 3：Skill 系统的问题

### 现状分析

**Skill 工具描述**：
```typescript
description: 'Load specialized knowledge for a task.
Use this to access expert-level instructions and methodologies for specific tasks.'
```

**问题**：
1. **描述太泛**：LLM 不知道什么时候该用
2. **触发条件不明确**：什么任务需要"专业技能"？
3. **可用技能不可见**：LLM 不知道有哪些技能

### 日志分析

从测试日志看，`Skill` 工具几乎从未被调用。这说明：
- LLM 不认为当前任务需要"专业技能"
- 或者 LLM 根本不知道有这个选项

### 优化方案

#### 方案 A：动态技能描述

**思路**：将可用技能列表注入到工具描述中

```typescript
// 当前
description: 'Load specialized knowledge for a task...'

// 优化后
description: `加载专业技能指导。

可用技能：
- deepreader-frontend-debugging: 前端调试、日志查看、插件重载
- obsidian-markdown: 创建和编辑 Obsidian 笔记
- json-canvas: 创建 Canvas 画布

适用场景：需要专业操作指南时调用。`
```

**实现**：
```typescript
function createSkillTool(skillLoader: SkillLoader): ToolExecutor {
  const skills = skillLoader.listSkills();
  const skillDescriptions = skills.map(name => {
    const skill = skillLoader.getSkill(name);
    return `- ${name}: ${skill?.description || ''}`;
  }).join('\n');

  return {
    definition: {
      ...SKILL_DEFINITION,
      function: {
        ...SKILL_DEFINITION.function,
        description: `加载专业技能指导。\n\n可用技能：\n${skillDescriptions}`
      }
    },
    // ...
  };
}
```

#### 方案 B：自动技能推荐

**思路**：系统提示中根据问题类型推荐技能

```typescript
// 在 buildConstraints 中添加
`## 技能使用指南

当遇到以下场景时，调用对应的 Skill：
- 需要调试插件 → Skill(skill="deepreader-frontend-debugging")
- 创建 Obsidian 笔记 → Skill(skill="obsidian-markdown")
- 创建 Canvas 画布 → Skill(skill="json-canvas")
`
```

#### 方案 C：技能与工具融合

**思路**：将常用技能直接作为工具暴露

```typescript
// 不需要 Skill 工具，直接注册
registry.set('debug_plugin', createDebugTool());
registry.set('create_canvas', createCanvasTool());
```

**优点**：
- 更直观
- 不需要额外调用

**缺点**：
- 工具数量膨胀
- 失去技能的灵活性

#### 方案 D：智能技能加载

**思路**：根据问题自动加载相关技能

```typescript
// 在 FrontendAgent 中
async processMessage(message: string) {
  // 分析问题，判断需要的技能
  const neededSkills = this.analyzeSkillNeeds(message);

  // 预加载技能内容到系统提示
  const skillContext = await this.loadSkillsToContext(neededSkills);

  // 构建包含技能的系统提示
  const systemPrompt = await builder.buildSystemPrompt(..., skillContext);
}
```

### 推荐方案

**组合使用 A + B**：
1. 动态更新 Skill 工具描述，列出可用技能
2. 在系统提示中添加技能使用指南

---

## 优先级排序

| 优先级 | 问题 | 方案 | 工作量 | 影响 |
|--------|------|------|--------|------|
| P0 | 多轮调用 | A: 并行调用指导 | 小 | 高 |
| P0 | 等待焦虑 | A: 增强进度反馈 | 小 | 高 |
| P1 | Skill 系统 | A+B: 动态描述+指南 | 中 | 中 |
| P2 | 多轮调用 | C: 降低迭代+智能终止 | 中 | 中 |
| P2 | 等待焦虑 | C: 预估+承诺 | 中 | 中 |

---

## 下一步行动

1. **立即执行（P0）**：
   - 修改系统提示，指导并行调用工具
   - 增强进度反馈 UI

2. **后续迭代（P1）**：
   - 动态更新 Skill 工具描述
   - 添加技能使用指南

3. **评估后决定（P2）**：
   - 是否降低最大迭代
   - 是否实现预估+承诺
