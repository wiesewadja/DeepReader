# DeepReader Skill 平台改进方案

## 1. 现状分析

### 1.1 当前实现

DeepReader 当前有一个基础的 Skill 系统：

**目录结构：**
```
frontend/src/agent/skills/
├── index.ts      # 模块导出
├── loader.ts     # SkillLoader 类
└── types.ts      # Skill 类型定义

frontend/src/
├── built-in-skills.ts  # 内置 Skill 定义（硬编码）
└── main.ts             # 启动时同步 Skill 到 vault
```

**Skill 存储位置：**
```
vault/DeepReader/skills/
├── reading-progress.md   # 内置：阅读进度感知
├── knowledge-cards.md    # 内置：知识卡片生成
└── reading-notes.md      # 内置：读书笔记生成
```

**Skill 类型定义：**
```typescript
interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  isDefault: boolean;
  keywords?: string[];
  bookTypes?: string[];
  meta?: {
    version?: string;
    author?: string;
    tags?: string[];
  };
}
```

**加载机制：**
- Layer 1: `name + description` 始终加载到 System Prompt（`getDescriptions()`）
- Layer 2: `body` 按需加载 via `Skill` tool（`getSkillContent()`）

**内置 Skill 同步流程：**
1. 插件启动时调用 `syncSkillsToVault()`
2. 检查 `vault/DeepReader/skills/` 目录是否存在
3. 遍历 `BUILT_IN_SKILLS`，仅当目标文件不存在时写入
4. 不覆盖用户修改的 Skill

### 1.2 已有优点

| 特性 | 实现情况 |
|------|----------|
| ✅ 分层加载 | Layer 1 摘要 + Layer 2 按需 |
| ✅ 路径安全 | 防止路径遍历攻击 |
| ✅ 内置 Skill | 3 个实用技能（阅读进度、知识卡片、读书笔记） |
| ✅ 用户可扩展 | 用户可在 vault 中添加自定义 Skill |
| ✅ 不覆盖用户修改 | 内置 Skill 仅在不存在时写入 |
| ✅ YAML frontmatter | 支持 name, description, keywords, default 等字段 |

### 1.3 待改进点

| 特性 | 当前状态 | 改进方向 |
|------|----------|----------|
| ❌ 目录结构 | 仅支持单文件 `.md` | 支持 `SKILL.md + references/ + assets/` |
| ❌ 依赖检查 | 无 | 检查 Obsidian 插件、后端连接状态 |
| ❌ 可用性状态 | 无 | 显示 Skill 是否可用（依赖是否满足） |
| ❌ 多源优先级 | 无 | vault 覆盖内置 |
| ❌ 元数据 | 简单字段 | 扩展平铺字段（emoji, requiresBackend 等） |
| ❌ Markdown 摘要 | 简单列表 | 表格格式，显示状态和链接 |

### 1.4 与 nanobot 对比

| 特性 | DeepReader (当前) | nanobot | 改进后目标 |
|------|------------------|---------|------------|
| 文件格式 | 单文件 `.md` | 目录 `SKILL.md + resources/` | 两者兼容 |
| 资源支持 | ❌ | ✅ scripts/, references/, assets/ | ✅ references/, assets/ (无 scripts) |
| 依赖检查 | ❌ | ✅ bins/env | ✅ plugins/backend (Obsidian 适配) |
| 优先级覆盖 | ❌ | ✅ workspace > builtin | ✅ vault > builtin |
| 可用性状态 | ❌ | ✅ available 属性 | ✅ |
| 渐进式加载 | ✅ 两层 | ✅ 三层 | ✅ 三层 |
| 内置 Skill 同步 | ✅ 不覆盖 | - | ✅ 保持 |

### 1.5 核心差距

1. **缺少资源目录支持**：无法打包参考文档、模板等
2. **无依赖检查机制**：无法声明和验证所需插件/后端功能
3. **单文件限制**：复杂技能难以组织，内容膨胀
4. **摘要格式简单**：无法显示可用性状态和链接

---

## 2. 改进目标

### 2.1 设计原则

参考 nanobot 的成功经验，遵循以下原则：

