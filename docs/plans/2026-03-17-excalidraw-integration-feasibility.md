# Excalidraw 可视化集成可行性方案

> 文档创建日期: 2026-03-17
> 最后更新: 2026-03-17
> 状态: ✅ 实施完成
> 评审状态: ✅ 已通过

## 1. 背景与目标

### 1.1 需求背景

DeepReader 作为 PDF 智能阅读插件，用户在阅读过程中会产生大量知识关联。将这些知识可视化（思维导图/知识图谱）可以：

1. 帮助用户理解书籍结构
2. 展示概念之间的关系
3. 提供可视化的知识回顾
4. 增强记忆和理解

### 1.2 与 Canvas Tool 的定位

> **Excalidraw Tool 与 Canvas Tool 是平行的关系**，功能完全一致，只是输出格式不同。

| 特性 | Canvas Tool | Excalidraw Tool |
|------|-------------|-----------------|
| **依赖** | 无（原生） | 需安装 Excalidraw 插件 |
| **输出格式** | `.canvas` (JSON) | `.excalidraw.md` |
| **风格** | 标准矩形节点 | 手绘风格 |
| **可编辑性** | Obsidian Canvas | Excalidraw 编辑器 |
| **导出** | JSON 格式 | PNG/SVG/PDF |
| **定位** | 原生可视化 | 高级编辑/手绘风格 |

### 1.3 目标

- ✅ 直接通过 AI Agent 调用 Excalidraw API 生成可视化图形
- ✅ 支持思维导图、知识图谱生成
- ✅ 生成的图形可在 Excalidraw 中进一步编辑
- ✅ 复用 Obsidian 生态，避免重复开发

---

## 2. 技术方案分析

### 2.1 集成路径对比

| 方案 | 方式 | 优点 | 缺点 | 推荐度 |
|------|------|------|------|--------|
| **A. Excalidraw Automate API** | 调用已安装插件的 API | 复用用户插件、功能强大、手绘风格 | 依赖用户安装 Excalidraw | ⭐⭐⭐⭐⭐ |
| **B. NPM 包 @excalidraw/excalidraw** | 作为 React 组件嵌入 | 独立、不依赖其他插件 | 需要嵌入整个编辑器、与 Obsidian 生态脱节 | ⭐⭐ |
| **C. 自研 Canvas 方案** | 自己实现绘图 | 完全可控 | 开发成本高、功能有限 | ⭐ |

**结论**: 推荐方案 A - 使用 Obsidian Excalidraw 插件的 Automate API

---

## 3. Excalidraw Automate API 详解

### 3.1 TypeScript 类型定义

> **关键**: 需要在 `global.d.ts` 中添加类型声明

```typescript
// frontend/src/types/excalidraw.d.ts

/**
 * Excalidraw Automate API 类型定义
 * 文档: https://zsviczian.github.io/obsidian-excalidraw-plugin/API/objects.html
 */

type ConnectionPoint = "top" | "bottom" | "left" | "right";
type ArrowHead = "none" | "arrow" | "dot" | "bar";
type BoxType = "box" | "blob" | "ellipse" | "diamond";

interface TextFormatting {
  wrapAt?: number;
  width?: number;
  height?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  box?: BoxType;
  boxPadding?: number;
}

interface ConnectOptions {
  numberOfPoints?: number;
  startArrowHead?: ArrowHead;
  endArrowHead?: ArrowHead;
  padding?: number;
}

interface CreateOptions {
  filename?: string;
  foldername?: string;
  template?: string;
  onNewPane?: boolean;
  silent?: boolean;
}

interface ExcalidrawAutomate {
  // 版本信息
  version: string;

  // 创建元素
  addRect(topX: number, topY: number, width: number, height: number): string;
  addDiamond(topX: number, topY: number, width: number, height: number): string;
  addEllipse(topX: number, topY: number, width: number, height: number): string;
  addText(topX: number, topY: number, text: string, formatting?: TextFormatting, id?: string): string;
  addLine(points: Array<[number, number]>): string;
  addArrow(points: Array<[number, number]>, formatting?: { startArrowHead?: ArrowHead; endArrowHead?: ArrowHead }): string;

  // 连接元素
  connectObjects(
    objectA: string,
    connectionA: ConnectionPoint,
    objectB: string,
    connectionB: ConnectionPoint,
    formatting?: ConnectOptions
  ): void;

  // 分组
  addToGroup(objectIds: string[]): string;

  // 画布操作
  create(options?: CreateOptions): Promise<void>;
  clear(): void;
  save(): Promise<void>;
  close(): void;

  // 视图
  setView(view: any): void;
  getExcalidrawAPI(): any;

  // 样式
  copyElementLook(sourceId: string, targetId: string): void;

  // 元素操作
  deleteElements(elementIds: string[]): void;
  getElements(): any[];
  getElement(id: string): any | undefined;
}

declare global {
  interface Window {
    ExcalidrawAutomate?: ExcalidrawAutomate;
  }
}

export { ExcalidrawAutomate, ConnectionPoint, ArrowHead, BoxType, TextFormatting, ConnectOptions, CreateOptions };
```

