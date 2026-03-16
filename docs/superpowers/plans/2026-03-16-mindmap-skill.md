# Mindmap Skill 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 canvas 工具中添加 mindmap action，实现放射状布局的思维导图绘制功能。

**Architecture:** 扩展 `canvas.ts` 工具，新增 `mindmap` action 接收 JSON 结构化数据，通过布局算法计算节点位置，生成 canvas 节点和边。

**Tech Stack:** TypeScript, Vitest, Obsidian Canvas API

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/agent/tools/canvas.ts` | 修改 | 添加 mindmap action 和布局算法 |
| `frontend/src/agent/tools/__tests__/canvas.test.ts` | 修改 | 添加 mindmap 测试用例 |
| `skills/mindmap.md` | 创建 | Agent Skill 文档（指导 AI 使用） |

---

## Chunk 1: 类型定义和布局算法

### Task 1: 添加 Mindmap 类型定义

**Files:**
- Modify: `frontend/src/agent/tools/canvas.ts` (在 CanvasData 接口后添加)

- [ ] **Step 1: 添加类型定义**

在 `CanvasData` 接口后（约第 55 行）添加以下类型：

```typescript
// Mindmap 类型定义
interface MindmapBranch {
  label: string;
  children?: MindmapChildNode[];
}

type MindmapChildNode = string | MindmapBranch;

interface MindmapInput {
  action: 'mindmap';
  path: string;
  topic: string;
  branches: MindmapBranch[];
}

// 布局计算用的内部节点
interface LayoutNode {
  id: string;
  text: string;
  level: number;        // 0=中心, 1=一级分支, 2+=子节点
  branchIndex: number;  // 所属分支索引（-1 表示中心）
  angle: number;        // 角度（弧度）
  distance: number;     // 距离中心的距离
  color: string;
  parentId?: string;
}
```

- [ ] **Step 2: 更新 action enum**

在 `CANVAS_DEFINITION` 的 `action` enum 中添加 `'mindmap'`：

```typescript
enum: ['create', 'add_node', 'add_edge', 'get', 'list', 'mindmap'],
```

---

### Task 2: 实现布局算法函数

**Files:**
- Modify: `frontend/src/agent/tools/canvas.ts` (在 generateId 函数后添加)

- [ ] **Step 1: 添加常量定义**

在 `generateId()` 函数后添加：

```typescript
// Mindmap 布局常量
const MINDMAP_COLORS = ['2', '3', '4', '5', '6']; // 分支颜色（1 保留给中心）
const MINDMAP_TOPIC_SIZE = { width: 300, height: 80 };
const MINDMAP_BRANCH_SIZE = { width: 250, height: 60 };
const MINDMAP_CHILD_SIZE = { width: 200, height: 50 };
const MINDMAP_BRANCH_RADIUS = 350;  // 一级分支距离中心
const MINDMAP_CHILD_SPACING = 220;  // 子节点层间距
```

- [ ] **Step 2: 实现 getSideFromAngle 函数**

```typescript
/**
 * 根据角度确定连接线的 fromSide/toSide
 */
function getSideFromAngle(angle: number): { fromSide: 'top' | 'right' | 'bottom' | 'left'; toSide: 'top' | 'right' | 'bottom' | 'left' } {
  // 标准化角度到 [0, 2π)
  const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // 判断方向（右、下、左、上）
  if (normalized >= Math.PI * 7 / 4 || normalized < Math.PI / 4) {
    return { fromSide: 'right', toSide: 'left' };
  } else if (normalized >= Math.PI / 4 && normalized < Math.PI * 3 / 4) {
    return { fromSide: 'bottom', toSide: 'top' };
  } else if (normalized >= Math.PI * 3 / 4 && normalized < Math.PI * 5 / 4) {
    return { fromSide: 'left', toSide: 'right' };
  } else {
    return { fromSide: 'top', toSide: 'bottom' };
  }
}
```

- [ ] **Step 3: 实现 calculateMindmapLayout 函数**

```typescript
/**
 * 计算思维导图的布局
 * 返回所有节点的布局信息
 */
