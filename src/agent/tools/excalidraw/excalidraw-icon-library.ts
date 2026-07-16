/**
 * Excalidraw SVG 图标库模块
 *
 * 内置 Lucide 图标（MIT 协议，免费开源），供 LLM 根据语义自动匹配。
 * 图标风格：线性图标，stroke 宽度 2，与手绘风格协调。
 */

import { toolsLog } from '../../../utils/logger.js';

/**
 * 图标定义
 */
export interface IconDefinition {
  /** 图标 CDN URL */
  url: string;
  /** 语义标签（用于中文匹配） */
  tags: string[];
  /** 分类 */
  category: 'concept' | 'action' | 'status' | 'entity' | 'flow';
}

/**
 * Lucide 图标库映射
 *
 * 使用 unpkg CDN 加载，支持离线缓存。
 */
const LUCIDE_VERSION = '0.300.0';
const LUCIDE_CDN = `https://unpkg.com/lucide-static@${LUCIDE_VERSION}/icons`;

export const LUCIDE_ICONS: Record<string, IconDefinition> = {
  // ========== 概念类 ==========
  'lightbulb': {
    url: `${LUCIDE_CDN}/lightbulb.svg`,
    tags: ['想法', '灵感', '创新', '思考', '概念', '创意'],
    category: 'concept',
  },
  'brain': {
    url: `${LUCIDE_CDN}/brain.svg`,
    tags: ['思维', '认知', '学习', '理解', '分析'],
    category: 'concept',
  },
  'target': {
    url: `${LUCIDE_CDN}/target.svg`,
    tags: ['目标', '目的', '焦点', '核心', '重点'],
    category: 'concept',
  },
  'star': {
    url: `${LUCIDE_CDN}/star.svg`,
    tags: ['重要', '亮点', '特色', '精选', '优质'],
    category: 'concept',
  },
  'sparkles': {
    url: `${LUCIDE_CDN}/sparkles.svg`,
    tags: ['魔法', '生成', 'AI', '智能', '自动化'],
    category: 'concept',
  },
  'eye': {
    url: `${LUCIDE_CDN}/eye.svg`,
    tags: ['查看', '观察', '视觉', '检查', '审查'],
    category: 'concept',
  },

  // ========== 动作类 ==========
  'gear': {
    url: `${LUCIDE_CDN}/gear.svg`,
    tags: ['设置', '配置', '工具', '过程', '机制'],
    category: 'action',
  },
  'rocket': {
    url: `${LUCIDE_CDN}/rocket.svg`,
    tags: ['启动', '发布', '开始', '快速', '创新'],
    category: 'action',
  },
  'play': {
    url: `${LUCIDE_CDN}/play.svg`,
    tags: ['播放', '运行', '执行', '开始', '启动'],
    category: 'action',
  },
  'pause': {
    url: `${LUCIDE_CDN}/pause.svg`,
    tags: ['暂停', '停止', '等待', '挂起'],
    category: 'action',
  },
  'refresh-cw': {
    url: `${LUCIDE_CDN}/refresh-cw.svg`,
    tags: ['刷新', '同步', '更新', '重试', '循环'],
    category: 'action',
  },
  'zap': {
    url: `${LUCIDE_CDN}/zap.svg`,
    tags: ['快速', '执行', '动作', '闪电', '紧急'],
    category: 'action',
  },

  // ========== 状态类 ==========
  'check-circle': {
    url: `${LUCIDE_CDN}/check-circle.svg`,
    tags: ['完成', '成功', '正确', '确认', '通过'],
    category: 'status',
  },
  'alert-circle': {
    url: `${LUCIDE_CDN}/alert-circle.svg`,
    tags: ['警告', '注意', '风险', '问题', '错误'],
    category: 'status',
  },
  'info': {
    url: `${LUCIDE_CDN}/info.svg`,
    tags: ['信息', '说明', '提示', '详情', '帮助'],
    category: 'status',
  },
  'x-circle': {
    url: `${LUCIDE_CDN}/x-circle.svg`,
    tags: ['失败', '错误', '取消', '删除', '关闭'],
    category: 'status',
  },
  'clock': {
    url: `${LUCIDE_CDN}/clock.svg`,
    tags: ['时间', '等待', '延迟', '超时', '定时'],
    category: 'status',
  },

  // ========== 实体类 ==========
  'book': {
    url: `${LUCIDE_CDN}/book.svg`,
    tags: ['书', '阅读', '文档', '知识', '学习'],
    category: 'entity',
  },
  'file-text': {
    url: `${LUCIDE_CDN}/file-text.svg`,
    tags: ['文件', '文档', '笔记', '内容', '记录'],
    category: 'entity',
  },
  'user': {
    url: `${LUCIDE_CDN}/user.svg`,
    tags: ['用户', '人员', '团队', '角色', '作者'],
    category: 'entity',
  },
  'users': {
    url: `${LUCIDE_CDN}/users.svg`,
    tags: ['团队', '协作', '多人', '群组', '组织'],
    category: 'entity',
  },
  'database': {
    url: `${LUCIDE_CDN}/database.svg`,
    tags: ['数据', '存储', '知识库', '信息', '仓库'],
    category: 'entity',
  },
  'folder': {
    url: `${LUCIDE_CDN}/folder.svg`,
    tags: ['文件夹', '目录', '分类', '归档', '整理'],
    category: 'entity',
  },
  'link': {
    url: `${LUCIDE_CDN}/link.svg`,
    tags: ['链接', '关联', '关系', '连接', '引用'],
    category: 'entity',
  },
  'tag': {
    url: `${LUCIDE_CDN}/tag.svg`,
    tags: ['标签', '分类', '标记', '属性', '元数据'],
    category: 'entity',
  },
  'code': {
    url: `${LUCIDE_CDN}/code.svg`,
    tags: ['代码', '开发', '技术', '编程', '脚本'],
    category: 'entity',
  },
  'calendar': {
    url: `${LUCIDE_CDN}/calendar.svg`,
    tags: ['时间', '日期', '计划', '日程', '安排'],
    category: 'entity',
  },

  // ========== 流程类 ==========
  'arrow-right': {
    url: `${LUCIDE_CDN}/arrow-right.svg`,
    tags: ['下一步', '流程', '方向', '前进', '继续'],
    category: 'flow',
  },
  'git-branch': {
    url: `${LUCIDE_CDN}/git-branch.svg`,
    tags: ['分支', '选择', '条件', '决策', '路由'],
    category: 'flow',
  },
  'layers': {
    url: `${LUCIDE_CDN}/layers.svg`,
    tags: ['层级', '层次', '堆叠', '结构', '架构'],
    category: 'flow',
  },
  'workflow': {
    url: `${LUCIDE_CDN}/workflow.svg`,
    tags: ['工作流', '流程', '管道', '管线', '编排'],
    category: 'flow',
  },
  'network': {
    url: `${LUCIDE_CDN}/network.svg`,
    tags: ['网络', '拓扑', '图谱', '关系图', '连接'],
    category: 'flow',
  },
};

