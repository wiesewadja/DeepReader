import { HierarchicalTreeLayout } from './hierarchical-tree.js';
import { FlowHorizontalLayout } from './flow-horizontal.js';
import { TimelineLayout } from './timeline.js';
import { RadialLayout } from './radial.js';
import { MatrixLayout } from './matrix.js';
import { MindMapLayout } from './mind-map.js';
import type { DiagramLayoutType, LayoutEngine } from '../excalidraw-types.js';

export const LAYOUT_REGISTRY: Record<DiagramLayoutType, LayoutEngine> = {
  'hierarchical-tree': HierarchicalTreeLayout,
  'flow-horizontal': FlowHorizontalLayout,
  'timeline': TimelineLayout,
  'radial': RadialLayout,
  'matrix': MatrixLayout,
  'mind-map': MindMapLayout,
};