1. **简洁至上**：Skill 是给 Agent 的"入职指南"，而非完整文档
2. **渐进式加载**：元数据 → SKILL.md → references/scripts
3. **人类可读**：Markdown 格式，易于创建和编辑
4. **上下文意识**：每个字节都要 justify 其 token 成本

### 2.2 目标架构

```
┌─────────────────────────────────────────────────────────────────┐
│                  DeepReader Skill Platform v2                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Skill Sources                             ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ ││
│  │  │ Built-in    │  │ Workspace   │  │ User Vault          │ ││
│  │  │ (plugin)    │  │ (~/.deep-   │  │ (vault/.deepreader/ │ ││
│  │  │             │  │  reader/)   │  │  skills/)           │ ││
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SkillLoader v2                            ││
│  │  ├─ Discovery (多源扫描)                                     ││
│  │  ├─ Validation (依赖检查)                                    ││
│  │  ├─ Priority (vault > workspace > builtin)                   ││
│  │  └─ Context Building (渐进式)                                ││
│  └─────────────────────────────────────────────────────────────┘│
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Agent Context                             ││
│  │  ┌───────────┐  ┌───────────────┐  ┌─────────────────────┐ ││
│  │  │ System    │  │ Skills XML    │  │ On-Demand           │ ││
│  │  │ Prompt    │  │ Summary       │  │ (via Skill tool)    │ ││
│  │  └───────────┘  └───────────────┘  └─────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 详细设计

### 3.1 新 Skill 目录结构

```
skill-name/
├── SKILL.md (必需)
│   ├── YAML frontmatter
│   └── Markdown 指令
├── references/ (可选)
│   └── 参考文档（详细说明、最佳实践等）
└── assets/ (可选)
    └── 模板、示例文件等
```

> **为什么不支持 scripts/**：Obsidian 插件运行在浏览器/Electron 渲染进程中，无法执行 shell 脚本。
> 如需复杂处理，应：
> - 将逻辑移至后端 API（如 OCR、PDF 处理）
> - 或使用 Obsidian 插件 API 实现

### 3.2 增强的 Frontmatter 规范

> **设计约束**：由于 Obsidian 插件环境限制，YAML 解析器保持简单实现，使用平铺字段而非嵌套结构。

```yaml
---
name: skill-name                          # 必需
description: "详细描述，包含触发条件"        # 必需
emoji: "📚"                               # 显示图标
always: false                             # 始终加载完整内容
requiresPlugins:                          # 需要的 Obsidian 插件
  - dataview
requiresBackend: true                     # 需要后端连接
requiresBackendFeatures:                  # 需要的后端功能
  - ocr
  - embedding
---
```

**新增字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `emoji` | string | 显示图标 |
| `always` | boolean | 始终加载完整内容到 System Prompt |
| `requiresPlugins` | string[] | 需要的 Obsidian 插件 |
| `requiresBackend` | boolean | 是否需要后端连接 |
| `requiresBackendFeatures` | string[] | 需要的后端功能 |

### 3.3 Markdown 格式的 Skills 摘要

保持 Obsidian 完全兼容，使用纯 Markdown 格式：

```markdown
## 可用技能

| 技能 | 描述 | 状态 |
|------|------|------|
| 📖 [book-summary](DeepReader/skills/book-summary/SKILL.md) | 生成书籍摘要和读书笔记 | ✅ 可用 |
| 🔍 [ocr-extract](DeepReader/skills/ocr-extract/SKILL.md) | OCR 文字提取 | ❌ 需要后端连接 |

> 💡 点击技能名称查看详情，状态为 ❌ 的技能需要先安装依赖
```

**设计原则**：
- 使用 Obsidian 原生的表格和链接语法
- 技能名称是可点击的 wikilink
- 状态使用 emoji 直观显示
- 完全在 Obsidian 中可读可编辑

### 3.4 渐进式加载策略（Obsidian 友好）

```
Level 1: Metadata (始终加载，~100 words/skill)
├─ name + description
├─ available 状态
└─ location 路径

