import { TFile } from 'obsidian';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';
import { generateInfographic } from '../../../services/infographic-generator.js';

const generateInfographicSchema = z.object({
  detailed_description: z.string().describe(
    '信息图的详细视觉描述，包括：主色调、风格、排版布局（从左到右/从上到下）、' +
    '各区块的详细文字内容、图标描述、装饰元素等。越详细效果越好。'
  ),
  size: z.enum(['1664x2496', '2496x1664', '1760x2368', '2368x1760', '1824x2272', '2272x1824', '2048x2048', '2752x1536', '1536x2752', '3072x1376', '1344x3136'])
    .optional()
    .default('2752x1536')
    .describe('图像尺寸，默认 2752x1536 (16:9)'),
});

export const createGenerateInfographicTool: ToolFactory = (ctx: ToolContext) =>
  tool(
    async (args) => {
      const infographicConfig = ctx.infographicConfig as
        { apiKey: string; outputDir: string } | undefined;
      if (!infographicConfig || !infographicConfig.apiKey) {
        return '错误：信息图生成未配置。请在设置中填写 SenseNova API Key。';
      }
      try {
        const result = await generateInfographic(infographicConfig.apiKey, {
          prompt: args.detailed_description,
          size: args.size || '2752x1536',
          outputDir: infographicConfig.outputDir,
        });
        const app = ctx.app;
        let imageUrl = result.relativePath;
        if (app) {
          const file = app.vault.getAbstractFileByPath(result.relativePath);
          if (file instanceof TFile) {
            imageUrl = app.vault.getResourcePath(file);
          }
        }
        return `信息图已生成！\n\n![信息图](${imageUrl})`;
      } catch (err) {
        return `信息图生成失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: 'generate_infographic',
      description: `生成专业信息图（Infographic）。生成后请将返回的 Markdown 图片引用 \`![信息图](url)\` 原样包含在你的回答中。
【使用场景】对比、流程、时间线、数据可视化等适合图表呈现的内容。
【prompt 编写技巧】详细描述配色方案、排版布局、各区块文字内容、图标风格等。
【尺寸】默认 16:9，支持 2:3 / 3:2 / 3:4 / 4:3 / 4:5 / 5:4 / 1:1 / 16:9 / 9:16 / 21:9 / 9:21`,
      schema: generateInfographicSchema,
    },
  );
