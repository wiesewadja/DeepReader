import { describe, it, expect } from 'vitest';
import { splitSentences } from '../voice-pipeline';

describe('splitSentences', () => {
  it('splits on Chinese period', () => {
    expect(splitSentences('你好。世界。')).toEqual(['你好。', '世界。']);
  });

  it('splits on mixed punctuation', () => {
    expect(splitSentences('第一句。第二句！第三句？')).toEqual(['第一句。', '第二句！', '第三句？']);
  });

  it('handles English punctuation', () => {
    expect(splitSentences('Hello! How are you? Fine.')).toEqual(['Hello!', 'How are you?', 'Fine.']);
  });

  it('keeps trailing text without punctuation as last sentence', () => {
    expect(splitSentences('第一句。剩余部分')).toEqual(['第一句。', '剩余部分']);
  });

  it('returns empty array for empty string', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('returns single sentence for text without punctuation', () => {
    expect(splitSentences('无标点文本')).toEqual(['无标点文本']);
  });

  it('trims whitespace around sentences', () => {
    expect(splitSentences('  句子一。  句子二！ ')).toEqual(['句子一。', '句子二！']);
  });

  it('produces punctuation-only segments from consecutive punctuation', () => {
    expect(splitSentences('。。')).toEqual(['。', '。']);
  });

  it('handles Chinese exclamation and question marks', () => {
    expect(splitSentences('真的吗？是的！')).toEqual(['真的吗？', '是的！']);
  });
});