Level 2: SKILL.md body (按需加载，<5k words)
├─ 核心工作流程
├─ 命令示例
└─ references 链接

Level 3: Bundled Resources (Agent 自行决定)
├─ references/ (可读取，详细文档)
└─ assets/ (可复制，模板文件)
```

### 3.5 依赖检查机制

> **注意**：作为 Obsidian 插件，DeepReader 运行在浏览器/Electron 环境中，无法直接执行 CLI 命令。
> 因此依赖检查主要针对 Obsidian 插件和后端服务连接状态。

```typescript
interface SkillRequirements {
  plugins?: string[];           // requiresPlugins 字段
  backend?: boolean;            // requiresBackend 字段
  backendFeatures?: string[];   // requiresBackendFeatures 字段
}

class SkillLoader {
  private checkRequirements(skill: Skill): {
    available: boolean;
    missing: string[];
  } {
    const missing: string[] = [];

    // 检查 Obsidian 插件
    for (const plugin of skill.requiresPlugins || []) {
      if (!this.pluginManager.isPluginEnabled(plugin)) {
        missing.push(`Plugin: ${plugin}`);
      }
    }

    // 检查后端连接
    if (skill.requiresBackend) {
      if (!this.backendClient.isConnected()) {
        missing.push(`Backend: 未连接`);
      } else {
        // 检查后端功能
        for (const feature of skill.requiresBackendFeatures || []) {
          if (!this.backendClient.hasFeature(feature)) {
            missing.push(`Backend: 缺少 ${feature} 功能`);
          }
        }
      }
    }

    return {
      available: missing.length === 0,
      missing
    };
  }
}
```

**适用场景**：
- `requiresPlugins: ["dataview"]` - 需要 Dataview 插件
- `requiresBackend: true` - 需要后端服务连接
- `requiresBackendFeatures: ["ocr"]` - 需要后端 OCR 功能

### 3.6 多源加载与优先级

```
优先级 (高 → 低):

1. Vault Skills
   vault/DeepReader/skills/
   - 用户在 vault 内的自定义技能
   - 可覆盖所有其他来源
   - 完全在 Obsidian 中可读可编辑

2. Built-in Skills
   plugin/skills/
   - 随插件分发的内置技能
   - 提供基础功能
```

> **路径说明**：Vault 内的技能存放在 `vault/DeepReader/skills/` 目录下，
> 与其他 DeepReader 数据（如笔记、索引）保持一致。

---

## 4. 实现计划

### Phase 1: 核心重构 (P0)

**目标**：支持目录结构 + 增强元数据

**改动**：
1. 重构 `SkillLoader` 支持目录扫描
2. 扩展 `Skill` 类型定义
3. 实现 Markdown 格式的 `buildSkillsSummary()`
4. 添加依赖检查逻辑（插件 + 后端）

**文件**：
- `frontend/src/agent/skills/loader.ts` - 重构
- `frontend/src/agent/skills/types.ts` - 扩展
- `frontend/src/agent/skills/validator.ts` - 新增

### Phase 2: 资源支持 (P1)

**目标**：支持 references/assets（暂不支持 scripts，见下文）

**改动**：
1. 添加 `read_skill_resource` tool
2. 实现资源路径解析
3. 支持 references/ 参考文档
4. 支持 assets/ 模板文件

> **关于 scripts/**：由于 Obsidian 插件运行在浏览器环境，无法直接执行 shell 脚本。
> 如需复杂处理，应：
> - 将逻辑移至后端 API
> - 或使用 Obsidian 插件 API 实现

**文件**：
- `frontend/src/agent/tools/skill-resource.ts` - 新增
- `frontend/src/agent/skills/resources.ts` - 新增

### Phase 3: 多源管理 (P2)

**目标**：支持 vault/builtin 两级来源

**改动**：
1. 实现多源扫描（vault/DeepReader/skills/ + plugin/skills/）
2. 优先级合并逻辑（vault 优先）
3. 配置界面支持

**文件**：
- `frontend/src/agent/skills/sources.ts` - 新增
- `frontend/src/views/SkillManagerView.ts` - 新增

### Phase 4: 生态集成 (P3)

**目标**：技能分享和发现

**改动**：
1. 设计 `.skill` 打包格式
2. 实现导入/导出
3. 探索 ClawHub 集成

**文件**：
- `frontend/src/agent/skills/packager.ts` - 新增
- `frontend/src/agent/skills/importer.ts` - 新增

---

## 5. API 变更

### 5.1 SkillLoader 新接口

```typescript
class SkillLoader {
  // 初始化
  constructor(options: {
    vaultPath: string;              // Obsidian vault 路径
    builtinPath?: string;           // 插件内置技能路径
  });

