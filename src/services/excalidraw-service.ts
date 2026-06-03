/**
 * ExcalidrawService - Excalidraw 集成服务
 *
 * 提供 Canvas → Excalidraw 转换功能
 * 作为现有 Canvas Tool 的增强层
 *
 * 依赖: 用户需要安装 Obsidian Excalidraw 插件
 */

import { App, Notice } from 'obsidian';
import type {
  ExcalidrawAutomate,
  ExcalidrawServiceConfig,
  CanvasToExcalidrawResult,
  ConnectionPoint,
  BoxType,
} from '../types/excalidraw.d.ts';
import { log } from '../utils/logger.js';

/**
 * Canvas 数据类型（与 canvas.ts 保持一致）
 */
interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
  color?: string;
  label?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: 'top' | 'right' | 'bottom' | 'left';
  toSide?: 'top' | 'right' | 'bottom' | 'left';
  label?: string;
  color?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * 颜色映射：Canvas color → Excalidraw 颜色
 */
const COLOR_MAP: Record<string, string> = {
  '1': '#fbbf24', // 黄色
  '2': '#ef4444', // 红色
  '3': '#22c55e', // 绿色
  '4': '#3b82f6', // 蓝色
  '5': '#a855f7', // 紫色
  '6': '#f97316', // 橙色
};

/**
 * Excalidraw 服务选项
 */
export interface ExcalidrawServiceOptions {
  app: App;
  /** 最低版本要求 */
  minVersion?: string;
  /** 默认输出文件夹 */
  defaultFolder?: string;
}

/**
 * Excalidraw 集成服务
 */
export class ExcalidrawService {
  private app: App;
  private minVersion: string;
  private defaultFolder: string;

  constructor(options: ExcalidrawServiceOptions) {
    this.app = options.app;
    this.minVersion = options.minVersion || '2.0.0';
    this.defaultFolder = options.defaultFolder || 'DeepReader/Excalidraw';
  }

  /**
   * 检查 Excalidraw 插件是否可用
   * @returns ExcalidrawAutomate API 或 null
   */
  getAPI(): ExcalidrawAutomate | null {
    const ea = window.ExcalidrawAutomate;
    if (!ea) {
      return null;
    }
    return ea;
  }

  /**
   * 检查 Excalidraw 是否可用并显示提示
   * @returns 是否可用
   */
  checkAvailability(): boolean {
    const ea = this.getAPI();
    if (!ea) {
      new Notice('请先安装 Excalidraw 插件（社区插件市场）');
      return false;
    }

    // 版本检查（可选）
    if (ea.version && !this.isVersionSupported(ea.version)) {
      new Notice(`Excalidraw 版本过低，建议升级到 ${this.minVersion} 或更高版本`);
      log('[ExcalidrawService] 版本警告:', ea.version, '< 最低要求:', this.minVersion);
    }

    return true;
  }

  /**
   * 检查版本是否满足要求
   */
  private isVersionSupported(version: string): boolean {
    const minParts = this.minVersion.split('.').map(Number);
    const currentParts = version.split('.').map(Number);

    for (let i = 0; i < Math.max(minParts.length, currentParts.length); i++) {
      const min = minParts[i] || 0;
      const current = currentParts[i] || 0;
      if (current > min) return true;
      if (current < min) return false;
    }
    return true;
  }

