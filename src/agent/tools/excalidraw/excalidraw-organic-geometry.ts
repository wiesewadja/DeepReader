/**
 * 有机连线的几何生成工具：采样、插值、贝塞尔曲线与手绘抖动。
 */

import type { DiagramLayoutType } from './excalidraw-types.js';

// 伪随机数生成器 (保证图形线条手绘形状决定性一致，无 git diff 噪音)
export function createSeededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function getSeedFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cubicBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  const x =
    Math.pow(1 - t, 3) * p0[0] +
    3 * Math.pow(1 - t, 2) * t * p1[0] +
    3 * (1 - t) * Math.pow(t, 2) * p2[0] +
    Math.pow(t, 3) * p3[0];
  const y =
    Math.pow(1 - t, 3) * p0[1] +
    3 * Math.pow(1 - t, 2) * t * p1[1] +
    3 * (1 - t) * Math.pow(t, 2) * p2[1] +
    Math.pow(t, 3) * p3[1];
  return [x, y];
}

// 连线坐标插值与手绘抖动生成
export function generateConnectorPoints(
  start: [number, number],
  end: [number, number],
  layout?: DiagramLayoutType,
  seed: number = 42
): [number, number][] {
  const sx = start[0], sy = start[1];
  const ex = end[0], ey = end[1];
  const dx = ex - sx;
  const dy = ey - sy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // 退化情况：start == end，返回两点（避免曲线控制点塌缩导致计算异常）
  if (dist < 1) {
    return [[sx, sy], [ex, ey]];
  }

  // 采样步长：根据距离动态调整 (30px 左右采样一步)
  const steps = Math.max(8, Math.min(24, Math.floor(dist / 30)));
  const rand = createSeededRandom(seed);

  const isCurved = layout === 'mind-map' || layout === 'radial';

  if (!isCurved) {
    // 直线：线性插值 + 极轻微抖动
    const points: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let x = lerp(sx, ex, t);
      let y = lerp(sy, ey, t);
      if (i > 0 && i < steps) {
        const jitter = (rand() - 0.5) * 1.2;
        x += jitter;
        y += jitter;
      }
      points.push([x, y]);
    }
    return points;
  }

  // 曲线：Cubic Bezier S型对称控制点
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const perpX = -dy / (dist || 1);
  const perpY = dx / (dist || 1);
  const curveStrength = dist * 0.15;
  const cp1: [number, number] = [mx + perpX * curveStrength, my + perpY * curveStrength];
  const cp2: [number, number] = [mx - perpX * curveStrength, my - perpY * curveStrength];

  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = cubicBezier([sx, sy], cp1, cp2, [ex, ey], t);
    if (i > 0 && i < steps) {
      p[0] += (rand() - 0.5) * 0.8;
      p[1] += (rand() - 0.5) * 0.8;
    }
    points.push(p);
  }
  return points;
}

// 模拟马克笔压力参数
export function generatePressures(count: number): number[] {
  const pressures: number[] = [];
  if (count <= 1) return [1.0];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const fromStart = Math.min(t * 4, 1);
    const fromEnd = Math.min((1 - t) * 4, 1);
    const pressure = Math.min(fromStart, fromEnd) * 0.6 + 0.4;
    pressures.push(Math.max(0.2, Math.min(1.0, pressure)));
  }
  return pressures;
}
