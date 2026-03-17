/**
 * Excalidraw Automate API 类型定义
 *
 * 文档: https://zsviczian.github.io/obsidian-excalidraw-plugin/API/objects.html
 * 完整 API: https://raw.githubusercontent.com/zsviczian/obsidian-excalidraw-plugin/refs/heads/master/docs/AITrainingData/ExcalidrawAutomate%20full%20library%20for%20LLM%20training.md
 *
 * 这是 Obsidian Excalidraw 插件提供的自动化 API
 * 允许其他插件程序化创建和操作 Excalidraw 图形
 */

/**
 * 连接点位置
 */
export type ConnectionPoint = "top" | "bottom" | "left" | "right";

/**
 * 箭头类型
 */
export type ArrowHead = "none" | "arrow" | "dot" | "bar";

/**
 * 文本框类型
 */
export type BoxType = "box" | "blob" | "ellipse" | "diamond";

/**
 * 文本格式化选项
 */
export interface TextFormatting {
  /** 文本换行位置 */
  wrapAt?: number;
  /** 固定宽度 */
  width?: number;
  /** 固定高度 */
  height?: number;
  /** 水平对齐 */
  textAlign?: "left" | "center" | "right";
  /** 垂直对齐 */
  verticalAlign?: "top" | "middle" | "bottom";
  /** 包裹文本的形状 */
  box?: BoxType;
  /** 包裹形状的内边距 */
  boxPadding?: number;
}

/**
 * 连接选项
 */
export interface ConnectOptions {
  /** 中间断点数量 */
  numberOfPoints?: number;
  /** 起始箭头 */
  startArrowHead?: ArrowHead;
  /** 结束箭头 */
  endArrowHead?: ArrowHead;
  /** 内边距 */
  padding?: number;
}

/**
 * 创建画布选项
 */
export interface CreateOptions {
  /** 文件名（不含扩展名） */
  filename?: string;
  /** 文件夹路径 */
  foldername?: string;
  /** 模板文件路径 */
  template?: string;
  /** 是否在新面板打开 */
  onNewPane?: boolean;
  /** 静默模式（不打开编辑器） */
  silent?: boolean;
}

/**
 * 箭头格式化选项
 */
export interface ArrowFormatting {
  /** 起始箭头 */
  startArrowHead?: ArrowHead;
  /** 结束箭头 */
  endArrowHead?: ArrowHead;
  /** 起始对象 ID（自动连接） */
  startObjectId?: string;
  /** 结束对象 ID（自动连接） */
  endObjectId?: string;
}

/**
 * 元素样式
 */
export interface ElementStyle {
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: "solid" | "hachure" | "cross-hatch";
  strokeWidth?: number;
  strokeStyle?: "solid" | "dashed" | "dotted";
  roughness?: number;
  opacity?: number;
  strokeSharpness?: "round" | "sharp";
  fontFamily?: 1 | 2 | 3 | 4;  // 1=Hand, 2=Code, 3=Normal, 4=Casual
  fontSize?: number;
}

/**
 * Excalidraw Automate 的 style 对象
 * 在创建元素前设置，影响后续创建的所有元素
 */
export interface ExcalidrawStyleObject {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: "solid" | "hachure" | "cross-hatch";
  strokeWidth: number;
  strokeStyle: "solid" | "dashed" | "dotted";
  roughness: number;
  opacity: number;
  strokeSharpness: "round" | "sharp";
  fontFamily: 1 | 2 | 3 | 4;
  fontSize: number;
}

/**
 * Excalidraw Automate API 接口
 *
 * 这是 Obsidian Excalidraw 插件暴露的全局 API
 * 通过 window.ExcalidrawAutomate 访问
 */
export interface ExcalidrawAutomate {
  // ============ 版本信息 ============

  /** 插件版本号 */
  version: string;

  // ============ 创建元素 ============

  /**
   * 添加矩形
   * @param topX 左上角 X 坐标
   * @param topY 左上角 Y 坐标
   * @param width 宽度
   * @param height 高度
   * @returns 元素 ID
   */
  addRect(topX: number, topY: number, width: number, height: number): string;

  /**
   * 添加菱形
   * @param topX 左上角 X 坐标
   * @param topY 左上角 Y 坐标
   * @param width 宽度
   * @param height 高度
   * @returns 元素 ID
   */
  addDiamond(topX: number, topY: number, width: number, height: number): string;

  /**
   * 添加椭圆
   * @param topX 左上角 X 坐标
   * @param topY 左上角 Y 坐标
   * @param width 宽度
   * @param height 高度
   * @returns 元素 ID
   */
  addEllipse(topX: number, topY: number, width: number, height: number): string;

