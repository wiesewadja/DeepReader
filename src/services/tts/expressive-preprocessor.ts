import type { BookGenre } from './book-genre-detector.js';

export interface ExpressiveTextOptions {
  /** 书籍类型（用于确定全局基调） */
  genre?: BookGenre;
  /** 是否启用情感标记 */
  enableMarks?: boolean;
  /** 标记粒度：paragraph(段落) / sentence(句子) */
  granularity?: 'paragraph' | 'sentence';
}

/**
 * 朗读文本预处理器
 *
 * V2.5 策略：用规则引擎替代 LLM 调用
 * - 不调用 LLM（避免延迟 2-5 秒 + 篡改原文）
 * - 用规则为文本添加音频标签（零延迟）
 * - 结合 user message 的风格描述（让模型理解上下文）
 *
 * 音频标签格式（V2.5 支持）：
 * - (style) → 放在段落开头，控制整体风格
 * - [tag] → 放在段落中间，控制细粒度语气
 */
export class ExpressivePreprocessor {
  /**
   * 为文本添加朗读音频标签
   *
   * 只做 Markdown 清洗 + 规则标记，不调用 LLM
   */
  async preprocess(text: string, options?: ExpressiveTextOptions): Promise<string> {
    // Markdown 清洗始终执行（去掉 **、#、> 等）
    const cleanText = this.cleanMarkdown(text);

    if (!options?.enableMarks) return cleanText;

    // 基于规则添加音频标签（V2.5 的 (style) 标签）
    return this.addRuleBasedMarks(cleanText);
  }