  // 扫描所有来源
  async loadSkills(): Promise<void>;

  // 获取 Markdown 格式摘要（Obsidian 友好）
  buildSkillsSummary(): string;

  // 检查技能可用性
  checkAvailability(skillName: string): {
    available: boolean;
    missing: string[];
  };

  // 获取技能资源
  getResource(skillName: string, resourcePath: string): string | Buffer | null;

  // 列出技能资源
  listResources(skillName: string): string[];
}
```

### 5.2 新 Tool: read_skill_resource

```typescript
{
  name: 'read_skill_resource',
  description: 'Read a resource file from a loaded skill',
  parameters: {
    skill: 'string',      // skill name
    path: 'string',       // relative path in skill directory
    type: 'text|binary'   // how to return the content
  }
}
```

### 5.3 Obsidian API Tools 扩展：Canvas Tool

> **核心思想**：Skill 是给 Agent 的指令，Tool 是执行操作的代码。Skill 指导 Agent 如何使用 Tool 来调用 Obsidian API。

#### 5.3.1 设计理念

```
┌─────────────┐     指导如何使用      ┌─────────────┐
│   Skill     │ ──────────────────▶ │    Agent    │
│  (Markdown) │                      │    (LLM)    │
└─────────────┘                      └──────┬──────┘
                                           │
                                           │ 调用
                                           ▼
                                    ┌─────────────┐
                                    │    Tool     │
                                    │ (TypeScript)│
                                    └──────┬──────┘
                                           │
                                           │ 执行
                                           ▼
                                    ┌─────────────┐
                                    │  Obsidian   │
                                    │     API     │
                                    └─────────────┘
```

#### 5.3.2 Canvas Tool 定义

```typescript
// frontend/src/agent/tools/canvas.ts

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import type { CanvasData, CanvasNodeData, CanvasEdgeData } from 'obsidian';

const CANVAS_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'canvas',
    description: 'Create or modify Obsidian Canvas files. Use this to create visual diagrams, mind maps, or knowledge graphs.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'add_node', 'add_edge', 'get', 'list'],
          description: 'Action to perform'
        },
        path: {
          type: 'string',
          description: 'Canvas file path (e.g., "Canvas/mind-map.canvas")'
        },
        nodes: {
          type: 'array',
          description: 'Nodes to add (for create/add_node)',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['text', 'file', 'link', 'group'] },
              text: { type: 'string', description: 'Text content (for text nodes)' },
              file: { type: 'string', description: 'File path (for file nodes)' },
              url: { type: 'string', description: 'URL (for link nodes)' },
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number', default: 250 },
              height: { type: 'number', default: 60 },
              color: { type: 'string', description: 'Node color' }
            }
          }
        },
        edges: {
          type: 'array',
          description: 'Edges to add (for create/add_edge)',
          items: {
            type: 'object',
            properties: {
              fromNode: { type: 'string', description: 'Source node ID' },
              toNode: { type: 'string', description: 'Target node ID' },
              label: { type: 'string', description: 'Edge label' },
              color: { type: 'string' }
            }
          }
        }
      },
      required: ['action']
    }
  }
};

