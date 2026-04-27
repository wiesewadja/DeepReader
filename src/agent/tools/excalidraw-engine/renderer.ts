// src/agent/tools/excalidraw-engine/renderer.ts
import type { ExcalidrawAutomate } from '../../../types/excalidraw.js';
import type { LayoutResult, RenderNode, RenderEdge, RenderGroup } from './types.js';
import { ANNOTATION_STYLE, EDGE_LABEL_STYLE } from './styles.js';
import { toolsLog as log } from '../../../utils/logger.js';

const DEFAULT_FOLDER = 'DeepReader/Excalidraw';

function getAPI(): ExcalidrawAutomate | null {
  return window.ExcalidrawAutomate ?? null;
}

function checkAPI(): ExcalidrawAutomate {
  const ea = getAPI();
  if (!ea) throw new Error('Excalidraw 插件未安装或未启用');
  return ea;
}

function getStyle(ea: ExcalidrawAutomate): any {
  return (ea as any).style;
}

function applyNodeStyle(ea: ExcalidrawAutomate, node: RenderNode): void {
  const s = getStyle(ea);
  s.strokeColor = node.strokeColor;
  s.backgroundColor = node.fillColor;
  s.fillStyle = 'solid';
  s.strokeWidth = node.strokeWidth;
  s.strokeStyle = 'solid';
  s.roughness = node.roughness;
  s.fontFamily = node.fontFamily ?? 3;
  s.fontSize = node.fontSize;
}

function addNode(ea: ExcalidrawAutomate, node: RenderNode): string {
  const { x, y, width, height, text, shape, annotation } = node;
  const boxPadding = shape === 'ellipse' ? 15 : 10;

  applyNodeStyle(ea, node);

  let nodeId: string;
  if (shape === 'ellipse') {
    nodeId = ea.addText(
      x - width / 2, y - height / 2, text,
      { wrapAt: width, width, height, textAlign: 'center', verticalAlign: 'middle', box: 'ellipse', boxPadding },
    );
  } else if (shape === 'diamond') {
    nodeId = ea.addText(
      x - width / 2, y - height / 2, text,
      { wrapAt: width - 10, width: width - 10, height, textAlign: 'center', verticalAlign: 'middle', box: 'diamond', boxPadding },
    );
  } else {
    nodeId = ea.addText(
      x - width / 2, y - height / 2, text,
      { wrapAt: width, width, height, textAlign: 'center', verticalAlign: 'middle', box: 'box', boxPadding },
    );
  }

  if (annotation) {
    const annY = y + height / 2 + 8;
    const annWrapWidth = Math.max(width + 40, 200);
    const s = getStyle(ea);
    s.strokeColor = ANNOTATION_STYLE.color;
    s.backgroundColor = 'transparent';
    s.fontSize = ANNOTATION_STYLE.fontSize;
    s.fontFamily = 3;
    ea.addText(x - annWrapWidth / 2, annY, annotation, { wrapAt: annWrapWidth, textAlign: 'center' });
  }

  return nodeId;
}

function addEdgeLabel(ea: ExcalidrawAutomate, edge: RenderEdge): void {
  const labelPos = edge.labelPos;
  if (!labelPos || !edge.label) return;

  const textLen = edge.label.length;
  const hasCJK = /[一-鿿぀-ゟ゠-ヿ]/.test(edge.label);
  const charWidth = hasCJK ? 1.0 : 0.6;
  const bgWidth = textLen * EDGE_LABEL_STYLE.fontSize * charWidth + EDGE_LABEL_STYLE.padding * 2;
  const bgHeight = EDGE_LABEL_STYLE.fontSize + EDGE_LABEL_STYLE.padding * 2;

  const s = getStyle(ea);
  s.strokeColor = 'transparent';
  s.backgroundColor = EDGE_LABEL_STYLE.bgColor;
  s.fillStyle = 'solid';
  s.strokeWidth = 0;
  ea.addRect(labelPos.x - bgWidth / 2, labelPos.y - bgHeight / 2, bgWidth, bgHeight);

  s.strokeColor = '#495057';
  s.backgroundColor = 'transparent';
  s.fontSize = EDGE_LABEL_STYLE.fontSize;
  ea.addText(
    labelPos.x - bgWidth / 2 + EDGE_LABEL_STYLE.padding,
    labelPos.y - bgHeight / 2 + EDGE_LABEL_STYLE.padding,
    edge.label,
  );
}

function addEdge(ea: ExcalidrawAutomate, edge: RenderEdge): void {
  const formatting: any = {
    startArrowHead: edge.startArrow,
    endArrowHead: edge.endArrow,
    numberOfPoints: edge.numberOfPoints ?? 0,
  };

  const s = getStyle(ea);
  s.strokeColor = edge.strokeColor;
  s.strokeWidth = edge.strokeWidth;
  s.strokeStyle = edge.strokeStyle;

  ea.connectObjects(edge.fromId, edge.fromSide, edge.toId, edge.toSide, formatting);

  if (edge.label) {
    addEdgeLabel(ea, edge);
  }
}

function addGroup(ea: ExcalidrawAutomate, group: RenderGroup): void {
  const s = getStyle(ea);
  s.strokeColor = group.strokeColor;
  s.backgroundColor = group.fillColor;
  s.fillStyle = 'solid';
  s.strokeWidth = 1;
  s.strokeStyle = 'dashed';
  s.roughness = 0;
  const rectId = ea.addRect(group.x, group.y, group.width, group.height);

  s.strokeColor = group.strokeColor;
  s.backgroundColor = 'transparent';
  s.fontSize = 14;
  s.fontFamily = 1;
  const titleId = ea.addText(group.x + 10, group.y + 8, group.label);

  ea.addToGroup([rectId, titleId]);
}

export async function render(layout: LayoutResult, filename: string, folder?: string): Promise<{ filePath: string; nodeCount: number; edgeCount: number }> {
  const ea = checkAPI();
  ea.clear();

  log('renderer', `开始渲染: ${layout.nodes.length} 节点, ${layout.edges.length} 边, ${layout.groups.length} 分组`);

  for (const group of layout.groups) {
    addGroup(ea, group);
  }

  const nodeIdMap = new Map<string, string>();
  for (const node of layout.nodes) {
    const elementId = addNode(ea, node);
    nodeIdMap.set(node.id, elementId);
  }

  for (const edge of layout.edges) {
    const fromElId = nodeIdMap.get(edge.fromId);
    const toElId = nodeIdMap.get(edge.toId);
    if (!fromElId || !toElId) {
      log('renderer', `跳过边: ${edge.fromId} → ${edge.toId}（节点不存在）`);
      continue;
    }
    const resolvedEdge: RenderEdge = { ...edge, fromId: fromElId, toId: toElId };
    addEdge(ea, resolvedEdge);
  }

  const targetFolder = folder || DEFAULT_FOLDER;
  await ea.create({ filename, foldername: targetFolder, silent: true });

  log('renderer', `渲染完成: ${filename}.excalidraw.md`);

  return {
    filePath: `${targetFolder}/${filename}.excalidraw.md`,
    nodeCount: layout.nodes.length,
    edgeCount: layout.edges.length,
  };
}
