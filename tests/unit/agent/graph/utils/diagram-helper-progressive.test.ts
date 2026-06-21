/**
 * 渐进式分节生成单元测试
 *
 * 覆盖 B1（planDiagramSections）/ B2（generateSection）/ B3（generateDiagramProgressive）。
 * mock model.invoke，不依赖外部 API。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  planDiagramSections,
  generateSection,
  generateDiagramProgressive,
  sanitizeFilename,
} from '@/agent/graph/utils/diagram-helper';
import type { DiagramSectionPlan } from '@/agent/graph/utils/diagram-helper';

/** 造一个 mock model，invoke 返回预设 content */
function makeMockModel(invokeReturn: string | (() => string)) {
  return {
    invoke: vi.fn().mockImplementation(() => {
      const content = typeof invokeReturn === 'function' ? invokeReturn() : invokeReturn;
      return Promise.resolve({ content });
    }),
  };
}

function makeMockToolContext(): any {
  const adapter = {
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return {
    vault: { app: { vault: { adapter } }, plugin: {} },
    book: {},
  };
}

const validPlanJson = JSON.stringify({
  filename: '自卑与超越核心概念',
  sections: [
    { title: '中心主题', content: '阿德勒个体心理学核心', yBand: [280, 420] },
    { title: '动力系统', content: '自卑→补偿→优越感', connectsTo: ['中心主题'], yBand: [80, 240] },
    { title: '人格系统', content: '生活风格与社会兴趣', connectsTo: ['中心主题'], yBand: [460, 620] },
  ],
});

describe('sanitizeFilename', () => {
  it('去掉书名号《》', () => {
    expect(sanitizeFilename('《自卑与超越》核心概念')).toBe('自卑与超越核心概念');
  });

  it('去掉引号、括号、方括号', () => {
    expect(sanitizeFilename('"测试"图（草稿）[v1]')).toBe('测试图草稿v1');
  });

  it('去掉斜杠、冒号等路径字符', () => {
    expect(sanitizeFilename('a/b:c')).toBe('abc');
  });

  it('折叠多空格', () => {
    expect(sanitizeFilename('思维   导图')).toBe('思维 导图');
  });

  it('合法 filename 原样返回', () => {
    expect(sanitizeFilename('自卑与超越核心概念')).toBe('自卑与超越核心概念');
    expect(sanitizeFilename('test-diagram_1')).toBe('test-diagram_1');
  });

  it('清洗后为空 → 返回 null', () => {
    expect(sanitizeFilename('《》""')).toBeNull();
    expect(sanitizeFilename('   ')).toBeNull();
  });

  it('非字符串 → null', () => {
    expect(sanitizeFilename(null as any)).toBeNull();
    expect(sanitizeFilename(undefined as any)).toBeNull();
  });

  it('plan 阶段：LLM 返回带书名号 filename → 清洗后正常解析', async () => {
    const model = makeMockModel(JSON.stringify({
      filename: '《自卑与超越》核心概念',
      sections: [{ title: '节1', content: 'c', yBand: [1, 2] }],
    }));
    const plan = await planDiagramSections('画图', '内容', model as any);
    expect(plan).not.toBeNull();
    expect(plan!.filename).toMatch(/^自卑与超越核心概念/); // 书名号已清洗
  });
});

describe('planDiagramSections (B1)', () => {
  it('合法大纲 JSON → 正确解析为 DiagramPlan', async () => {
    const model = makeMockModel(validPlanJson);
    const plan = await planDiagramSections('画思维导图', '分析内容...', model as any);
    expect(plan).not.toBeNull();
    expect(plan!.filename).toMatch(/^自卑与超越核心概念/);
    expect(plan!.sections).toHaveLength(3);
    expect(plan!.sections[0].title).toBe('中心主题');
    expect(plan!.sections[1].connectsTo).toEqual(['中心主题']);
    expect(plan!.sections[1].yBand).toEqual([80, 240]);
  });

  it('非 JSON 文本 → 返回 null', async () => {
    const model = makeMockModel('这不是 JSON');
    const plan = await planDiagramSections('画图', '内容', model as any);
    expect(plan).toBeNull();
  });

  it('缺少 filename → 返回 null', async () => {
    const model = makeMockModel(JSON.stringify({ sections: [{ title: 'a', content: 'b', yBand: [1, 2] }] }));
    const plan = await planDiagramSections('画图', '内容', model as any);
    expect(plan).toBeNull();
  });

  it('空 sections → 返回 null', async () => {
    const model = makeMockModel(JSON.stringify({ filename: 'ok', sections: [] }));
    const plan = await planDiagramSections('画图', '内容', model as any);
    expect(plan).toBeNull();
  });

  it('非法 filename（含斜杠）→ 清洗后合法则保留，清洗后仍非法才返回 null', async () => {
    // bad/name 清洗成 badname（合法）
    const model1 = makeMockModel(JSON.stringify({ filename: 'bad/name', sections: [{ title: 'a', content: 'b', yBand: [1, 2] }] }));
    const plan1 = await planDiagramSections('画图', '内容', model1 as any);
    expect(plan1).not.toBeNull();
    expect(plan1!.filename).toMatch(/^badname/);

    // 纯符号 清洗后为空 → null
    const model2 = makeMockModel(JSON.stringify({ filename: '《》""', sections: [{ title: 'a', content: 'b', yBand: [1, 2] }] }));
    const plan2 = await planDiagramSections('画图', '内容', model2 as any);
    expect(plan2).toBeNull();
  });

  it('超过 MAX_SECTIONS (5) 节 → 裁剪到 5 节', async () => {
    const sections = Array.from({ length: 8 }, (_, i) => ({
      title: `节${i + 1}`, content: `内容${i + 1}`, yBand: [i * 100, i * 100 + 80],
    }));
    const model = makeMockModel(JSON.stringify({ filename: 'ok', sections }));
    const plan = await planDiagramSections('画图', '内容', model as any);
    expect(plan!.sections).toHaveLength(5);
  });

  it('节字段不完整（缺 yBand）→ 跳过该节，保留有效节', async () => {
    const model = makeMockModel(JSON.stringify({
      filename: 'ok',
      sections: [
        { title: '完整节', content: 'c', yBand: [1, 2] },
        { title: '缺yBand', content: 'c' }, // 无效，跳过
      ],
    }));
    const plan = await planDiagramSections('画图', '内容', model as any);
    expect(plan!.sections).toHaveLength(1);
    expect(plan!.sections[0].title).toBe('完整节');
  });

  it('透传 signal 给 invoke', async () => {
    const model = makeMockModel(validPlanJson);
    const controller = new AbortController();
    await planDiagramSections('画图', '内容', model as any, { signal: controller.signal });
    expect(model.invoke).toHaveBeenCalledWith(
      expect.any(Array),
      { signal: controller.signal },
    );
  });

  it('invoke 抛错 → 返回 null（不抛出）', async () => {
    const model = { invoke: vi.fn().mockRejectedValue(new Error('network')) };
    const plan = await planDiagramSections('画图', '内容', model as any);
    expect(plan).toBeNull();
  });
});

describe('generateSection (B2)', () => {
  const sampleSection: DiagramSectionPlan = {
    title: '中心主题',
    content: '阿德勒个体心理学',
    yBand: [280, 420],
  };

  const validSectionJson = JSON.stringify({
    elements: [
      { id: 'sec1_center', type: 'ellipse', x: 400, y: 300, width: 320, height: 160, text: '核心', strokeColor: '#1e3a5f', backgroundColor: '#e8f0fe' },
      { id: 'sec1_label', type: 'text', x: 100, y: 290, width: 200, height: 30, text: '标题', fontSize: 24, strokeColor: '#1e3a5f' },
    ],
  });

  it('合法 elements JSON → 返回 ElementDef[]', async () => {
    const model = makeMockModel(validSectionJson);
    const els = await generateSection(sampleSection, 1, [], model as any);
    expect(els).toHaveLength(2);
    expect(els[0].type).toBe('ellipse');
    expect(els[1].type).toBe('text');
  });

  it('非 JSON → 返回空数组', async () => {
    const model = makeMockModel('not json');
    const els = await generateSection(sampleSection, 1, [], model as any);
    expect(els).toEqual([]);
  });

  it('空 elements 数组 → 返回空数组', async () => {
    const model = makeMockModel(JSON.stringify({ elements: [] }));
    const els = await generateSection(sampleSection, 1, [], model as any);
    expect(els).toEqual([]);
  });

  it('缺 elements 字段 → 返回空数组', async () => {
    const model = makeMockModel(JSON.stringify({ foo: 'bar' }));
    const els = await generateSection(sampleSection, 1, [], model as any);
    expect(els).toEqual([]);
  });

  it('元素缺 type 字段 → 跳过该元素，保留有效元素', async () => {
    const model = makeMockModel(JSON.stringify({
      elements: [
        { id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 },
        { id: 'b', x: 0, y: 0 }, // 无 type，跳过
        { id: 'c', type: 'text', x: 0, y: 0, width: 100, height: 30, text: 't' },
      ],
    }));
    const els = await generateSection(sampleSection, 1, [], model as any);
    expect(els).toHaveLength(2);
  });

  it('第二节传入 existingIds（跨节上下文）→ 正常生成', async () => {
    const model = makeMockModel(validSectionJson);
    const els = await generateSection(sampleSection, 2, ['sec1_center'], model as any);
    expect(els).toHaveLength(2);
    // invoke 被调用（existingIds 注入了 prompt）
    expect(model.invoke).toHaveBeenCalled();
  });

  it('透传 signal', async () => {
    const model = makeMockModel(validSectionJson);
    const controller = new AbortController();
    await generateSection(sampleSection, 1, [], model as any, { signal: controller.signal });
    expect(model.invoke).toHaveBeenCalledWith(expect.any(Array), { signal: controller.signal });
  });

  it('invoke 抛错 → 返回空数组（不抛出）', async () => {
    const model = { invoke: vi.fn().mockRejectedValue(new Error('timeout')) };
    const els = await generateSection(sampleSection, 1, [], model as any);
    expect(els).toEqual([]);
  });
});

describe('generateDiagramProgressive (B3)', () => {
  // B3 测试编排逻辑：用真实 plan/generateSection（已分别由 B1/B2 测过），
  // 通过 mock model.invoke 按调用顺序返回不同内容（先 plan JSON，再各节 elements JSON）。
  // 这样能端到端验证累积、回调、fallback、abort 等编排行为。

  function makePlanResponse() {
    return JSON.stringify({
      filename: '测试图',
      sections: [
        { title: '节1', content: 'c1', yBand: [280, 420] },
        { title: '节2', content: 'c2', connectsTo: ['节1'], yBand: [80, 240] },
        { title: '节3', content: 'c3', connectsTo: ['节1'], yBand: [460, 620] },
      ],
    });
  }

  function makeSectionResponse(idx: number) {
    return JSON.stringify({
      elements: [
        { id: `sec${idx}_n1`, type: 'rectangle', x: 0, y: 0, width: 100, height: 50, text: `节${idx}` },
      ],
    });
  }

  function makeEl(id: string) {
    return { id, type: 'rectangle', x: 0, y: 0, width: 100, height: 50 };
  }

  /** 造一个按顺序返回不同内容的 mock model */
  function makeSequenceModel(responses: (string | Error)[]) {
    let i = 0;
    return {
      invoke: vi.fn().mockImplementation(() => {
        const r = responses[i++];
        if (r instanceof Error) return Promise.reject(r);
        return Promise.resolve({ content: r });
      }),
    };
  }

  it('3 节正常流程：累积所有元素，onSectionReady 触发 3 次，返回 .excalidraw.md', async () => {
    const ctx = makeMockToolContext();
    // 1 次 plan + 3 次 section
    const model = makeSequenceModel([
      makePlanResponse(),
      makeSectionResponse(1), makeSectionResponse(2), makeSectionResponse(3),
    ]);
    const onSectionReady = vi.fn();

    const embed = await generateDiagramProgressive('画图', '内容', model as any, ctx, {}, { onSectionReady });

    expect(onSectionReady).toHaveBeenCalledTimes(3);
    expect(embed).toContain('![[Excalidraw/测试图-');
    expect(embed).toContain('.excalidraw.md]]');
    // onSectionReady 的 embed 是 .excalidraw（中间态）
    expect(onSectionReady.mock.calls[0][0]).toContain('![[Excalidraw/测试图-');
    // sectionIndex 递增 1,2,3
    expect(onSectionReady.mock.calls.map((c: any) => c[1])).toEqual([1, 2, 3]);
  });

  it('每节落盘 .excalidraw（累积），收尾写 .excalidraw.md', async () => {
    const ctx = makeMockToolContext();
    const model = makeSequenceModel([
      makePlanResponse(), makeSectionResponse(1), makeSectionResponse(2), makeSectionResponse(3),
    ]);

    await generateDiagramProgressive('画图', '内容', model as any, ctx, {}, {});

    const writes = (ctx.vault.app.vault.adapter.write as any).mock.calls;
    // 3 次中间态 .excalidraw + 1 次收尾 .excalidraw.md = 4 次
    expect(writes.length).toBe(4);
    expect(writes[0][0]).toContain('Excalidraw/测试图-');
    expect(writes[3][0]).toContain('Excalidraw/测试图-');
    expect(writes[3][0]).toContain('.excalidraw.md');
  });

  it('收尾后删除中间 .excalidraw 文件', async () => {
    const ctx = makeMockToolContext();
    const model = makeSequenceModel([
      makePlanResponse(), makeSectionResponse(1), makeSectionResponse(2), makeSectionResponse(3),
    ]);

    await generateDiagramProgressive('画图', '内容', model as any, ctx, {}, {});

    expect(ctx.vault.app.vault.adapter.remove).toHaveBeenCalledWith(expect.stringMatching(/Excalidraw\/测试图-\d+\.excalidraw$/));
  });

  it('单节首次失败 + 重试成功 → 最终包含该节', async () => {
    const ctx = makeMockToolContext();
    // 节1 正常 → 节2 第一次返回非JSON（失败）→ 节2 重试成功 → 节3 正常
    const model = makeSequenceModel([
      makePlanResponse(),
      makeSectionResponse(1),
      'INVALID', // 节2 第一次失败
      makeSectionResponse(2), // 节2 重试成功
      makeSectionResponse(3),
    ]);
    const onSectionReady = vi.fn();
    const onSectionFailed = vi.fn();

    await generateDiagramProgressive('画图', '内容', model as any, ctx, {}, { onSectionReady, onSectionFailed });

    expect(onSectionReady).toHaveBeenCalledTimes(3);
    expect(onSectionFailed).not.toHaveBeenCalled();
  });

  it('单节重试仍失败 → 跳过该节，继续后续节', async () => {
    const ctx = makeMockToolContext();
    // 节1 正常 → 节2 两次都失败 → 节3 正常
    const model = makeSequenceModel([
      makePlanResponse(),
      makeSectionResponse(1),
      'INVALID', 'INVALID', // 节2 重试耗尽
      makeSectionResponse(3),
    ]);
    const onSectionReady = vi.fn();
    const onSectionFailed = vi.fn();

    const embed = await generateDiagramProgressive('画图', '内容', model as any, ctx, {}, { onSectionReady, onSectionFailed });

    // 节2 跳过，节1/节3 成功 → onSectionReady 2 次
    expect(onSectionReady).toHaveBeenCalledTimes(2);
    expect(onSectionFailed).toHaveBeenCalledWith(2, expect.any(String));
    expect(embed).toContain('![[Excalidraw/测试图-');
    expect(embed).toContain('.excalidraw.md]]');
  });

  it('所有节失败 → 返回空串', async () => {
    const ctx = makeMockToolContext();
    const model = makeSequenceModel([
      makePlanResponse(),
      'INVALID', 'INVALID', // 节1 失败
      'INVALID', 'INVALID', // 节2 失败
      'INVALID', 'INVALID', // 节3 失败
    ]);
    const onSectionReady = vi.fn();

    const embed = await generateDiagramProgressive('画图', '内容', model as any, ctx, {}, { onSectionReady });

    expect(embed).toBe('');
    expect(onSectionReady).not.toHaveBeenCalled();
  });

  it('大纲解析失败 → fallback 到单次 generateDiagram', async () => {
    const ctx = makeMockToolContext();
    // plan 返回非法 → fallback 走 generateDiagram，再 1 次 invoke 返回单次结果
    const model = makeSequenceModel([
      'NOT_A_PLAN', // plan 失败
      JSON.stringify({ filename: 'fallback', elements: [makeEl('fb1')] }), // generateDiagram 的 invoke
    ]);

    const embed = await generateDiagramProgressive('画图', '内容', model as any, ctx, {}, {});

    // fallback 走单次生成，写 .excalidraw.md
    expect(embed).toContain('![[Excalidraw/fallback-');
    expect(embed).toContain('.excalidraw.md]]');
  });

  it('abort 中断 → 停止后续节，返回中间态 .excalidraw embed', async () => {
    const ctx = makeMockToolContext();
    const controller = new AbortController();
    let invokeCount = 0;
    const model = {
      invoke: vi.fn().mockImplementation(() => {
        invokeCount++;
        // plan(1) + 节1(2) 正常 + 节2(3) invoke 时同步 abort
        // 节1 已成功累积，节2 被中断
        if (invokeCount === 3) {
          controller.abort();
        }
        return Promise.resolve({
          content: invokeCount === 1
            ? makePlanResponse()
            : makeSectionResponse(invokeCount - 1),
        });
      }),
    };

    const embed = await generateDiagramProgressive('画图', '内容', model as any, ctx, { signal: controller.signal }, {});

    // 节1 成功累积，节2 invoke 时 abort → 节2 结果被丢弃，不进节3
    expect(invokeCount).toBeLessThanOrEqual(3);
    // 节1 已累积（cumulative 非空），abort 分支返回中间态 .excalidraw embed
    expect(embed).toContain('![[Excalidraw/测试图-');
    expect(embed).toContain('.excalidraw]]');
  });
});