export function createCanvasTool(app: App): ToolExecutor {
  return {
    definition: CANVAS_DEFINITION,

    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const { action, path, nodes, edges } = args;

      switch (action) {
        case 'create': {
          if (!path) return 'Error: path is required for create action';

          const canvasData: CanvasData = {
            nodes: (nodes as CanvasNodeData[]) || [],
            edges: (edges as CanvasEdgeData[]) || []
          };

          // 使用 Obsidian API 创建文件
          const file = await app.vault.create(path, JSON.stringify(canvasData, null, 2));
          return `Created canvas: ${file.path}`;
        }

        case 'add_node': {
          if (!path || !nodes) return 'Error: path and nodes are required';

          const file = app.vault.getAbstractFileByPath(path);
          if (!file) return `Error: Canvas file not found: ${path}`;

          const content = await app.vault.read(file);
          const canvasData: CanvasData = JSON.parse(content);

          // 添加新节点，自动计算位置避免重叠
          const newNodes = (nodes as CanvasNodeData[]).map((node, i) => ({
            ...node,
            id: generateId(),
            x: node.x ?? (canvasData.nodes.length * 280),
            y: node.y ?? (i * 100)
          }));

          canvasData.nodes.push(...newNodes);
          await app.vault.modify(file, JSON.stringify(canvasData, null, 2));

          return `Added ${newNodes.length} nodes to ${path}`;
        }

        case 'add_edge': {
          if (!path || !edges) return 'Error: path and edges are required';

          const file = app.vault.getAbstractFileByPath(path);
          if (!file) return `Error: Canvas file not found: ${path}`;

          const content = await app.vault.read(file);
          const canvasData: CanvasData = JSON.parse(content);

          const newEdges = (edges as CanvasEdgeData[]).map(edge => ({
            ...edge,
            id: generateId()
          }));

          canvasData.edges.push(...newEdges);
          await app.vault.modify(file, JSON.stringify(canvasData, null, 2));

          return `Added ${newEdges.length} edges to ${path}`;
        }

        case 'get': {
          if (!path) return 'Error: path is required';

          const file = app.vault.getAbstractFileByPath(path);
          if (!file) return `Error: Canvas file not found: ${path}`;

          const content = await app.vault.read(file);
          return content;
        }

        case 'list': {
          const canvasFiles = app.vault.getFiles()
            .filter(f => f.extension === 'canvas')
            .map(f => f.path);

          return `Canvas files:\n${canvasFiles.map(p => `- ${p}`).join('\n')}`;
        }

        default:
          return `Error: Unknown action: ${action}`;
      }
    }
  };
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
```

#### 5.3.3 Canvas API 类型（来自 Obsidian 官方）

```typescript
// 参考：https://github.com/obsidianmd/obsidian-api/blob/master/canvas.d.ts

export interface CanvasData {
  nodes: AllCanvasNodeData[];
  edges: CanvasEdgeData[];
}

export type AllCanvasNodeData =
  | CanvasTextData
  | CanvasFileData
  | CanvasLinkData
  | CanvasGroupData;

export interface CanvasNodeData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: CanvasColor;
}

export interface CanvasTextData extends CanvasNodeData {
  type: 'text';
  text: string;
}

export interface CanvasFileData extends CanvasNodeData {
  type: 'file';
  file: string;  // 文件路径
}

export interface CanvasLinkData extends CanvasNodeData {
  type: 'link';
  url: string;
}

export interface CanvasGroupData extends CanvasNodeData {
  type: 'group';
  label?: string;
}

export interface CanvasEdgeData {
  id: string;
  fromNode: string;    // 源节点 ID
  fromSide?: NodeSide; // 'top' | 'right' | 'bottom' | 'left'
  toNode: string;      // 目标节点 ID
  toSide?: NodeSide;
  color?: CanvasColor;
  label?: string;      // 边的标签
}

export type NodeSide = 'top' | 'right' | 'bottom' | 'left';
export type CanvasColor = '1' | '2' | '3' | '4' | '5' | '6'; // 预设颜色
```

#### 5.3.4 使用 Canvas Tool 的 Skill 示例

**关键点：Skill 必须教 AI "如何思考"和"如何结构化"，而不仅仅是调用 API。**

```markdown
---
name: knowledge-graph
description: "创建知识图谱 Canvas。将书籍概念可视化为节点图。"
emoji: "🕸️"
keywords:
  - 概念图
  - 知识图谱
  - 思维导图
  - 关系图
  - 可视化
