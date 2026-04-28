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
  /** 检视引导进度：0=未开始, 1=第一步已发, 2=第二步已发, 3=完成 */
  inspectionalStep: number;
  /** 各章节的触发状态 */
  chapterTriggers: Record<string, ChapterTrigger>;
  /** 上次主动提问的 ISO 时间戳 */
  lastProactiveAt: string | null;
  /** 用户跳过苏格拉底问题的次数 */
  socraticSkipCount: number;
}

/** 主动引导触发参数 */
export type ProactiveTrigger = 'inspectional' | 'inspectional_followup' | 'highlight' | 'chapter';

export interface ProactiveParams {
  trigger: ProactiveTrigger;
  bookId: string;
  chapterId?: string;
  highlightContext?: string[];
  step?: number;
  userReply?: string;
}