function calculateMindmapLayout(topic: string, branches: MindmapBranch[]): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const topicId = generateId();

  // 中心节点
  nodes.push({
    id: topicId,
    text: topic,
    level: 0,
    branchIndex: -1,
    angle: 0,
    distance: 0,
    color: '1' // 中心使用醒目颜色
  });

  // 计算每个分支的角度
  const branchCount = branches.length;
  const branchAngleStep = (2 * Math.PI) / branchCount;

  // 处理每个分支
  branches.forEach((branch, branchIndex) => {
    const branchAngle = branchIndex * branchAngleStep - Math.PI / 2; // 从顶部开始
    const branchId = generateId();
    const branchColor = MINDMAP_COLORS[branchIndex % MINDMAP_COLORS.length];

    // 一级分支节点
    nodes.push({
      id: branchId,
      text: branch.label,
      level: 1,
      branchIndex,
      angle: branchAngle,
      distance: MINDMAP_BRANCH_RADIUS,
      color: branchColor,
      parentId: topicId
    });

    // 递归处理子节点
    if (branch.children && branch.children.length > 0) {
      processChildren(
        nodes,
        branch.children,
        branchId,
        branchAngle,
        MINDMAP_BRANCH_RADIUS + MINDMAP_CHILD_SPACING,
        2,
        branchIndex,
        branchColor
      );
    }
  });

  return nodes;
}

/**
 * 递归处理子节点
 */
function processChildren(
  nodes: LayoutNode[],
  children: MindmapChildNode[],
  parentId: string,
  parentAngle: number,
  startDistance: number,
  level: number,
  branchIndex: number,
  color: string
): void {
  const childCount = children.length;
  // 子节点在父节点方向上分布，角度有小幅偏移
  const angleSpread = Math.PI / 6; // 子节点角度展开范围
  const angleStep = childCount > 1 ? angleSpread / (childCount - 1) : 0;
  const startAngle = parentAngle - angleSpread / 2;

  children.forEach((child, index) => {
    const childAngle = childCount > 1 ? startAngle + index * angleStep : parentAngle;
    const childId = generateId();

    // 解析子节点
    const childText = typeof child === 'string' ? child : child.label;
    const grandChildren = typeof child === 'string' ? undefined : child.children;

    // 添加子节点
    nodes.push({
      id: childId,
      text: childText,
      level,
      branchIndex,
      angle: childAngle,
      distance: startDistance,
      color,
      parentId
    });

    // 递归处理孙节点
    if (grandChildren && grandChildren.length > 0) {
      processChildren(
        nodes,
        grandChildren,
        childId,
        childAngle,
        startDistance + MINDMAP_CHILD_SPACING,
        level + 1,
        branchIndex,
        color
      );
    }
  });
}
```

- [ ] **Step 4: 实现 buildMindmapCanvas 函数**

```typescript
/**
 * 根据布局节点构建 Canvas 节点和边
 */