  /**
   * 添加文本
   * @param topX 左上角 X 坐标
   * @param topY 左上角 Y 坐标
   * @param text 文本内容
   * @param formatting 格式化选项
   * @param id 可选的元素 ID
   * @returns 元素 ID（如果有 box，返回 box 的 ID）
   */
  addText(
    topX: number,
    topY: number,
    text: string,
    formatting?: TextFormatting,
    id?: string
  ): string;

  /**
   * 添加线条
   * @param points 点坐标数组（至少 2 个点）
   * @returns 元素 ID
   */
  addLine(points: Array<[number, number]>): string;

  /**
   * 添加箭头
   * @param points 点坐标数组（至少 2 个点）
   * @param formatting 格式化选项
   * @returns 元素 ID
   */
  addArrow(
    points: Array<[number, number]>,
    formatting?: ArrowFormatting
  ): string;

  // ============ 连接元素 ============

  /**
   * 连接两个对象
   * @param objectA 第一个对象的 ID
   * @param connectionA 第一个对象的连接点
   * @param objectB 第二个对象的 ID
   * @param connectionB 第二个对象的连接点
   * @param formatting 连接选项
   */
  connectObjects(
    objectA: string,
    connectionA: ConnectionPoint,
    objectB: string,
    connectionB: ConnectionPoint,
    formatting?: ConnectOptions
  ): void;

  // ============ 分组 ============

  /**
   * 将多个元素分组
   * @param objectIds 元素 ID 数组
   * @returns 分组 ID
   */
  addToGroup(objectIds: string[]): string;

  // ============ 画布操作 ============

  /**
   * 创建新的 Excalidraw 文件
   * @param options 创建选项
   */
  create(options?: CreateOptions): Promise<void>;

  /**
   * 清空当前画布
   */
  clear(): void;

  /**
   * 保存当前画布
   */
  save(): Promise<void>;

  /**
   * 关闭当前画布
   */
  close(): void;

  // ============ 视图操作 ============

  /**
   * 设置目标视图
   * @param view Excalidraw 视图对象
   */
  setView(view: unknown): void;

  /**
   * 获取 Excalidraw 原生 API
   * @returns Excalidraw API 对象
   */
  getExcalidrawAPI(): unknown;

  // ============ 样式操作 ============

  /**
   * 复制元素样式
   * @param sourceId 源元素 ID
   * @param targetId 目标元素 ID
   */
  copyElementLook(sourceId: string, targetId: string): void;

  // ============ 元素操作 ============

  /**
   * 删除元素
   * @param elementIds 元素 ID 数组
   */
  deleteElements(elementIds: string[]): void;

  /**
   * 获取所有元素
   * @returns 元素数组
   */
  getElements(): unknown[];

  /**
   * 获取指定元素
   * @param id 元素 ID
   * @returns 元素对象或 undefined
   */
  getElement(id: string): unknown | undefined;

  // ============ 其他常用方法 ============

  /**
   * 添加自定义数据到元素
   * @param elementId 元素 ID
   * @param key 数据键
   * @param value 数据值
   */
  addAppendUpdateCustomData?(elementId: string, key: string, value: unknown): void;

  /**
   * 刷新视图
   */
  refresh?: () => void;

  /**
   * 选择元素
   * @param elementIds 元素 ID 数组
   */
  selectElements?(elementIds: string[]): void;

  /**
   * 获取选中的元素
   * @returns 选中的元素 ID 数组
   */
  getSelectedElements?(): string[];
}

/**
 * 扩展 Window 接口以包含 Excalidraw Automate
 */
declare global {
  interface Window {
    /** Excalidraw Automate API（如果用户安装了 Excalidraw 插件） */
    ExcalidrawAutomate?: ExcalidrawAutomate;
  }
}

/**
 * Excalidraw 服务配置
 */
export interface ExcalidrawServiceConfig {
  /** 最低要求的 Excalidraw 插件版本 */
  minVersion?: string;
  /** 默认输出文件夹 */
  defaultFolder?: string;
  /** 是否在创建后自动打开 */
  autoOpen?: boolean;
}

/**
 * Canvas 节点转 Excalidraw 的映射结果
 */
export interface CanvasToExcalidrawResult {
  /** 是否成功 */
  success: boolean;
  /** 创建的 Excalidraw 文件路径 */
  filePath?: string;
  /** 错误信息 */
  error?: string;
  /** 创建的节点数量 */
  nodeCount?: number;
  /** 创建的连接数量 */
  edgeCount?: number;
}
