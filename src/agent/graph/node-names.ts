/**
 * Graph node name constants
 *
 * LangGraph conditional edges require string node names for routing.
 * Centralizing them here prevents typos from causing silent routing failures.
 *
 * Source: @langchain/langgraph 1.3.0 — addConditionalEdges routing functions
 * return string node names or END.
 */

export const NODE_NAMES = {
  ROUTER: 'router',
  INSPECTIONAL: 'inspectional',
  PRE_SEARCH: 'pre_search',
  ANALYTICAL: 'analytical',
  SYNTOPICAL: 'syntopical',
  VISUALIZER: 'visualizer',
  FORMATTER: 'formatter',
} as const;

/** Edge map keys used by addConditionalEdges (distinct from node names) */
export const EDGE_KEYS = {
  CONTINUE: 'continue',
  DONE: 'done',
} as const;