---

# 知识图谱生成

## 触发场景

- "帮我画一个这本书的概念图谱"
- "生成知识网络图"
- "可视化这些概念之间的关系"
- "把这个章节的内容做成思维导图"

## 核心思路

将非结构化文本转换为结构化图谱，需要经过 **提取 → 分类 → 关联 → 布局** 四个步骤。

## 步骤 1：提取实体

从内容中识别以下类型的实体：

| 实体类型 | 示例 | 节点颜色 |
|---------|------|---------|
| 核心概念 | "民主"、"自由市场" | `1` (红) |
| 人物/机构 | "柏拉图"、"联合国" | `2` (橙) |
| 事件/时期 | "文艺复兴"、"冷战" | `3` (黄) |
| 方法/理论 | "三段论"、"博弈论" | `4` (绿) |
| 案例/例子 | "雅典民主"、"2008金融危机" | `5` (蓝) |
| 结论/观点 | "权力导致腐败" | `6` (紫) |

**提取规则：**
- 每个实体必须是"值得记住"的独立概念
- 避免过于细碎（如"第一章"）或过于宽泛（如"历史"）
- 通常提取 5-15 个核心实体

## 步骤 2：确定关系

识别实体之间的关系类型：

| 关系类型 | 示例 | 边标签 |
|---------|------|--------|
| 层级 | 章节 → 小节 | "包含" |
| 因果 | 工业革命 → 城市化 | "导致" |
| 对比 | 民主 vs 专制 | "对立" |
| 支持 | 证据 → 论点 | "支持" |
| 组成 | 零件 → 整体 | "组成" |
| 时间 | 事件A → 事件B | "先于" |

## 步骤 3：布局算法

采用**层次布局**或**力导向布局**：

```
层次布局（适合有层级关系的内容）：
- 顶层：核心主题（y=0）
- 中层：主要分支（y=200）
- 底层：具体案例（y=400）
- 水平间距：300px
- 垂直间距：200px

力导向布局（适合网络关系）：
- 核心节点放在中心 (x=400, y=300)
- 相关节点围绕分布
- 连接越多越靠近中心
```

## 步骤 4：生成 Canvas

使用 `canvas` tool 创建图谱：

```json
{
  "action": "create",
  "path": "Canvas/{书名}-知识图谱.canvas",
  "nodes": [
    {
      "id": "node-1",
      "type": "text",
      "text": "# 民主\n\n人民统治的政治制度",
      "x": 400,
      "y": 0,
      "width": 250,
      "height": 120,
      "color": "1"
    },
    {
      "id": "node-2",
      "type": "text",
      "text": "# 雅典民主\n\n直接民主的典型",
      "x": 100,
      "y": 200,
      "width": 250,
      "height": 100,
      "color": "5"
    },
    {
      "id": "node-3",
      "type": "file",
      "file": "DeepReader/政治学/03-民主制度.md",
      "x": 400,
      "y": 200,
      "width": 250,
      "height": 100,
      "color": "4"
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "fromNode": "node-1",
      "toNode": "node-2",
      "label": "典型案例",
      "fromSide": "bottom",
      "toSide": "top"
    },
    {
      "id": "edge-2",
      "fromNode": "node-1",
      "toNode": "node-3",
      "label": "详见",
      "fromSide": "bottom",
      "toSide": "top"
    }
  ]
}
```

## 完整工作流程

```
用户请求 → search_doc 获取内容 → 分析提取实体 → 确定关系 → 计算布局 → canvas 创建文件
```

1. **获取内容**：使用 `search_doc` 或 `get_chapter` 获取相关文本
2. **分析内容**：识别核心概念、人物、事件、关系
3. **构建图谱**：按照上述规则生成 nodes 和 edges
4. **创建文件**：调用 `canvas` tool 写入 .canvas 文件
5. **返回结果**：告诉用户文件路径

## 注意事项

