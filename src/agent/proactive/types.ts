/** 单个章节的触发状态 */
export interface ChapterTrigger {
  highlightCount: number;
  highlights: string[];
  triggered: boolean;
}

/** 每本书的主动引导状态 */
export interface ProactiveState {
  version: 1;
  bookId: string;
  /** 是否已发送过初始检视引导 */
  guidanceInitiated: boolean;
  /** 各章节的触发状态 */
  chapterTriggers: Record<string, ChapterTrigger>;
  /** 上次主动提问的 ISO 时间戳 */
  lastProactiveAt: string | null;
}

/** 主动引导触发参数 */
export type ProactiveTrigger = 'inspectional' | 'highlight' | 'chapter';

export interface ProactiveParams {
  trigger: ProactiveTrigger;
  bookId: string;
  chapterId?: string;
  highlightContext?: string[];
}