  /**
   * 将 Canvas 数据转换为 Excalidraw 文件
   *
   * @param canvasData Canvas 数据
   * @param filename 输出文件名（不含扩展名）
   * @param folder 输出文件夹
   * @returns 转换结果
   */
  async convertCanvasToExcalidraw(
    canvasData: CanvasData,
    filename: string,
    folder?: string
  ): Promise<CanvasToExcalidrawResult> {
    // 检查可用性
    if (!this.checkAvailability()) {
      return {
        success: false,
        error: 'Excalidraw 插件未安装',
      };
    }

    const ea = this.getAPI()!;
    const outputFolder = folder || this.defaultFolder;

    try {
      // 1. 创建新的 Excalidraw 文件
      await ea.create({
        filename: filename,
        foldername: outputFolder,
        silent: false,
      });

      // 2. 清空画布（如果有默认内容）
      ea.clear();

      // 3. ID 映射：Canvas ID → Excalidraw ID
      const idMap = new Map<string, string>();

      // 4. 转换节点
      let nodeCount = 0;
      for (const node of canvasData.nodes) {
        const excalId = this.convertNode(ea, node);
        if (excalId) {
          idMap.set(node.id, excalId);
          nodeCount++;
        }
      }

      // 5. 转换边
      let edgeCount = 0;
      for (const edge of canvasData.edges) {
        const fromId = idMap.get(edge.fromNode);
        const toId = idMap.get(edge.toNode);

        if (fromId && toId) {
          this.convertEdge(ea, edge, fromId, toId);
          edgeCount++;
        }
      }

      // Excalidraw Automate 会自动保存

      const filePath = `${outputFolder}/${filename}.excalidraw.md`;
      log('[ExcalidrawService] 转换成功:', filePath, '节点:', nodeCount, '边:', edgeCount);

      new Notice(`已创建 Excalidraw 文件: ${filename}`);

      return {
        success: true,
        filePath,
        nodeCount,
        edgeCount,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('[ExcalidrawService] 转换失败:', errorMsg);
      new Notice(`转换失败: ${errorMsg}`);

      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 转换单个 Canvas 节点为 Excalidraw 元素
   */
  private convertNode(ea: ExcalidrawAutomate, node: CanvasNode): string | null {
    // 跳过 group 类型（Excalidraw 有自己的分组机制）
    if (node.type === 'group') {
      // TODO: 可以考虑使用 addToGroup 实现
      return null;
    }

    // 文本节点
    if (node.type === 'text') {
      const boxType = this.getBoxType(node);
      const color = this.getColor(node.color);

      return ea.addText(node.x, node.y, node.text || '', {
        width: node.width,
        height: node.height,
        textAlign: 'center',
        verticalAlign: 'middle',
        box: boxType,
        boxPadding: 10,
      });
    }

    // 文件节点 - 显示为带链接的文本
    if (node.type === 'file') {
      const displayText = node.file || 'File';
      return ea.addText(node.x, node.y, displayText, {
        width: node.width,
        height: node.height,
        textAlign: 'center',
        box: 'box',
      });
    }

    // 链接节点 - 显示为带 URL 的文本
    if (node.type === 'link') {
      const displayText = node.label || node.url || 'Link';
      return ea.addText(node.x, node.y, displayText, {
        width: node.width,
        height: node.height,
        textAlign: 'center',
        box: 'box',
      });
    }

    return null;
  }

  /**
   * 转换 Canvas 边为 Excalidraw 连接线
   */
  private convertEdge(
    ea: ExcalidrawAutomate,
    edge: CanvasEdge,
    fromId: string,
    toId: string
  ): void {
    const fromSide = this.mapConnectionPoint(edge.fromSide || 'right');
    const toSide = this.mapConnectionPoint(edge.toSide || 'left');

    ea.connectObjects(fromId, fromSide, toId, toSide, {
      numberOfPoints: 0,
      startArrowHead: 'none',
      endArrowHead: 'arrow',
    });
  }

  /**
   * 根据节点特征确定 Excalidraw 形状
   */
  private getBoxType(node: CanvasNode): BoxType {
    // 可以根据颜色或其他特征确定形状
    // 默认使用矩形
    if (node.color === '1') {
      return 'ellipse'; // 中心主题用椭圆
    }
    return 'box';
  }

  /**
   * 映射连接点方向
   */
  private mapConnectionPoint(side: string): ConnectionPoint {
    const map: Record<string, ConnectionPoint> = {
      top: 'top',
      bottom: 'bottom',
      left: 'left',
      right: 'right',
    };
    return map[side] || 'right';
  }

  /**
   * 获取 Excalidraw 颜色
   */
  private getColor(color?: string): string {
    if (!color) return '#3b82f6'; // 默认蓝色
    return COLOR_MAP[color] || '#3b82f6';
  }

  /**
   * 从 Canvas 文件读取并转换
   *
   * @param canvasPath Canvas 文件路径
   * @param outputPath 输出文件名（可选，默认与 Canvas 同名）
   * @returns 转换结果
   */
  async convertFromCanvasFile(
    canvasPath: string,
    outputPath?: string
  ): Promise<CanvasToExcalidrawResult> {
    // 读取 Canvas 文件
    const file = this.app.vault.getAbstractFileByPath(canvasPath);
    if (!file || !('extension' in file) || file.extension !== 'canvas') {
      return {
        success: false,
        error: `Canvas 文件不存在: ${canvasPath}`,
      };
    }

    try {
      const content = await this.app.vault.read(file as any);
      const canvasData: CanvasData = JSON.parse(content);

      // 生成输出文件名（从 path 中提取 basename）
      const defaultName = canvasPath.split('/').pop()?.replace('.canvas', '') || 'converted';
      const filename = outputPath || defaultName;

      return await this.convertCanvasToExcalidraw(canvasData, filename);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `读取 Canvas 失败: ${errorMsg}`,
      };
    }
  }

  /**
   * 快速创建思维导图（直接生成 Excalidraw）
   *
   * @param topic 中心主题
   * @param branches 分支列表
   * @param filename 文件名
   * @returns 转换结果
   */
  async createMindmap(
    topic: string,
    branches: Array<{ label: string; children?: string[] }>,
    filename: string
  ): Promise<CanvasToExcalidrawResult> {
    if (!this.checkAvailability()) {
      return {
        success: false,
        error: 'Excalidraw 插件未安装',
      };
    }

    const ea = this.getAPI()!;

    try {
      // 创建新画布
      await ea.create({
        filename,
        foldername: this.defaultFolder,
      });
      ea.clear();

      // 中心节点
      const centerX = 400;
      const centerY = 300;
      const centerId = ea.addText(centerX, centerY, topic, {
        width: 200,
        height: 60,
        textAlign: 'center',
        box: 'ellipse',
      });

      // 计算分支位置（放射状布局）
      const radius = 350;
      const branchCount = branches.length;
      let nodeCount = 1;
      let edgeCount = 0;

      branches.forEach((branch, index) => {
        const angle = (2 * Math.PI * index) / branchCount - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle) - 75;
        const y = centerY + radius * Math.sin(angle) - 20;

        // 创建分支节点
        const branchId = ea.addText(x, y, branch.label, {
          width: 150,
          height: 40,
          textAlign: 'center',
          box: 'box',
        });
        nodeCount++;

        // 连接到中心
        const fromSide = this.getSideFromAngle(angle);
        const toSide = this.getOppositeSide(fromSide);
        ea.connectObjects(centerId, fromSide, branchId, toSide, {
          endArrowHead: 'arrow',
        });
        edgeCount++;

        // 子节点
        if (branch.children && branch.children.length > 0) {
          const childRadius = 200;
          branch.children.forEach((child, childIndex) => {
            const childAngle = angle + ((childIndex - (branch.children!.length - 1) / 2) * 0.3);
            const childX = x + childRadius * Math.cos(childAngle);
            const childY = y + childRadius * Math.sin(childAngle);

            const childId = ea.addText(childX, childY, child, {
              width: 120,
              height: 30,
              textAlign: 'center',
              box: 'box',
            });
            nodeCount++;

            ea.connectObjects(branchId, 'right', childId, 'left', {
              endArrowHead: 'arrow',
            });
            edgeCount++;
          });
        }
      });

      // Excalidraw Automate 会自动保存

      const filePath = `${this.defaultFolder}/${filename}.excalidraw.md`;
      new Notice(`已创建思维导图: ${filename}`);

      return {
        success: true,
        filePath,
        nodeCount,
        edgeCount,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 根据角度获取连接边
   */
  private getSideFromAngle(angle: number): ConnectionPoint {
    const normalized = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (normalized >= Math.PI * 7 / 4 || normalized < Math.PI / 4) return 'right';
    if (normalized >= Math.PI / 4 && normalized < Math.PI * 3 / 4) return 'bottom';
    if (normalized >= Math.PI * 3 / 4 && normalized < Math.PI * 5 / 4) return 'left';
    return 'top';
  }

  /**
   * 获取对边
   */
  private getOppositeSide(side: ConnectionPoint): ConnectionPoint {
    const map: Record<ConnectionPoint, ConnectionPoint> = {
      top: 'bottom',
      bottom: 'top',
      left: 'right',
      right: 'left',
    };
    return map[side];
  }

  /**
   * 创建知识图谱（网状结构）
   *
   * @param nodes 概念节点列表
   * @param edges 关系边列表
   * @param filename 文件名
   * @returns 转换结果
   */
  async createKnowledgeGraph(
    nodes: Array<{ id: string; label: string; type?: 'concept' | 'entity' | 'topic' }>,
    edges: Array<{ from: string; to: string; label?: string }>,
    filename: string
  ): Promise<CanvasToExcalidrawResult> {
    if (!this.checkAvailability()) {
      return {
        success: false,
        error: 'Excalidraw 插件未安装',
      };
    }

    const ea = this.getAPI()!;

    try {
      await ea.create({
        filename,
        foldername: this.defaultFolder,
      });
      ea.clear();

      // 使用力导向布局的简化版本（网格布局）
      const nodePositions = this.calculateGridLayout(nodes.length);
      const idMap = new Map<string, string>();

      // 创建节点
      nodes.forEach((node, index) => {
        const pos = nodePositions[index];
        const boxType = this.getBoxTypeForNodeType(node.type);

        const excalId = ea.addText(pos.x, pos.y, node.label, {
          width: 150,
          height: 50,
          textAlign: 'center',
          box: boxType,
        });
        idMap.set(node.id, excalId);
      });

      // 创建边
      edges.forEach((edge) => {
        const fromId = idMap.get(edge.from);
        const toId = idMap.get(edge.to);

        if (fromId && toId) {
          ea.connectObjects(fromId, 'right', toId, 'left', {
            numberOfPoints: 0,
            endArrowHead: 'arrow',
          });
        }
      });

      // Excalidraw Automate 会自动保存

      const filePath = `${this.defaultFolder}/${filename}.excalidraw.md`;
      new Notice(`已创建知识图谱: ${filename}`);

      return {
        success: true,
        filePath,
        nodeCount: nodes.length,
        edgeCount: edges.length,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  /**
   * 计算网格布局位置
   */
  private calculateGridLayout(count: number): Array<{ x: number; y: number }> {
    const positions: Array<{ x: number; y: number }> = [];
    const cols = Math.ceil(Math.sqrt(count));
    const spacing = 250;
    const startX = 100;
    const startY = 100;

    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      positions.push({
        x: startX + col * spacing,
        y: startY + row * spacing,
      });
    }

    return positions;
  }

  /**
   * 根据节点类型获取形状
   */
  private getBoxTypeForNodeType(type?: string): BoxType {
    switch (type) {
      case 'topic':
        return 'ellipse';
      case 'entity':
        return 'diamond';
      case 'concept':
      default:
        return 'box';
    }
  }

  /**
   * 从概念关系数据创建可视化
   *
   * @param data 概念关系数据（可从 AI 对话中提取）
   * @param filename 文件名
   * @returns 转换结果
   */
  async createFromConceptData(
    data: {
      topic: string;
      concepts: Array<{ name: string; description?: string }>;
      relations: Array<{ from: string; to: string; type?: string }>;
    },
    filename: string
  ): Promise<CanvasToExcalidrawResult> {
    if (!this.checkAvailability()) {
      return {
        success: false,
        error: 'Excalidraw 插件未安装',
      };
    }

    const ea = this.getAPI()!;

    try {
      await ea.create({
        filename,
        foldername: this.defaultFolder,
      });
      ea.clear();

      // 中心主题
      const centerX = 500;
      const centerY = 400;
      const centerId = ea.addText(centerX, centerY, data.topic, {
        width: 250,
        height: 70,
        textAlign: 'center',
        box: 'ellipse',
      });

      // 概念节点（放射状布局）
      const conceptCount = data.concepts.length;
      const radius = 400;
      const idMap = new Map<string, string>();

      data.concepts.forEach((concept, index) => {
        const angle = (2 * Math.PI * index) / conceptCount - Math.PI / 2;
        const x = centerX + radius * Math.cos(angle) - 75;
        const y = centerY + radius * Math.sin(angle) - 20;

        const nodeId = ea.addText(x, y, concept.name, {
          width: 150,
          height: 40,
          textAlign: 'center',
          box: 'box',
        });
        idMap.set(concept.name, nodeId);

        // 连接到中心
        const fromSide = this.getSideFromAngle(angle);
        const toSide = this.getOppositeSide(fromSide);
        ea.connectObjects(centerId, fromSide, nodeId, toSide, {
          endArrowHead: 'arrow',
        });
      });

      // 添加关系边（概念之间的连接）
      data.relations.forEach((relation) => {
        const fromId = idMap.get(relation.from);
        const toId = idMap.get(relation.to);

        if (fromId && toId) {
          ea.connectObjects(fromId, 'right', toId, 'left', {
            numberOfPoints: 1,
            endArrowHead: 'arrow',
          });
        }
      });

      // Excalidraw Automate 会自动保存

      const filePath = `${this.defaultFolder}/${filename}.excalidraw.md`;
      new Notice(`已创建概念图谱: ${filename}`);

      return {
        success: true,
        filePath,
        nodeCount: data.concepts.length + 1,
        edgeCount: data.concepts.length + data.relations.length,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
