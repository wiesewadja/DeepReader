import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ToolFactory } from './types.js';
import type { ToolContext } from '../types.js';
import {
  generateInfographic,
  INFOGRAPHIC_SIZES,
  DEFAULT_INFOGRAPHIC_SIZE,
} from '../../../services/infographic-generator.js';

const SIZE_VALUES = Object.values(INFOGRAPHIC_SIZES) as [string, ...string[]];

const generateInfographicSchema = z.object({
  detailed_description: z.string().max(4000, '描述过长，请精简到 4000 字以内').describe(
    '信息图的详细视觉描述，包括：主色调、风格、排版布局（从左到右/从上到下）、' +
    '各区块的详细文字内容、图标描述、装饰元素等。越详细效果越好。'
  ),
  size: z.enum(SIZE_VALUES)
    .optional()
    .default(DEFAULT_INFOGRAPHIC_SIZE)
    .describe(`图像尺寸，默认 ${DEFAULT_INFOGRAPHIC_SIZE} (16:9)`),
});

export const createGenerateInfographicTool: ToolFactory = (ctx: ToolContext) =>
    tool(
    async (args) => {
      const config = ctx.infographicConfig;
      if (!config?.apiKey) {
        return '错误：图片生成未配置。请在设置中配置 imagegen 角色或填写 SenseNova API Key。';
      }
      try {
        const result = await generateInfographic(config.apiKey, {
          prompt: args.detailed_description,
          size: args.size || DEFAULT_INFOGRAPHIC_SIZE,
          relativeDir: config.relativeDir,
          vaultAdapter: config.vaultAdapter,
          baseUrl: config.baseUrl,
          model: config.model,
        });
        return `已生成信息图：\n\n![信息图](${result.relativePath})`;
      } catch (err) {
        return `图片生成失败: ${err instanceof Error ? err.message : String(err)}`;
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