function buildMindmapCanvas(
  layoutNodes: LayoutNode[]
): { nodes: CanvasNode[]; edges: CanvasEdge[]; groups: CanvasNode[] } {
  const canvasNodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const groups: CanvasNode[] = [];
  const branchGroups: Map<number, { minX: number; minY: number; maxX: number; maxY: number }> = new Map();

  // 创建节点
  layoutNodes.forEach((node) => {
    // 根据层级确定尺寸
    let width: number, height: number;
    if (node.level === 0) {
      width = MINDMAP_TOPIC_SIZE.width;
      height = MINDMAP_TOPIC_SIZE.height;
    } else if (node.level === 1) {
      width = MINDMAP_BRANCH_SIZE.width;
      height = MINDMAP_BRANCH_SIZE.height;
    } else {
      width = MINDMAP_CHILD_SIZE.width;
      height = MINDMAP_CHILD_SIZE.height;
    }

    // 计算位置（节点中心在 distance 处）
    const x = Math.round(node.distance * Math.cos(node.angle) - width / 2);
    const y = Math.round(node.distance * Math.sin(node.angle) - height / 2);

    canvasNodes.push({
      id: node.id,
      type: 'text',
      text: node.text,
      x,
      y,
      width,
      height,
      color: node.color
    });

    // 记录分支边界（用于 group）
    if (node.level >= 1 && node.branchIndex >= 0) {
      const bounds = branchGroups.get(node.branchIndex) || {
        minX: x,
        minY: y,
        maxX: x + width,
        maxY: y + height
      };
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x + width);
      bounds.maxY = Math.max(bounds.maxY, y + height);
      branchGroups.set(node.branchIndex, bounds);
    }

    // 创建边（连接到父节点）
    if (node.parentId) {
      const sideInfo = getSideFromAngle(node.angle);
      edges.push({
        id: generateId(),
        fromNode: node.parentId,
        toNode: node.id,
        fromSide: sideInfo.fromSide,
        toSide: sideInfo.toSide,
        color: node.color
      });
    }
  });

  // 创建分组
  branchGroups.forEach((bounds, branchIndex) => {
    const padding = 20;
    groups.push({
      id: `group-${branchIndex}`,
      type: 'group',
      x: bounds.minX - padding,
      y: bounds.minY - padding,
      width: bounds.maxX - bounds.minX + padding * 2,
      height: bounds.maxY - bounds.minY + padding * 2,
      color: MINDMAP_COLORS[branchIndex % MINDMAP_COLORS.length],
      label: layoutNodes.find(n => n.level === 1 && n.branchIndex === branchIndex)?.text || ''
    });
  });

  return { nodes: canvasNodes, edges, groups };
}
```

---

## Chunk 2: Mindmap Action 实现和测试

### Task 3: 实现 mindmap action 处理逻辑

**Files:**
- Modify: `frontend/src/agent/tools/canvas.ts` (在 execute 函数的 switch 中添加)

- [ ] **Step 1: 在 execute 函数中添加 mindmap case**

在 `case 'list':` 之后、`default:` 之前添加：

```typescript
        case 'mindmap': {
          if (!path) {
            return 'Error: path is required for mindmap action';
          }
          const topic = args.topic as string;
          const branches = (args.branches as MindmapBranch[]) || [];

          if (!topic) {
            return 'Error: topic is required for mindmap action';
          }

          try {
            // 计算布局
            const layoutNodes = calculateMindmapLayout(topic, branches);

            // 构建 canvas 节点和边
            const { nodes: canvasNodes, edges: canvasEdges, groups } = buildMindmapCanvas(layoutNodes);

            // 组合所有节点（group 在底层，普通节点在上层）
            const allNodes = [...groups, ...canvasNodes];

            const canvasData: CanvasData = {
              nodes: allNodes,
              edges: canvasEdges
            };

            const file = await app.vault.create(path, JSON.stringify(canvasData, null, 2));
            log('[Canvas] Mindmap 创建成功:', file.path);

            // 统计信息
            const branchCount = branches.length;
            const totalNodes = canvasNodes.length;
            const totalEdges = canvasEdges.length;

            return `Created mindmap: ${file.path}
- Topic: ${topic}
- Branches: ${branchCount}
- Total nodes: ${totalNodes}
- Total edges: ${totalEdges}`;
          } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            log('[Canvas] Mindmap 创建失败:', errorMsg);
            return `Error: ${errorMsg}`;
          }
        }