### 3.2 API 访问方式

Excalidraw Automate API 通过 `window.ExcalidrawAutomate` 全局对象暴露：

```typescript
// 检查 Excalidraw 插件是否安装
const ea = window.ExcalidrawAutomate;
if (!ea) {
  // 提示用户安装 Excalidraw 插件
  return;
}
```

### 3.2 核心 API 功能

#### 3.2.1 创建图形元素

```typescript
// 矩形节点
const rectId = ea.addRect(topX, topY, width, height);

// 菱形节点（适合决策点）
const diamondId = ea.addDiamond(topX, topY, width, height);

// 椭圆节点（适合概念）
const ellipseId = ea.addEllipse(topX, topY, width, height);

// 文本（可包裹在形状中）
const textId = ea.addText(topX, topY, "概念名称", {
  box: "box",        // "box" | "blob" | "ellipse" | "diamond"
  textAlign: "center",
  boxPadding: 10
});
```

#### 3.2.2 连接元素

```typescript
// 连接两个元素
type ConnectionPoint = "top" | "bottom" | "left" | "right";

ea.connectObjects(
  objectAId, "right",
  objectBId, "left",
  {
    numberOfPoints: 0,        // 中间断点数量
    startArrowHead: "none",
    endArrowHead: "arrow"     // "none" | "arrow" | "dot" | "bar"
  }
);
```

#### 3.2.3 分组与样式

```typescript
// 分组元素
const groupId = ea.addToGroup([id1, id2, id3]);

// 设置元素样式
ea.copyElementLook(sourceId, targetId);
```

#### 3.2.4 创建新画布

```typescript
// 创建新的 Excalidraw 文件
await ea.create({
  filename: "知识图谱-书名",
  foldername: "DeepReader/Mindmaps",
  template: "Template.md",  // 可选模板
  onNewPane: false          // 是否在新面板打开
});
```

### 3.3 完整工作流示例

```typescript
async function createMindmap(concepts: Concept[]) {
  const ea = window.ExcalidrawAutomate;
  if (!ea) {
    new Notice("请先安装 Excalidraw 插件");
    return;
  }

  // 1. 创建新画布
  await ea.create({
    filename: "知识图谱",
    foldername: "DeepReader/Mindmaps"
  });

  // 2. 清空画布
  ea.clear();

  // 3. 创建中心节点
  const centerX = 400;
  const centerY = 300;
  const centerId = ea.addText(centerX, centerY, "核心概念", {
    box: "ellipse",
    textAlign: "center"
  });

  // 4. 创建子节点并连接
  const radius = 200;
  concepts.forEach((concept, index) => {
    const angle = (2 * Math.PI * index) / concepts.length;
    const x = centerX + radius * Math.cos(angle) - 50;
    const y = centerY + radius * Math.sin(angle) - 15;

    const nodeId = ea.addText(x, y, concept.name, {
      box: "box",
      textAlign: "center"
    });

    // 连接到中心
    ea.connectObjects(centerId, "right", nodeId, "left", {
      endArrowHead: "arrow"
    });
  });

  // 5. 保存
  await ea.save();
}
```

---

## 4. DeepReader 集成设计

### 4.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                      DeepReader Plugin                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │   PDF 内容   │ -> │   概念提取服务   │ -> │  可视化服务  │ │
│  │   (后端)    │    │    (后端/前端)   │    │  (前端)     │ │
│  └─────────────┘    └─────────────────┘    └──────┬──────┘ │
└─────────────────────────────────────────────────────┼───────┘
                                                      │
                                                      ▼
                                          ┌──────────────────┐
                                          │   Excalidraw     │
                                          │   Automate API   │
                                          │  (外部插件依赖)   │
                                          └──────────────────┘
```

### 4.2 前端模块设计

```typescript
// frontend/src/services/excalidraw-service.ts

export interface ConceptNode {
  id: string;
  label: string;
  type: "concept" | "chapter" | "quote" | "author";
  children?: ConceptNode[];
}

export interface ConceptRelation {
  from: string;
  to: string;
  label?: string;
  type: "hierarchy" | "reference" | "contrast";
}

export class ExcalidrawService {
  private ea: ExcalidrawAutomate | null = null;

  constructor() {
    this.checkAvailability();
  }

  /**
   * 检查 Excalidraw 插件是否可用
   */
  isAvailable(): boolean {
    return !!window.ExcalidrawAutomate;
  }

  /**
   * 生成思维导图
   */
  async generateMindmap(
    title: string,
    concepts: ConceptNode[],
    relations: ConceptRelation[]
  ): Promise<string | null> {
    // 实现见下文
  }

