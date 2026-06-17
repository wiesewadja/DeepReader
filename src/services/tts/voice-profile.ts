import type { BookGenre } from './book-genre-detector.js';

export interface VoiceProfile {
  /** 音色 ID（Xiaomi: 冰糖/茉莉/苏打/白桦; MiniMax: voice_id）；VoiceDesign 模式下为空 */
  voice: string;
  /**
   * V2.5 音频风格标签（仅 Xiaomi），放在 assistant content 最前面
   * 格式：(风格1 风格2 风格3)
   * 控制整体朗读的音色、情感和节奏
   */
  audioTag: string;
  /** 语速描述（嵌入导演模式「指导」部分） */
  speedHint: string;
  /** 情感基调描述（嵌入导演模式「指导」部分） */
  moodHint: string;
  /** TTS 提供商，用于区分 voice 字段解释方式 */
  provider?: string;
  /** VoiceDesign 音色描述文本；仅 VoiceDesign 模式下存在 */
  voiceDesignPrompt?: string;
}

/** VoiceDesign 默认音色描述：奚童 - 活泼书伴 */
export const DEFAULT_VOICE_DESIGN_PROMPT =
  // 性别与年龄：年轻女性
  '一位二十岁左右的年轻女性，' +
  // 音色/质感：清亮、柔和、有书卷气
  '声音清亮柔和，带着书卷气和少女的灵动，' +
  // 情绪/语气：温暖、亲切、有活力
  '语气温暖亲切，带着微微的笑意，像在和好朋友分享读书心得，' +
  // 语速/节奏：中等偏快、清晰利落
  '语速中等偏快，咬字清晰利落，' +
  // 角色/人设：聪明伶俐的小师妹、伴读书童
  '像一位聪明伶俐的小师妹，是用户的伴读书童。' +
  '场景：安静午后，好书共度' +
  // 说话风格：自然、口语化、拉近距离
  '说话自然口语化，偶尔会说"你看呀""你说是不是""你想想"这样拉近距离的话。';

/**
 * 根据书籍情感基调生成全局音频标签
 *
 * V2.5 音频标签格式：(风格1 风格2 风格格3)
 * 放在 assistant content 最前面，控制整体朗读风格
 *
 * 奚童的音色基调：年轻女性 / 清亮 / 书卷气
 * 根据书籍 mood 调整情感和节奏维度
 */
function resolveAudioTag(mood: string): string {
  const tags: Record<string, string> = {
    warm: '(温暖 活泼 书卷气)',
    serious: '(沉稳 清晰 书卷气)',
    melancholy: '(轻柔 忧伤 书卷气)',
    lively: '(清亮 活泼 灵动)',
    mysterious: '(低沉 神秘 书卷气)',
    epic: '(大气 雄浑 书卷气)',
    intimate: '(温柔 轻柔 书卷气)',
    reflective: '(平和 深沉 书卷气)',
    neutral: '(清亮 自然 书卷气)',
  };
  return tags[mood] || '(清亮 自然 书卷气)';
}

function resolveSpeedHint(mood: string): string {
  const hints: Record<string, string> = {
    warm: '语速中等偏快，娓娓道来。',
    serious: '语速中等，沉稳有力。',
    melancholy: '语速缓慢，略带忧伤的停顿。',
    lively: '语速中等偏快，轻快活泼。',
    mysterious: '语速缓慢，营造悬疑感。',
    epic: '语速中等偏慢，大气磅礴。',
    intimate: '语速缓慢，轻声细语。',
    reflective: '语速中等偏慢，给人思考空间。',
    neutral: '语速中等偏快，清晰自然。',
  };
  return hints[mood] || '语速中等偏快，清晰自然。';
}

function resolveMoodHint(mood: string): string {
  const hints: Record<string, string> = {
    warm: '整体语调温暖亲切，像和朋友分享读书心得。',
    serious: '整体语调严谨认真，像在讲一堂重要的课。',
    melancholy: '整体语调略带感伤，像在诉说一段往事。',
    lively: '整体语调活泼轻快，充满好奇心和热情。',
    mysterious: '整体语调低沉神秘，像是在揭示一个秘密。',
    epic: '整体语调大气磅礴，像是在讲述一段传奇。',
    intimate: '整体语调亲密柔和，像是在耳边轻声细语。',
    reflective: '整体语调平静深沉，像是在独自思索。',
    neutral: '整体语调自然平和，不疾不徐。',
  };
  return hints[mood] || '整体语调自然平和。';
}

const XIAOMI_DEFAULT_VOICE = '冰糖';
const MINIMAX_DEFAULT_VOICE_ID = 'female-tianmei';

/**
 * 根据书籍类型生成最佳音色配置
 *
 * V2.5 策略：固定使用 冰糖（中文年轻女声），通过音频标签和导演模式控制风格
 * MiniMax 策略：使用系统音色 female-shensi-ziran，后续可通过 Voice Design API 设计专属音色
 *
 * 风格控制：
 *   - 音频标签 (audioTag)：放在 assistant content 前面，控制音色/情感/节奏（仅 Xiaomi）
 *   - 导演模式 (styleText)：放在 user message，定义角色/场景/指导
 */
export function resolveVoiceProfile(genre: BookGenre, provider?: string, isVoiceDesign?: boolean): VoiceProfile {
  const mood = genre.mood || 'neutral';
  const isMinimax = provider === 'minimax';
  const base = {
    audioTag: isMinimax ? '' : resolveAudioTag(mood),
    speedHint: resolveSpeedHint(mood),
    moodHint: resolveMoodHint(mood),
    provider,
  };
  if (isVoiceDesign && !isMinimax) {
    return { ...base, voice: '', voiceDesignPrompt: DEFAULT_VOICE_DESIGN_PROMPT };
  }
  return { ...base, voice: isMinimax ? MINIMAX_DEFAULT_VOICE_ID : XIAOMI_DEFAULT_VOICE };
}

export function getDefaultVoiceProfile(provider?: string, isVoiceDesign?: boolean): VoiceProfile {
  const isMinimax = provider === 'minimax';
  const base = {
    audioTag: isMinimax ? '' : '(清亮 活泼 书卷气)',
    speedHint: '语速中等偏快，清晰自然。',
    moodHint: '整体语调自然平和，不疾不徐。',
    provider,
  };
  if (isVoiceDesign && !isMinimax) {
    return { ...base, voice: '', voiceDesignPrompt: DEFAULT_VOICE_DESIGN_PROMPT };
  }
  return { ...base, voice: isMinimax ? MINIMAX_DEFAULT_VOICE_ID : XIAOMI_DEFAULT_VOICE };
}