  /**
   * Markdown → 纯文本（TTS 朗读友好）
   */
  private cleanMarkdown(markdown: string): string {
    let text = markdown;

    // 1. 去掉加粗标记，保留内容
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    // 2. 去掉斜体标记
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
    // 3. 标题 → 口语化引导（h1 ~ h6）
    text = text.replace(/^#{1,3}\s+(.+)$/gm, '下面进入$1。');
    text = text.replace(/^#{4,6}\s+(.+)$/gm, '接下来是$1。');
    // 4. 列表项 → 口语序列
    let listCounter = 0;
    text = text.replace(
      /^[-•*]\s+\*\*([^*]+)\*\*\s*[:：]\s*(.+)$/gm,
      () => {
        listCounter++;
        const ordinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
        const idx = Math.min(listCounter - 1, ordinals.length - 1);
        return `第${ordinals[idx]}，$1。$2`;
      }
    );
    text = text.replace(/^[-•*]\s+(.+)$/gm, '接下来，$1');
    // 5. 数字列表
    const numOrdinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    text = text.replace(/^(\d+)\.\s+(.+)$/gm, (_m, num, content) => {
      const idx = Math.min(parseInt(num, 10) - 1, numOrdinals.length - 1);
      return `第${numOrdinals[idx]}，${content}`;
    });
    // 6. 引用 → 金句强调
    text = text.replace(/^>\s*(.+)$/gm, '这里有一句话值得深思：$1');
    text = text.replace(/^>\s*$/gm, '');
    // 7. 分隔线
    text = text.replace(/^[-*]{3,}$/gm, '');

    // 8. 中文间空格归一化（防止 TTS 断词错误）
    //    "等 得到" → "等得到"，"中 文" → "中文"
    text = text.replace(/([一-鿿])\s+(?=[一-鿿])/g, '$1');

    // 9. 阿拉伯数字 → 中文（在中文语境下）
    text = this.normalizeNumbers(text);

    // 10. 口语化停顿（长句插逗号，过渡词前加省略号）
    text = this.addNaturalPauses(text);

    // 11. 精简空行
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();

    return text;
  }

  /**
   * 阿拉伯数字转中文（仅处理中文语境下的常见模式）
   *
   * 处理规则：
   * - 四位数年份：2024年 → 二零二四年
   * - 数字+中文量词：10年前 → 十年前，100个人 → 一百个人
   * - 第N：第1次 → 第一次
   */
  private normalizeNumbers(text: string): string {
    // 1. 四位数年份：逐位朗读
    text = text.replace(/(\d{4})年/g, (_, d) =>
      [...d].map(c => '零一二三四五六七八九'[+c]).join('') + '年'
    );

    // 2. 数字 + 中文量词：整体朗读
    const measures = '个只条本书页章节段落部分次集期天月日时分钟秒人位套件门场座栋层间台辆艘架匹朵棵株粒颗片幅首部曲篇封张步轮趟遍倍万亿美元角块毛分';
    text = text.replace(new RegExp(`(\\d+)([${measures}])`, 'g'), (_, n, u) =>
      numberToChinese(+n) + u
    );

    // 3. 第N：序数词
    text = text.replace(/第(\d+)/g, (_, n) => '第' + numberToChinese(+n));

    return text;
  }

  /**
   * 为朗读添加自然停顿
   *
   * 只加标点，不改词：
   * 1. 长句在连词前插逗号（并且/而且/以及 等是天然分句点）
   * 2. 过渡词前加省略号（让 TTS 停一拍再转折）
   * 3. 缺句号的行尾补句号
   */
  private addNaturalPauses(text: string): string {
    // 1. 长句在连词前插逗号（连词是新子句的起点，断开安全）
    text = text.replace(
      /([^。，！？；：，\n]{12,})(并且|而且|以及|或者|还是|不过|然而|而是|同时|从而|进而)/g,
      '$1，$2'
    );

    // 2. 过渡词前加省略号（…… 表示停顿，给 TTS 明确的语气转折信号）
    text = text.replace(
      /([。！？])(因此|所以|但是|然而|不过|而且|此外|同时|另外|总之|总的来说|也就是说|换句话说|事实上|实际上|需要注意的是|重要的是|关键在于)/g,
      '$1……$2'
    );

    // 3. 缺句号的行尾补句号（中文行，且不以标点结尾）
    text = text.replace(/([一-鿿）」』"])([ \t]*)$/gm, '$1。$2');

    return text;
  }

  /**
   * 基于规则添加音频标签（零延迟）
   *
   * 策略：
   * - 检测段落类型 → 添加对应的风格标签
   * - 标签使用 V2.5 支持的格式：(style) 和 [tag]
   * - 不修改原文内容，只在段落前添加标签
   */
  private addRuleBasedMarks(text: string): string {
    const paragraphs = text.split('\n\n');
    const result: string[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].trim();
      if (!para) continue;

      let mark = '';

      // 第一段：问候语
      if (i === 0 && /^(\S{1,4}先生|女士|你好|您好|大家好|各位)/.test(para)) {
        mark = '(亲切)';
      }
      // 过渡句："下面进入..."、"接下来是..."
      else if (/^(下面进入|接下来是|我们来看|下面讲|下面来聊)/.test(para)) {
        mark = '(清晰)';
      }
      // 引用/金句："这里有一句话值得深思"
      else if (/^(这里有一句话值得深思|正如.*所说|古人云|俗话说)/.test(para)) {
        mark = '(深沉)';
      }
      // 列表项："第一..."、"接下来..."
      else if (/^(第[一二三四五六七八九十]|接下来|首先|其次|最后)/.test(para)) {
        mark = '(轻快)';
      }
      // 核心概念："核心原理"、"关键在于"、"本质"
      else if (/核心原理|根本方法|关键在于|本质|最重要的是|核心论点/.test(para)) {
        mark = '(加重)';
      }
      // 结尾收束
      else if (i === paragraphs.length - 1 && /(若您想|如有疑问|欢迎|我可以继续)/.test(para)) {
        mark = '(温和)';
      }
      // 默认：自然语调
      else {
        mark = '(自然)';
      }

      result.push(`${mark}${para}`);
    }

    return result.join('\n\n');
  }
}

/**
 * 阿拉伯数字 → 中文数字（0 ~ 99999）
 * 超出范围或负数原样返回
 */
function numberToChinese(n: number): string {
  if (n < 0 || !Number.isInteger(n) || n > 99999) return String(n);
  if (n === 0) return '零';

  const d = '零一二三四五六七八九';
  const r: string[] = [];

  if (n >= 10000) {
    r.push(d[Math.floor(n / 10000)] + '万');
    n %= 10000;
    if (n > 0 && n < 1000) r.push('零');
  }
  if (n >= 1000) {
    r.push(d[Math.floor(n / 1000)] + '千');
    n %= 1000;
    if (n > 0 && n < 100) r.push('零');
  }
  if (n >= 100) {
    r.push(d[Math.floor(n / 100)] + '百');
    n %= 100;
    if (n > 0 && n < 10) r.push('零');
  }
  if (n >= 10) {
    const tens = Math.floor(n / 10);
    // 10~19: 只说"十X"，不说"一十X"
    if (r.length === 0 && tens === 1) {
      r.push('十');
    } else {
      r.push(d[tens] + '十');
    }
    n %= 10;
  }
  if (n > 0) {
    r.push(d[n]);
  }

  return r.join('');
}