- **不要过度复杂化**：节点数量控制在 5-15 个
- **标签要简洁**：边标签不超过 4 个字
- **颜色有意义**：相同类型的节点用相同颜色
- **关联笔记**：如果有对应的笔记文件，使用 `file` 类型节点
```

---

**设计要点总结**：

| 要点 | 说明 |
|------|------|
| **明确的提取规则** | 告诉 AI 什么样的内容应该成为节点 |
| **分类体系** | 提供实体类型和颜色对应关系 |
| **关系词汇表** | 提供标准的边标签，避免随意创造 |
| **布局算法** | 给出具体的坐标计算方法 |
| **数量限制** | 避免生成过于复杂的图谱 |
| **完整示例** | JSON 格式的完整示例，AI 可以模仿 |

#### 5.3.5 Tool 注册更新

```typescript
// frontend/src/agent/tools/index.ts

import { createCanvasTool } from './canvas.js';

export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext,
  app: App  // 添加 Obsidian App 实例
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // ... 现有工具注册 ...

  // 注册 Canvas 工具
  registry.set('canvas', createCanvasTool(app));

  return registry;
}
```

---

## 6. 迁移指南

### 6.1 现有 Skill 迁移

现有单文件 Skill 无需立即迁移，系统同时支持两种格式：

```
DeepReader/skills/
├── legacy-skill.md          # 旧格式，继续支持
└── new-skill/               # 新格式
    └── SKILL.md
```

### 6.2 推荐迁移步骤

1. 创建目录 `new-skill/`
2. 移动 `new-skill.md` → `new-skill/SKILL.md`
3. 添加 `metadata.deepreader` 字段
4. 按需创建 `scripts/`, `references/`, `assets/`

---

## 7. 示例 Skill

### 7.1 简单 Skill (书籍摘要)

```
DeepReader/skills/book-summary/
└── SKILL.md
```

```markdown
---
name: book-summary
description: "生成书籍章节摘要。当用户要求总结章节、概括内容、提取要点时使用。"
emoji: "📖"
---

# 书籍摘要

## 使用场景

- 用户要求总结当前章节
- 需要快速了解章节核心观点
- 准备读书笔记

## 工作流程

1. 使用 `get_chapter` 获取章节全文
2. 识别核心论点和关键证据
3. 生成结构化摘要
4. 使用 [[wikilink]] 引用原文
```

### 7.2 复杂 Skill (OCR 提取)

```
DeepReader/skills/ocr-extract/
├── SKILL.md
└── references/
    └── ocr-best-practices.md
```

```markdown
---
name: ocr-extract
description: "从图片或扫描 PDF 中提取文字。当用户需要识别图片中的文字、处理扫描文档时使用。"
emoji: "🔍"
requiresBackend: true
requiresBackendFeatures:
  - ocr
---

# OCR 文字提取

## 前置条件

需要后端服务支持 OCR 功能。检查后端连接状态。

## 使用方法

1. 确保后端已连接（右上角状态指示器）
2. 使用 `extract_text` tool 提取图片文字
3. 支持中英文混合识别

## 高级配置

详见 [references/ocr-best-practices.md](references/ocr-best-practices.md)
```

> **说明**：OCR 等复杂功能通过后端 API 实现，而非本地脚本。

---

## 8. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 复杂度增加 | 中 | 保持向后兼容、渐进式迁移 |
| Token 膨胀 | 中 | 严格限制 SKILL.md 长度、按需加载 |
| 维护成本 | 低 | 复用 nanobot 设计模式 |
| 后端依赖 | 中 | 标记需要后端的技能、优雅降级 |

---

## 9. 后续探索

1. **ClawHub 集成**：探索与 nanobot 共享技能生态
2. **技能版本管理**：支持技能更新和回滚
3. **技能性能监控**：追踪技能使用频率和效果
4. **社区贡献**：建立 DeepReader 技能仓库

---

## 10. 参考资料

- [nanobot Skill Platform 分析](file:///Users/lizhao/workspace/mygithub/nanobot/docs/03_Skill_Platform_Analysis.md)
- [nanobot skill-creator Skill](file:///Users/lizhao/workspace/mygithub/nanobot/nanobot/skills/skill-creator/SKILL.md)
- [OpenClaw Skill 规范](https://github.com/openclaw/openclaw)