/**
 * 图标缓存：成功结果永久缓存；失败结果 TTL 60s 后允许重试（避免瞬时网络抖动永久跳过）。
 */
const iconCache = new Map<string, string | null>();
const iconCacheTimestamp = new Map<string, number>();
const FAILURE_TTL_MS = 60_000;

/**
 * 图标 fetch 超时时间（ms）。
 * CDN 正常响应 < 500ms，5s 兜底足以覆盖慢网络但不会无限挂起。
 */
const ICON_FETCH_TIMEOUT_MS = 5_000;

/**
 * 加载 SVG 图标
 *
 * @param name 图标名称
 * @returns SVG 内容，加载失败返回 null
 */
export async function loadIcon(name: string): Promise<string | null> {
  const icon = LUCIDE_ICONS[name];
  if (!icon) {
    toolsLog('warn', `[excalidraw-icons] Icon "${name}" not found in library`);
    return null;
  }

  // 检查缓存（失败项有过期机制，成功项永久）
  if (iconCache.has(name)) {
    const cached = iconCache.get(name);
    if (cached != null) return cached;
    // 失败缓存：检查是否已过 TTL
    const ts = iconCacheTimestamp.get(name) ?? 0;
    if (Date.now() - ts < FAILURE_TTL_MS) return null;
    // TTL 已过，继续尝试加载
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ICON_FETCH_TIMEOUT_MS);
    const response = await fetch(icon.url, { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      toolsLog('warn', `[excalidraw-icons] Failed to load icon "${name}": ${response.status}`);
      iconCache.set(name, null);
      iconCacheTimestamp.set(name, Date.now());
      return null;
    }

    const svg = await response.text();
    iconCache.set(name, svg);
    return svg;
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    toolsLog('warn', `[excalidraw-icons] ${isAbort ? 'Timeout' : 'Error'} loading icon "${name}":`, isAbort ? `${ICON_FETCH_TIMEOUT_MS}ms timeout` : err);
    iconCache.set(name, null);
    iconCacheTimestamp.set(name, Date.now());
    return null;
  }
}

/**
 * 根据文本语义推荐图标
 *
 * 使用关键词匹配，返回最匹配的图标名称。
 *
 * @testOnly 生产管线由 LLM 通过 prompt 规则直接选图标，此函数仅供测试和手动建议场景。
 *
 * @param text 节点文本
 * @returns 图标名称，无匹配返回 null
 */
export function suggestIconForText(text: string): string | null {
  const lowerText = text.toLowerCase();

  for (const [name, icon] of Object.entries(LUCIDE_ICONS)) {
    if (icon.tags.some(tag => lowerText.includes(tag))) {
      return name;
    }
  }

  return null;
}

/**
 * 获取所有图标名称
 *
 * @testOnly 生产管线不使用此函数。
 */
export function getAllIconNames(): string[] {
  return Object.keys(LUCIDE_ICONS);
}

/**
 * 获取图标分类统计
 *
 * @testOnly 生产管线不使用此函数。
 */
export function getIconCategories(): Record<string, string[]> {
  const categories: Record<string, string[]> = {};
  for (const [name, icon] of Object.entries(LUCIDE_ICONS)) {
    if (!categories[icon.category]) {
      categories[icon.category] = [];
    }
    categories[icon.category].push(name);
  }
  return categories;
}

/**
 * 清除图标缓存（用于测试）
 */
export function clearIconCache(): void {
  iconCache.clear();
  iconCacheTimestamp.clear();
}