```

---

### Task 4: 添加 Mindmap 测试用例

**Files:**
- Modify: `frontend/src/agent/tools/__tests__/canvas.test.ts` (在文件末尾添加)

- [ ] **Step 1: 添加 mindmap action 测试套件**

在文件末尾（最后一个 `});` 之前）添加：

```typescript
  describe('mindmap action', () => {
    it('should create mindmap with topic and branches', async () => {
      const mockFile = { path: 'Canvas/test-mindmap.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      const result = await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test-mindmap.canvas',
        topic: 'Test Topic',
        branches: [
          { label: 'Branch 1', children: ['Child 1', 'Child 2'] },
          { label: 'Branch 2', children: [] }
        ]
      }, context);

      expect(mockApp.vault.create).toHaveBeenCalledWith(
        'Canvas/test-mindmap.canvas',
        expect.stringContaining('"nodes"')
      );
      expect(result).toContain('Created mindmap');
      expect(result).toContain('Test Topic');
      expect(result).toContain('Branches: 2');
    });

    it('should return error when path is missing', async () => {
      const result = await canvasTool.execute({
        action: 'mindmap',
        topic: 'Test Topic',
        branches: []
      }, context);

      expect(result).toContain('Error');
      expect(result).toContain('path is required');
    });

    it('should return error when topic is missing', async () => {
      const result = await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        branches: []
      }, context);

      expect(result).toContain('Error');
      expect(result).toContain('topic is required');
    });

    it('should create center node with color 1', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [{ label: 'B1' }]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const centerNode = canvasData.nodes.find((n: any) => n.text === 'Center');

      expect(centerNode).toBeDefined();
      expect(centerNode.color).toBe('1');
    });

    it('should assign different colors to branches', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Branch 1' },
          { label: 'Branch 2' },
          { label: 'Branch 3' }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const branchNodes = canvasData.nodes.filter((n: any) =>
        n.type === 'text' && n.text.startsWith('Branch')
      );

      const colors = branchNodes.map((n: any) => n.color);
      expect(new Set(colors).size).toBeGreaterThan(1); // 至少有两种不同颜色
    });

    it('should create edges connecting nodes', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Branch 1', children: ['Child 1'] }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);

      // 1 中心 + 1 分支 + 1 子节点 = 3 个节点
      // 2 条边（中心-分支，分支-子节点）
      expect(canvasData.edges.length).toBe(2);
    });

    it('should create group nodes for branches', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Branch 1', children: ['Child 1'] },
          { label: 'Branch 2', children: [] }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const groupNodes = canvasData.nodes.filter((n: any) => n.type === 'group');

      expect(groupNodes.length).toBe(2); // 每个分支一个 group
    });

    it('should handle nested children', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          {
            label: 'Branch 1',
            children: [
              'Child 1',
              { label: 'Child 2', children: ['Grandchild'] }
            ]
          }
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const textNodes = canvasData.nodes.filter((n: any) => n.type === 'text');

      // 1 中心 + 1 分支 + 2 子节点 + 1 孙节点 = 5
      expect(textNodes.length).toBe(5);
    });

    it('should set correct fromSide and toSide based on angle', async () => {
      const mockFile = { path: 'Canvas/test.canvas' };
      mockApp.vault.create.mockResolvedValue(mockFile);

      await canvasTool.execute({
        action: 'mindmap',
        path: 'Canvas/test.canvas',
        topic: 'Center',
        branches: [
          { label: 'Right' },  // 角度 ~0，应该在右侧
          { label: 'Bottom' }, // 角度 ~π/2，应该在下方
          { label: 'Left' },   // 角度 ~π，应该在左侧
          { label: 'Top' }     // 角度 ~3π/2，应该在上方
        ]
      }, context);

      const createCall = mockApp.vault.create.mock.calls[0];
      const canvasData = JSON.parse(createCall[1]);
      const edges = canvasData.edges;

      // 检查边的方向是否合理
      const fromSides = new Set(edges.map((e: any) => e.fromSide));
      const toSides = new Set(edges.map((e: any) => e.toSide));

      expect(fromSides.size).toBeGreaterThan(1); // 应该有多个不同方向
    });
  });
```

- [ ] **Step 2: 更新 action enum 测试**

修改 `definition` 测试套件中的 action enum 测试：

```typescript
    it('should support create, add_node, add_edge, get, list, mindmap actions', () => {
      const actionEnum = canvasTool.definition.function.parameters.properties.action.enum;
      expect(actionEnum).toEqual(['create', 'add_node', 'add_edge', 'get', 'list', 'mindmap']);
    });
```

---

### Task 5: 运行测试验证

- [ ] **Step 1: 运行测试**

```bash
cd /Users/lizhao/workspace/DeepReader/frontend && npm run test:run -- src/agent/tools/__tests__/canvas.test.ts
```

Expected: 所有测试通过

- [ ] **Step 2: 运行类型检查**

```bash
cd /Users/lizhao/workspace/DeepReader/frontend && npm run build
```

Expected: 构建成功，无类型错误

---

### Task 6: 提交代码

- [ ] **Step 1: 暂存文件**

```bash
git add frontend/src/agent/tools/canvas.ts frontend/src/agent/tools/__tests__/canvas.test.ts
```

- [ ] **Step 2: 提交**

```bash
git commit -m "$(cat <<'EOF'
feat(canvas): add mindmap action with radial layout

- Add mindmap action to canvas tool for structured mind map creation
- Implement radial layout algorithm for automatic node positioning
- Support unlimited nesting depth with color-coded branches
- Create group nodes for visual branch separation
- Add comprehensive test coverage for mindmap functionality

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Skill 文档创建

