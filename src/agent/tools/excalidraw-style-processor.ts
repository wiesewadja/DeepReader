/**
 * 有机书卷风格处理器。
 *
 * 把 LLM 输出的语义化元素（带 semanticColor）转换为具体视觉属性：
 * - 节点：主题色板 + 手绘 roughness
 * - 连线/箭头：转换为 freedraw，附上手绘笔触参数
 * - 背景：宣纸书卷色
 *
 * 入口：applyOrganicScrollStyle
 */

import { edgeIntersection } from './excalidraw-geometry.js';
import type { ElementDef, DiagramLayoutType } from './excalidraw-types.js';
import {
  type ObsidianTheme,
  type SemanticColor,
  PALETTE,
  BACKGROUNDS,
  TEXT_COLORS,
  ORGANIC_LINE_PRESET,
} from './excalidraw-organic-palette.js';
import {
  generateConnectorPoints,
  generatePressures,
  lerp,
  createSeededRandom,
  getSeedFromId,
} from './excalidraw-organic-geometry.js';

export interface StyleProcessorInput {
  elements: ElementDef[];
  layout?: DiagramLayoutType;
  theme: ObsidianTheme;
  enabled: boolean;
}

export interface StyleProcessorOutput {
  elements: ElementDef[];
  viewBackgroundColor: string;
}

function resolveSemanticColor(theme: ObsidianTheme, color?: SemanticColor): SemanticColor {
  if (color && PALETTE[theme][color]) return color;
  return 'neutral';
}

// 辅助方法：处理节点样式映射
// 给自由文本加浅色背景卡片，增强视觉隔离
function wrapTextWithBackground(el: ElementDef, theme: ObsidianTheme): ElementDef[] {
  const semantic = resolveSemanticColor(theme, el.semanticColor);
  const col = PALETTE[theme][semantic];
  const paddingX = 12;
  const paddingY = 8;
  const bgId = `${el.id}_bg`;

  const bg: ElementDef = {
    id: bgId,
    type: 'rectangle',
    x: el.x - paddingX,
    y: el.y - paddingY,
    width: el.width + paddingX * 2,
    height: el.height + paddingY * 2,
    strokeColor: col.stroke,
    backgroundColor: col.textBg,
    roughness: 1,
    strokeWidth: 1,
    fillStyle: 'solid',
    semanticColor: el.semanticColor,
    boundElements: [{ id: el.id, type: 'text' }],
  };

  const styledText: ElementDef = {
    ...el,
    strokeColor: el.semanticColor ? col.stroke : (el.strokeColor || TEXT_COLORS[theme]),
    containerId: bgId,
  };

  return [bg, styledText];
}

function styleNodes(elements: ElementDef[], theme: ObsidianTheme): ElementDef[] {
  const result: ElementDef[] = [];
  for (const el of elements) {
    const isShape = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
    const isText = el.type === 'text';

    if (isShape) {
      const col = PALETTE[theme][resolveSemanticColor(theme, el.semanticColor)];
      result.push({
        ...el,
        strokeColor: col.stroke,
        backgroundColor: col.fill,
        roughness: 1,         // 手绘度
        strokeWidth: 2,       // 轻微加粗
        fillStyle: 'solid',
      });
    } else if (isText) {
      if (el.containerId) {
        // 已绑定到容器的文本：只上色，不加额外背景
        const strokeColor = el.semanticColor
          ? PALETTE[theme][resolveSemanticColor(theme, el.semanticColor)].stroke
          : (el.strokeColor || TEXT_COLORS[theme]);
        result.push({ ...el, strokeColor });
      } else {
        // 自由文本：生成浅色背景卡片
        result.push(...wrapTextWithBackground(el, theme));
      }
    }
    // arrow/line 会被 convertConnectors 转换为 freedraw，此处不输出
  }
  return result;
}

// 辅助方法：构建手绘风格箭头双翼
function buildArrowheadWings(
  shaftId: string,
  endPoint: [number, number],
  prevPoint: [number, number],
  strokeColor: string,
  groupIds: string[]
): ElementDef[] {
  const dx = endPoint[0] - prevPoint[0];
  const dy = endPoint[1] - prevPoint[1];
  const angle = Math.atan2(dy, dx);

  const arrowLength = 14;
  const arrowAngle = Math.PI / 6; // 30度

  const w1_end: [number, number] = [
    endPoint[0] - arrowLength * Math.cos(angle - arrowAngle),
    endPoint[1] - arrowLength * Math.sin(angle - arrowAngle),
  ];
  const w2_end: [number, number] = [
    endPoint[0] - arrowLength * Math.cos(angle + arrowAngle),
    endPoint[1] - arrowLength * Math.sin(angle + arrowAngle),
  ];

  const generateWingPoints = (start: [number, number], end: [number, number], wseed: number) => {
    const wpts: [number, number][] = [];
    const wsteps = 3;
    const wrand = createSeededRandom(wseed);
    for (let k = 0; k <= wsteps; k++) {
      const wt = k / wsteps;
      let wx = lerp(start[0], end[0], wt);
      let wy = lerp(start[1], end[1], wt);
      if (k > 0 && k < wsteps) {
        const wjitter = (wrand() - 0.5) * 0.8;
        wx += wjitter;
        wy += wjitter;
      }
      wpts.push([wx, wy]);
    }
    return wpts;
  };

  const wing1Pts = generateWingPoints(endPoint, w1_end, getSeedFromId(shaftId) + 1);
  const wing2Pts = generateWingPoints(endPoint, w2_end, getSeedFromId(shaftId) + 2);

  const makeWing = (id: string, pts: [number, number][]): ElementDef => ({
    id,
    type: 'freedraw',
    x: pts[0][0],
    y: pts[0][1],
    width: 0,
    height: 0,
    strokeColor,
    backgroundColor: 'transparent',
    groupIds,
    points: pts.map(p => [p[0] - pts[0][0], p[1] - pts[0][1]] as [number, number]),
    customData: {
      strokeOptions: ORGANIC_LINE_PRESET,
      isOrganicConnector: true,
      pressures: generatePressures(pts.length),
    },
  });

  return [
    makeWing(`${shaftId}_wing1`, wing1Pts),
    makeWing(`${shaftId}_wing2`, wing2Pts),
  ];
}

