/**
 * 生成 4 个测试 Excalidraw 图形文件
 * 直接使用 Node.js 生成（避免 evalObsidian 的编码问题）
 */
import { writeFileSync, mkdirSync } from 'fs';

const OUTPUT_DIR = 'test-vault/Excalidraw';
mkdirSync(OUTPUT_DIR, { recursive: true });

let seedCounter = 100000;
function nextSeed() { return seedCounter++; }
function now() { return Date.now(); }

function toEl(el) {
  const isText = el.type === 'text';
  const isArrow = el.type === 'arrow';
  const isLine = el.type === 'line';

  const base = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    angle: 0,
    strokeColor: el.strokeColor ?? '#1e293b',
    backgroundColor: el.backgroundColor ?? 'transparent',
    fillStyle: el.fillStyle ?? 'solid',
    strokeWidth: el.strokeWidth ?? (isLine || isArrow ? 1 : 2),
    strokeStyle: 'solid',
    roughness: el.roughness ?? 0,
    opacity: el.opacity ?? 100,
    groupIds: el.groupIds ?? [],
    frameId: null,
    roundness: ['rectangle', 'ellipse', 'diamond'].includes(el.type) ? { type: 3 } : null,
    seed: nextSeed(),
    version: 1,
    versionNonce: now(),
    isDeleted: false,
    boundElements: el.boundElements?.length ? el.boundElements : null,
    updated: now(),
    link: null,
    locked: false,
  };

  if (isText) {
    base.text = el.text ?? '';
    base.originalText = el.text ?? '';
    base.fontSize = el.fontSize ?? 20;
    base.fontFamily = 3;
    base.textAlign = el.textAlign ?? 'center';
    base.verticalAlign = el.verticalAlign ?? 'middle';
    base.containerId = el.containerId ?? null;
  }

  if (isArrow || isLine) {
    base.startBinding = el.startBinding ?? null;
    base.endBinding = el.endBinding ?? null;
    base.startArrowhead = isArrow ? (el.startArrowHead ?? null) : undefined;
    base.endArrowhead = isArrow ? (el.endArrowHead ?? 'arrow') : undefined;
    base.lastCommittedPoint = null;
    base.width = 0;
    base.height = 0;
    base.points = el.points ?? [[0, 0], [1, 0]];
  }

  return base;
}

function buildFile(elements) {
  seedCounter = 100000;
  const result = [];

  for (const el of elements) {
    const isContainer = ['rectangle', 'ellipse', 'diamond'].includes(el.type);
    const isArrowOrLine = el.type === 'arrow' || el.type === 'line';
    const needsAutoText = isContainer && el.text && el.type !== 'text';

    if (needsAutoText) {
      const textId = `${el.id}_text`;
      const shapeEl = toEl(el);
      shapeEl.boundElements = [{ id: textId, type: 'text' }];
      result.push(shapeEl);

      const textEl = toEl({
        ...el,
        id: textId,
        type: 'text',
        x: el.x + 10,
        y: el.y + 10,
        width: el.width - 20,
        height: el.height - 20,
        containerId: el.id,
        strokeColor: el.strokeColor || '#1e293b',
        fontSize: el.fontSize || 20,
      });
      textEl.containerId = el.id;
      result.push(textEl);
    } else if (isArrowOrLine && (el.startBinding || el.endBinding)) {
      // Auto-calculate arrow positions
      const arrowEl = toEl(el);
      const startEl = elements.find(e => e.id === el.startBinding?.elementId);
      const endEl = elements.find(e => e.id === el.endBinding?.elementId);
      if (startEl && endEl) {
        const sx = startEl.x + startEl.width / 2;
        const sy = startEl.y + startEl.height / 2;
        const ex = endEl.x + endEl.width / 2;
        const ey = endEl.y + endEl.height / 2;
        arrowEl.x = sx;
        arrowEl.y = sy;
        arrowEl.points = [[0, 0], [ex - sx, ey - sy]];
      }
      result.push(arrowEl);
    } else {
      result.push(toEl(el));
    }
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements: result,
    appState: { viewBackgroundColor: '#ffffff', gridSize: 20 },
    files: {},
  };
}