### Task 7: 创建 Mindmap Skill 文档

**Files:**
- Create: `skills/mindmap.md`（用户 vault 中的 skills 目录）

- [ ] **Step 1: 创建 skill 文档**

```markdown
---
name: mindmap
description: 创建放射状思维导图，支持任意粒度的知识结构化呈现
keywords:
  - 思维导图
  - 知识梳理
  - 结构化
  - canvas
  - 知识图谱
---

# Mindmap 思维导图 Skill

## 用途

将知识点整理为放射状思维导图，在 Obsidian Canvas 中可视化呈现。

**适用场景**：
- 📚 书籍整体知识结构
- 📖 单个章节/概念的展开
- 💡 任意知识点的结构化梳理
- 🎯 大到全书框架，小到一个概念

## 使用方式

调用 `canvas` 工具，使用 `mindmap` action：

```json
{
  "action": "mindmap",
  "path": "Canvas/主题名称.canvas",
  "topic": "中心主题",
  "branches": [
    {
      "label": "分支1",
      "children": ["子项1", "子项2"]
    },
    {
      "label": "分支2",
      "children": [
        "子项A",
        { "label": "子项B", "children": ["更深层级"] }
      ]
    }
  ]
}
```

## 输入格式说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 固定为 `"mindmap"` |
| `path` | string | 是 | Canvas 文件路径，如 `"Canvas/主题.canvas"` |
| `topic` | string | 是 | 中心主题（书名、概念名、问题等） |
| `branches` | array | 是 | 分支数组 |
| `branches[].label` | string | 是 | 分支名称 |
| `branches[].children` | array | 否 | 子节点（支持无限嵌套） |

## 特性

- **放射状布局**：从中心向外辐射，层级清晰
- **自动着色**：不同分支使用不同颜色区分
- **分支分组**：每个分支用 group 节点包裹
- **无限层级**：支持任意深度嵌套

## 使用示例

### 示例 1：整理书籍概念

用户请求：「帮我整理一下这本书关于"反向传播"的知识」

```json
{
  "action": "mindmap",
  "path": "Canvas/反向传播算法.canvas",
  "topic": "反向传播算法",
  "branches": [
    {
      "label": "核心概念",
      "children": ["链式法则", "梯度计算", "误差传播"]
    },
    {
      "label": "实现步骤",
      "children": ["前向传播", "计算损失", "反向传播", "参数更新"]
    },
    {
      "label": "应用场景",
      "children": ["神经网络训练", "深度学习框架"]
    }
  ]
}
```

### 示例 2：全书知识结构

用户请求：「帮我梳理这本书的整体框架」

```json
{
  "action": "mindmap",
  "path": "Canvas/深度学习-全书框架.canvas",
  "topic": "深度学习",
  "branches": [
    {
      "label": "基础理论",
      "children": ["线性代数", "概率论", "优化算法"]
    },
    {
      "label": "神经网络",
      "children": ["感知机", "多层网络", "激活函数"]
    },
    {
      "label": "卷积网络",
      "children": ["卷积层", "池化层", "经典架构"]
    },
    {
      "label": "循环网络",
      "children": ["RNN", "LSTM", "GRU"]
    }
  ]
}
```

## 执行流程

1. **理解用户意图**：识别用户想要整理的知识范围
2. **提取知识结构**：从文档/上下文中提取相关知识
3. **组织分支结构**：将知识组织为逻辑清晰的分支
4. **调用 canvas 工具**：使用 mindmap action 创建导图
5. **告知用户结果**：返回创建的 canvas 文件路径
```

- [ ] **Step 2: 验证 skill 文件格式**

确保文件可以被 SkillLoader 正确解析：
- frontmatter 格式正确（`---` 包裹）
- `name` 和 `description` 字段存在
- body 内容完整

---

## 验收标准

- [ ] `npm run test:run` 所有测试通过
- [ ] `npm run build` 构建成功
- [ ] 可以通过 canvas 工具创建放射状思维导图
- [ ] 不同分支使用不同颜色
- [ ] 每个分支有 group 包裹
- [ ] 连接线方向正确
- [ ] Skill 文档可以被 SkillLoader 加载
- [ ] AI 可以根据 skill 文档正确调用 mindmap 功能