// 取连线的 groupIds；为空时用 el.id 生成确定性 fallback（保证同一图形多次构建结果一致）
function buildConnectorGroupIds(el: ElementDef): string[] {
  return el.groupIds && el.groupIds.length > 0
    ? el.groupIds
    : [`arrow_group_${el.id}`];
}

// 辅助方法：将连线转为 freedraw 手绘风格
function convertConnectors(
  elements: ElementDef[],
  elMap: Map<string, ElementDef>,
  layout: DiagramLayoutType | undefined,
  theme: ObsidianTheme
): ElementDef[] {
  const result: ElementDef[] = [];
  for (const el of elements) {
    const isArrow = el.type === 'arrow';
    const isLine = el.type === 'line';
    if (!isArrow && !isLine) continue;

    const startEl = el.startBinding ? elMap.get(el.startBinding.elementId) : null;
    const endEl = el.endBinding ? elMap.get(el.endBinding.elementId) : null;

    let points: [number, number][] = [];

    // 计算起点终点
    if (startEl && endEl) {
      const startCx = startEl.x + startEl.width / 2;
      const startCy = startEl.y + startEl.height / 2;
      const endCx = endEl.x + endEl.width / 2;
      const endCy = endEl.y + endEl.height / 2;

      const startPoint = edgeIntersection(startEl, endCx, endCy, 4);
      const endPoint = edgeIntersection(endEl, startCx, startCy, 4);

      const seed = getSeedFromId(el.id);
      points = generateConnectorPoints(startPoint, endPoint, layout, seed);
    } else if (el.points && el.points.length >= 2) {
      // 退化情况：直接对原始坐标点做线性插值
      const seed = getSeedFromId(el.id);
      points = generateConnectorPoints(el.points[0], el.points[el.points.length - 1], layout, seed);
    } else {
      // 没有起终点，跳过
      continue;
    }

    if (points.length < 2) continue;

    const col = PALETTE[theme][resolveSemanticColor(theme, el.semanticColor)];
    const groupIds = buildConnectorGroupIds(el);

    // 将轴线转化为相对坐标点数组
    const startX = points[0][0];
    const startY = points[0][1];
    const relativePoints = points.map(p => [p[0] - startX, p[1] - startY] as [number, number]);
    const pressures = generatePressures(points.length);

    const freedrawShaft: ElementDef = {
      id: el.id,
      type: 'freedraw',
      x: startX,
      y: startY,
      width: 0,
      height: 0,
      strokeColor: col.stroke,
      backgroundColor: 'transparent',
      strokeWidth: 1,
      opacity: 90,
      groupIds,
      points: relativePoints,
      customData: {
        ...el.customData,
        strokeOptions: ORGANIC_LINE_PRESET,
        isOrganicConnector: true, // 内部标记
        pressures,
      },
    };
    result.push(freedrawShaft);

    // 如果是 arrow 元素，且有方向性，则手动构建手绘风格箭头双翼
    if (isArrow && points.length >= 2) {
      const p1 = points[points.length - 2];
      const p2 = points[points.length - 1];
      const wings = buildArrowheadWings(el.id, p2, p1, col.stroke, groupIds);
      result.push(...wings);
    }
  }
  return result;
}

export function applyOrganicScrollStyle(input: StyleProcessorInput): StyleProcessorOutput {
  const { elements, layout, theme, enabled } = input;

  if (!enabled) {
    return {
      elements,
      viewBackgroundColor: '#ffffff',
    };
  }

  const elMap = new Map<string, ElementDef>();
  for (const el of elements) {
    elMap.set(el.id, el);
  }

  // 1. 处理节点和普通文本的属性覆写
  const styledNodes = styleNodes(elements, theme);

  // 2. 将连线转为 freedraw 手绘风格
  const connectors = convertConnectors(elements, elMap, layout, theme);

  return {
    elements: [...connectors, ...styledNodes],
    viewBackgroundColor: BACKGROUNDS[theme],
  };
}