  /**
   * 生成知识图谱
   */
  async generateKnowledgeGraph(
    title: string,
    concepts: ConceptNode[],
    relations: ConceptRelation[]
  ): Promise<string | null> {
    // 实现见下文
  }
}
```

### 4.3 UI 集成点

1. **阅读工具栏**: 添加"生成思维导图"按钮
2. **章节导航**: 右键菜单 -> "可视化章节结构"
3. **对话结果**: AI 回复中包含概念关系时，提供"可视化"选项
4. **命令面板**: `DeepReader: 生成当前书籍的知识图谱`

### 4.4 数据来源

```
┌──────────────────────────────────────────────────────┐
│                    数据来源                           │
├──────────────────────────────────────────────────────┤
│  1. 后端索引数据                                      │
│     - 目录结构 (TOC)                                  │
│     - 关键词提取                                      │
│     - 概念实体                                        │
│                                                      │
│  2. AI 对话提取                                      │
│     - 用户提问触发                                    │
│     - AI 返回概念关系 JSON                            │
│                                                      │
│  3. 用户标注                                         │
│     - 高亮文本                                        │
│     - 笔记关联                                        │
└──────────────────────────────────────────────────────┘
```

---

## 5. 实现计划

### 5.0 前置准备

- [x] 方案评审通过
- [x] 创建 TypeScript 类型定义文件 (`frontend/src/types/excalidraw.d.ts`)

### 5.1 Phase 1: 基础集成 ✅ 已完成

**目标**: 实现 Canvas → Excalidraw 转换

- [x] 创建 `ExcalidrawService` 服务类
  - 插件检测和版本验证
  - 错误处理和降级策略
  - Canvas → Excalidraw 转换逻辑
- [x] 实现 `convertCanvasToExcalidraw` 转换函数
  - Canvas Node → Excalidraw 元素映射
  - Canvas Edge → Excalidraw 连接线映射
- [x] 在 Canvas Tool 中添加 `export_to_excalidraw` action
- [x] 构建验证通过

### 5.2 Phase 2: 功能增强 ✅ 已完成

- [x] 增强 ExcalidrawService
  - `createKnowledgeGraph()` - 知识图谱生成
  - `createFromConceptData()` - 从概念数据创建可视化
- [x] 添加命令面板命令
  - `DeepReader: Export Canvas to Excalidraw` - 导出当前 Canvas
  - `DeepReader: Check Excalidraw Plugin Status` - 检查插件状态
- [x] 构建验证通过

### 5.3 Phase 3: 体验优化 (待实施)

- [ ] 模板系统（预设样式）
- [ ] 导出选项（PNG/SVG）
- [ ] 与笔记的双向链接

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 用户未安装 Excalidraw | 功能不可用 | 提供友好提示，引导安装 |
| API 版本不兼容 | 功能异常 | 检测版本，提供降级方案 |
| 大量节点性能问题 | 渲染缓慢 | 限制节点数量，分页生成 |
| 布局算法复杂 | 开发周期长 | 使用简单布局，后续优化 |

---

## 7. 参考资源

### 官方文档
- [Excalidraw Automate API](https://zsviczian.github.io/obsidian-excalidraw-plugin/API/objects.html)
- [Excalidraw Script Engine](https://zsviczian.github.io/obsidian-excalidraw-plugin/ExcalidrawScriptsEngine.html)
- [完整 API 文档 (LLM Training)](https://raw.githubusercontent.com/zsviczian/obsidian-excalidraw-plugin/refs/heads/master/docs/AITrainingData/ExcalidrawAutomate%20full%20library%20for%20LLM%20training.md)

### Obsidian 插件间通信
- [Inter-plugin Communication](https://forum.obsidian.md/t/inter-plugin-communication-expose-api-to-other-plugins/23618)
- [@vanakat/plugin-api](https://github.com/vanakat/plugin-api)

### 示例脚本
- [Excalidraw Scripts Library](https://github.com/zsviczian/obsidian-excalidraw-plugin/wiki/Excalidraw-Script-Engine-scripts-library)
- [Community Scripts](https://github.com/Bowen-0x00/obsidian-excalidraw-scripts)

---

## 8. 结论

**可行性评估: ✅ 高度可行**

Excalidraw Automate API 提供了完整的程序化创建图形的能力，非常适合 DeepReader 的可视化需求：

1. ✅ API 功能完善，支持节点创建、连接、样式设置
2. ✅ 可以复用用户已安装的 Excalidraw 插件
3. ✅ 生成的图形可编辑，用户体验好
4. ✅ 与 Obsidian 生态深度集成

**建议优先级**: 中等（可作为增强功能，不影响核心阅读体验）

**下一步行动**:
1. 确认用户需求优先级
2. 如决定实现，从 Phase 1 开始