// ===== S1: 思维导图 - AI 极简经济学 =====
const s1 = buildFile([
  { id: 'root', type: 'ellipse', x: 400, y: 300, width: 260, height: 80, text: 'AI 极简经济学', strokeColor: '#1e293b', backgroundColor: '#e0f2fe', fontSize: 24 },
  { id: 'n1', type: 'rectangle', x: 50, y: 60, width: 200, height: 60, text: '预测', strokeColor: '#0369a1', backgroundColor: '#dbeafe' },
  { id: 'n2', type: 'rectangle', x: 800, y: 60, width: 200, height: 60, text: '判断', strokeColor: '#166534', backgroundColor: '#dcfce7' },
  { id: 'n3', type: 'rectangle', x: 50, y: 520, width: 200, height: 60, text: '行动', strokeColor: '#c2410c', backgroundColor: '#fed7aa' },
  { id: 'n4', type: 'rectangle', x: 800, y: 520, width: 200, height: 60, text: '策略', strokeColor: '#6b21a8', backgroundColor: '#f3e8ff' },
  // Arrows from root to children
  { id: 'a1', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#0369a1', startBinding: { elementId: 'root', gap: 5, focus: 0 }, endBinding: { elementId: 'n1', gap: 5, focus: 0 } },
  { id: 'a2', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#166534', startBinding: { elementId: 'root', gap: 5, focus: 0 }, endBinding: { elementId: 'n2', gap: 5, focus: 0 } },
  { id: 'a3', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#c2410c', startBinding: { elementId: 'root', gap: 5, focus: 0 }, endBinding: { elementId: 'n3', gap: 5, focus: 0 } },
  { id: 'a4', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#6b21a8', startBinding: { elementId: 'root', gap: 5, focus: 0 }, endBinding: { elementId: 'n4', gap: 5, focus: 0 } },
]);

// ===== S2: 流程图 - 阅读的四个层次 =====
const s2 = buildFile([
  { id: 'start', type: 'ellipse', x: 300, y: 30, width: 200, height: 60, text: '开始阅读', strokeColor: '#166534', backgroundColor: '#dcfce7', fontSize: 20 },
  { id: 's1', type: 'rectangle', x: 300, y: 150, width: 200, height: 60, text: '基础阅读', strokeColor: '#0369a1', backgroundColor: '#dbeafe' },
  { id: 's2', type: 'rectangle', x: 300, y: 270, width: 200, height: 60, text: '检视阅读', strokeColor: '#0369a1', backgroundColor: '#dbeafe' },
  { id: 'decision', type: 'diamond', x: 280, y: 390, width: 240, height: 100, text: '是否理解?', strokeColor: '#ca8a04', backgroundColor: '#fef9c3', fontSize: 18 },
  { id: 's3', type: 'rectangle', x: 300, y: 540, width: 200, height: 60, text: '分析阅读', strokeColor: '#0369a1', backgroundColor: '#dbeafe' },
  { id: 's4', type: 'rectangle', x: 300, y: 660, width: 200, height: 60, text: '主题阅读', strokeColor: '#7c3aed', backgroundColor: '#ede9fe' },
  { id: 'end', type: 'ellipse', x: 300, y: 780, width: 200, height: 60, text: '融会贯通', strokeColor: '#dc2626', backgroundColor: '#fee2e2' },
  // "否" loop back
  { id: 'retry', type: 'rectangle', x: 620, y: 390, width: 180, height: 60, text: '重新检视', strokeColor: '#ea580c', backgroundColor: '#fed7aa' },
  // Arrows
  { id: 'a_start_s1', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#475569', startBinding: { elementId: 'start', gap: 5, focus: 0 }, endBinding: { elementId: 's1', gap: 5, focus: 0 } },
  { id: 'a_s1_s2', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#475569', startBinding: { elementId: 's1', gap: 5, focus: 0 }, endBinding: { elementId: 's2', gap: 5, focus: 0 } },
  { id: 'a_s2_dec', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#475569', startBinding: { elementId: 's2', gap: 5, focus: 0 }, endBinding: { elementId: 'decision', gap: 5, focus: 0 } },
  { id: 'a_dec_s3', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#166534', startBinding: { elementId: 'decision', gap: 5, focus: 0 }, endBinding: { elementId: 's3', gap: 5, focus: 0 } },
  { id: 'a_s3_s4', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#475569', startBinding: { elementId: 's3', gap: 5, focus: 0 }, endBinding: { elementId: 's4', gap: 5, focus: 0 } },
  { id: 'a_s4_end', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#475569', startBinding: { elementId: 's4', gap: 5, focus: 0 }, endBinding: { elementId: 'end', gap: 5, focus: 0 } },
  { id: 'a_dec_retry', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#ea580c', startBinding: { elementId: 'decision', gap: 5, focus: 0 }, endBinding: { elementId: 'retry', gap: 5, focus: 0 } },
]);

// ===== S3: 概念图 - AI 核心概念 =====
const s3 = buildFile([
  { id: 'ai', type: 'ellipse', x: 350, y: 30, width: 200, height: 70, text: '人工智能', strokeColor: '#1e293b', backgroundColor: '#e0f2fe', fontSize: 22 },
  { id: 'ml', type: 'ellipse', x: 50, y: 200, width: 180, height: 60, text: '机器学习', strokeColor: '#0369a1', backgroundColor: '#dbeafe' },
  { id: 'dl', type: 'ellipse', x: 320, y: 200, width: 180, height: 60, text: '深度学习', strokeColor: '#166534', backgroundColor: '#dcfce7' },
  { id: 'nlp', type: 'ellipse', x: 590, y: 200, width: 180, height: 60, text: '自然语言处理', strokeColor: '#7c3aed', backgroundColor: '#ede9fe' },
  { id: 'cnn', type: 'rectangle', x: 100, y: 370, width: 160, height: 50, text: '卷积网络', strokeColor: '#166534', backgroundColor: '#dcfce7' },
  { id: 'rnn', type: 'rectangle', x: 320, y: 370, width: 160, height: 50, text: '循环网络', strokeColor: '#166534', backgroundColor: '#dcfce7' },
  { id: 'transformer', type: 'rectangle', x: 540, y: 370, width: 180, height: 50, text: 'Transformer', strokeColor: '#7c3aed', backgroundColor: '#ede9fe' },
  // Arrows
  { id: 'a_ai_ml', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#0369a1', startBinding: { elementId: 'ai', gap: 5, focus: 0 }, endBinding: { elementId: 'ml', gap: 5, focus: 0 } },
  { id: 'a_ai_dl', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#166534', startBinding: { elementId: 'ai', gap: 5, focus: 0 }, endBinding: { elementId: 'dl', gap: 5, focus: 0 } },
  { id: 'a_ai_nlp', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#7c3aed', startBinding: { elementId: 'ai', gap: 5, focus: 0 }, endBinding: { elementId: 'nlp', gap: 5, focus: 0 } },
  { id: 'a_dl_cnn', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#166534', startBinding: { elementId: 'dl', gap: 5, focus: 0 }, endBinding: { elementId: 'cnn', gap: 5, focus: 0 } },
  { id: 'a_dl_rnn', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#166534', startBinding: { elementId: 'dl', gap: 5, focus: 0 }, endBinding: { elementId: 'rnn', gap: 5, focus: 0 } },
  { id: 'a_nlp_trans', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#7c3aed', startBinding: { elementId: 'nlp', gap: 5, focus: 0 }, endBinding: { elementId: 'transformer', gap: 5, focus: 0 } },
]);

// ===== S4: 全书框架 - AI 极简经济学 =====
const s4 = buildFile([
  { id: 'title', type: 'text', x: 200, y: 20, width: 600, height: 40, text: 'AI 极简经济学 — 全书框架', fontSize: 28, strokeColor: '#1e293b' },
  // Part 1
  { id: 'p1', type: 'rectangle', x: 50, y: 100, width: 300, height: 70, text: 'Part 1: 预测', strokeColor: '#0369a1', backgroundColor: '#dbeafe', fontSize: 22 },
  // Part 2
  { id: 'p2', type: 'rectangle', x: 400, y: 100, width: 300, height: 70, text: 'Part 2: 判断', strokeColor: '#166534', backgroundColor: '#dcfce7', fontSize: 22 },
  // Part 3
  { id: 'p3', type: 'rectangle', x: 750, y: 100, width: 300, height: 70, text: 'Part 3: 行动', strokeColor: '#c2410c', backgroundColor: '#fed7aa', fontSize: 22 },
  // Sub-items for Part 1
  { id: 'p1_1', type: 'rectangle', x: 20, y: 230, width: 170, height: 50, text: '预测机器', strokeColor: '#64748b', backgroundColor: '#f1f5f9' },
  { id: 'p1_2', type: 'rectangle', x: 210, y: 230, width: 170, height: 50, text: '低成本预测', strokeColor: '#64748b', backgroundColor: '#f1f5f9' },
  // Sub-items for Part 2
  { id: 'p2_1', type: 'rectangle', x: 370, y: 230, width: 170, height: 50, text: '判断力', strokeColor: '#64748b', backgroundColor: '#f1f5f9' },
  { id: 'p2_2', type: 'rectangle', x: 560, y: 230, width: 170, height: 50, text: '决策智能', strokeColor: '#64748b', backgroundColor: '#f1f5f9' },
  // Sub-items for Part 3
  { id: 'p3_1', type: 'rectangle', x: 720, y: 230, width: 170, height: 50, text: '工作任务', strokeColor: '#64748b', backgroundColor: '#f1f5f9' },
  { id: 'p3_2', type: 'rectangle', x: 910, y: 230, width: 170, height: 50, text: 'AI 战略', strokeColor: '#64748b', backgroundColor: '#f1f5f9' },
  // Arrows from parts to sub-items
  { id: 'ap1_1', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#0369a1', startBinding: { elementId: 'p1', gap: 5, focus: 0 }, endBinding: { elementId: 'p1_1', gap: 5, focus: 0 } },
  { id: 'ap1_2', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#0369a1', startBinding: { elementId: 'p1', gap: 5, focus: 0 }, endBinding: { elementId: 'p1_2', gap: 5, focus: 0 } },
  { id: 'ap2_1', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#166534', startBinding: { elementId: 'p2', gap: 5, focus: 0 }, endBinding: { elementId: 'p2_1', gap: 5, focus: 0 } },
  { id: 'ap2_2', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#166534', startBinding: { elementId: 'p2', gap: 5, focus: 0 }, endBinding: { elementId: 'p2_2', gap: 5, focus: 0 } },
  { id: 'ap3_1', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#c2410c', startBinding: { elementId: 'p3', gap: 5, focus: 0 }, endBinding: { elementId: 'p3_1', gap: 5, focus: 0 } },
  { id: 'ap3_2', type: 'arrow', x: 0, y: 0, width: 0, height: 0, strokeColor: '#c2410c', startBinding: { elementId: 'p3', gap: 5, focus: 0 }, endBinding: { elementId: 'p3_2', gap: 5, focus: 0 } },
]);

// Write all files
const files = [
  { name: 'S1-思维导图-AI经济学', data: s1 },
  { name: 'S2-流程图-阅读层次', data: s2 },
  { name: 'S3-概念图-AI核心概念', data: s3 },
  { name: 'S4-全书框架-AI经济学', data: s4 },
];

for (const f of files) {
  const path = `${OUTPUT_DIR}/${f.name}.excalidraw`;
  writeFileSync(path, JSON.stringify(f.data, null, 2));
  console.log(`Generated: ${path}`);
}

console.log('\nAll 4 files generated successfully!');
