# Mindmap Skill 设计文档

## 概述

在现有 `canvas.ts` 工具中添加 `mindmap` action，接收 JSON 结构化数据，自动计算放射状布局并在 Obsidian Canvas 中绘制思维导图。

## 适用场景

| 场景 | 示例 |
|------|------|
| 书籍整体知识结构 | 《深度学习》全书框架 |
| 单个章节/概念梳理 | "反向传播算法" 的展开 |
| 任意知识点结构化 | "MVC 架构模式" 的组成 |
| 问题分析 | "如何优化性能" 的思路 |

**核心特点**：粒度灵活，大到全书框架，小到一个概念的展开。

## 输入格式

```typescript
interface MindmapInput {
  action: 'mindmap';
  path: string;           // Canvas 文件路径，如 "Canvas/主题名称.canvas"
  topic: string;          // 中心主题（书名、概念名、问题等）
  branches: Branch[];     // 分支数组
}

interface Branch {
  label: string;          // 分支名称
  children?: ChildNode[]; // 子节点（可选）
}

type ChildNode = string | Branch;  // 支持字符串或嵌套对象
```

### 示例输入

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
      "children": [
        "前向传播",
        "计算损失",
        { "label": "反向传播", "children": ["计算梯度", "更新权重"] }
      ]
    },
    {
      "label": "应用场景",
      "children": ["神经网络训练", "深度学习框架"]
    }
  ]
}
```

## 布局算法

### 放射状布局

```
                    分支3
                      │
                      │
         分支2 ───── 中心 ───── 分支1
                      │
                      │
                    分支4
```

### 计算逻辑

1. **中心节点**
   - 位置：画布中心 (0, 0)
   - 尺寸：较大 (width: 300, height: 80)

2. **一级分支**
   - 角度分配：`360° / 分支数量`，均匀分布
   - 距离中心：固定半径 R1（如 350px）
   - 位置计算：`(x, y) = (R1 * cos(angle), R1 * sin(angle))`

3. **子节点**
   - 沿父节点方向继续向外辐射
   - 每层距离递增（如每层 +200px）
   - 同级子节点在父节点方向上均匀分布

4. **间距调整**
   - 根据文本长度动态调整节点宽度
   - 节点间保持最小间距（如 30px）

### 连接线方向

| 节点位置 | fromSide | toSide |
|----------|----------|--------|
| 右侧 | right | left |
| 左侧 | left | right |
| 上方 | top | bottom |
| 下方 | bottom | top |

## 样式规则

### 颜色方案

| 元素 | 颜色 |
|------|------|
| 中心主题 | `'1'`（红色/橙色，醒目） |
| 分支1 | `'2'`（橙色） |
| 分支2 | `'3'`（黄色） |
| 分支3 | `'4'`（绿色） |
| 分支4 | `'5'`（蓝色） |
| 分支5 | `'6'`（紫色） |
| 更多分支 | 循环使用上述颜色 |

### 节点尺寸

| 层级 | width | height |
|------|-------|--------|
| 中心主题 | 300 | 80 |
| 一级分支 | 250 | 60 |
| 二级及以下 | 200 | 50 |

### 分组（Group）

每个一级分支及其所有子节点用 group 节点包裹：
- 提供视觉上的分组
- 背景色与分支颜色一致（降低透明度）

## 文件修改

### 1. `frontend/src/agent/tools/canvas.ts`

- 添加 `mindmap` action 到 enum
- 新增 `MindmapInput`、`Branch` 类型定义
- 实现 `calculateMindmapLayout()` 布局函数
- 实现 `buildMindmapNodesAndEdges()` 构建函数
- 在 `execute()` 中添加 `case 'mindmap'` 处理

### 2. `frontend/src/agent/tools/__tests__/canvas.test.ts`

- 添加 `describe('mindmap action')` 测试套件
- 测试用例：
  - 基本思维导图创建
  - 多层级嵌套
  - 颜色分配
  - 连接线方向
  - 分组生成

## 输出示例

执行成功后返回：

```
Created mindmap: Canvas/反向传播算法.canvas
- Topic: 反向传播算法
- Branches: 3
- Total nodes: 12
- Total edges: 11
```

## 与现有 canvas 工具的关系

| action | 用途 | 布局 |
|--------|------|------|
| `create` | 通用画布创建 | 手动指定坐标 |
| `add_node` | 添加单个节点 | 自动/手动位置 |
| `add_edge` | 添加连接 | - |
| `mindmap` | **思维导图专用** | **自动放射状布局** |

`mindmap` 是高级 action，内部调用 canvas 的基本能力，但提供：
- 自动布局计算
- 结构化输入
- 一致的样式规则
