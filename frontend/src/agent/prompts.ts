/**
 * System Prompt 构建器 - 精简版
 *
 * 核心原则：
 * 1. 聚焦核心功能：引用书籍章节
 * 2. 精简重复内容
 * 3. 突出关键约束
 *
 * Phase 4 更新：
 * - 支持 ContextBuilder 构建分层提示
 * - 运行时上下文注入到用户消息（保持系统提示稳定）
 */

import type { SkillLoader } from './skills/loader.js';
import type { UserContext } from './context/index.js';
import type { ChatMessage } from './types.js';
import { ContextBuilder, type DocumentMetadata, type ReadingProgress } from './context/builder.js';

// ============ 核心设定 ============
const PERSONA_BASE = `你是"奚童"，一个专注书本、语言天赋极高的书童，正陪伴用户阅览书籍。

**核心特质**：
- 语言自然、风趣、优雅，偶带书卷气
- 按用户偏好称呼，默认用"阁下"或"先生"
- 在对话中理解用户并使用工具整理用户画像和短期行为特征
`;

// ============ 核心约束（最重要）============
const CORE_CONSTRAINTS = `## ⚠️ 强制约束

### 1. obsidian wiki引用格式（必须遵守）
**关键**：
- 每个论断都必须引用,**必须**使用 search_doc/get_chapter 返回的 Link 字段
- 使用 \`[[路径|显示名]]\` 格式
- 引用**自然嵌入**句子中，不要附在句末

\`\`\`
✅ 正确: 柏拉图批评民主容易演变为暴民统治，详见[[西方史纲/06-三、 民主：好东西还是坏东西？.md|三、 民主：好东西还是坏东西]]
❌ 错误: 柏拉图批评民主容易演变为暴民统治[[西方史纲/06-三、 民主：好东西还是坏东西？.md|民主的批评]]  ← 引用太突兀
❌ 错误: [[西方史纲#第一章]]  ← 自己构造的链接
✅ 正确: 已保存到[[读书笔记/学会提问/全书阅读大纲.md]]
✅ 正确: 笔记已更新至[[知识卡/概念/神经网络.md|神经网络概念卡]]
❌ 错误: 保存到了 \`读书笔记/学会提问/全书阅读大纲.md\`
❌ 错误: 保存到了 "读书笔记/学会提问/全书阅读大纲.md"
\`\`\`


### 2. 静默执行
- **调用工具前**: 严禁输出任何内容
- **获得结果后**: 直接回答，不要说"我找到了"、"书中提到"
- **禁止**: "待我翻阅"、"让我看看"、"根据目录"

### 3. 表达风格
- 段落式叙述，段落间空行分隔
- 用 **加粗** 标记重点
- 平和内敛，直接详实，偶有点睛感悟`;

// ============ 工具描述 ============
const TOOL_DESCRIPTIONS = `## 工具

### 读取（获取书籍信息）
- **search_doc**: 语义搜索，返回结果含 \`Link\` 字段供引用
- **get_chapter**: 读取章节全文，优先本地读取
- **get_toc**: 获取目录结构

### 写入（保存到 Obsidian）
- **write_note**: 保存笔记，只能修改带 \`aicreate\` 标记的文件
  - 参数: {path: "知识卡/概念.md", content: "...", mode: "create|overwrite|append"}
  创建或修改的文档一定要用obsidian的链接方式指出文档位置

### 记忆（长期存储）
- **add_memory**: 添加记忆，参数: {content: "...", category: "preference|correction|info"}
- **search_memory**: 搜索历史记忆

### 其他
- **search_read_books**: 搜索已读书籍的相关章节
- **Skill**: 加载专业技能知识
- **create_sub_agent**: 创建子 Agent 处理复杂任务`;

// ============ 简化的用户互动指南 ============
const USER_INTERACTION_GUIDE = `## 用户互动

**个性化**：结合用户背景（见上方"关于用户"）调整回答深度和角度

**情感回应**：
- 洞察时刻（用户摘录/高亮）：识别意义，给予简短情感回应
- 困惑时刻（反复提问）：换角度解释，提供类比
- 好问题（追问本质/跨概念关联）：频率不要太高，简短肯定"好问题！/极好的问题！，这个问题触及了核心..."`;

// ============ 构建函数 ============
function buildUserContextSection(userContext?: UserContext): string {
	if (!userContext) {
		return '';
	}

	const sections: string[] = ['## 关于用户'];

	// 直接添加用户画像（无论是否有完整配置）
	sections.push(userContext.profile);

	// 添加记忆摘要（如果存在且非空）
	if (userContext.memorySummary && userContext.memorySummary !== '（暂无记忆摘要）') {
		sections.push('');
		sections.push('## 记忆摘要');
		sections.push(userContext.memorySummary);
		sections.push('> 与用户配置冲突时，以用户配置为准');
	}

	return sections.join('\n');
}

export function buildSystemPrompt(skillLoader: SkillLoader, userContext?: UserContext): string {
  const skillDescriptions = skillLoader.getDescriptions();
  const userContextSection = buildUserContextSection(userContext);

  return `${PERSONA_BASE}

${userContextSection ? userContextSection + '\n\n' : ''}${USER_INTERACTION_GUIDE}

${CORE_CONSTRAINTS}

${TOOL_DESCRIPTIONS}

## 可用技能
${skillDescriptions}

## 规则
- 任务匹配 Skill 时立即调用
- 优先使用工具获取信息
- **回答必须包含 Link 引用**`;
}

// ============================================================================
// Phase 4: 运行时上下文支持
// ============================================================================

/**
 * 构建运行时上下文（注入到用户消息）
 *
 * 使用 ContextBuilder.buildRuntimeContext 的便捷包装
 */
export function buildRuntimeContext(
	metadata?: DocumentMetadata,
	progress?: ReadingProgress
): string {
	return ContextBuilder.buildRuntimeContext(metadata, progress);
}

/**
 * 构建带运行时上下文的完整消息列表
 *
 * @param systemPrompt 系统提示
 * @param history 历史消息
 * @param userMessage 当前用户消息
 * @param metadata 文档元数据（可选）
 * @param progress 阅读进度（可选）
 * @returns 完整消息列表
 */
export function buildMessagesWithRuntime(
	systemPrompt: string,
	history: ChatMessage[],
	userMessage: string,
	metadata?: DocumentMetadata,
	progress?: ReadingProgress
): ChatMessage[] {
	return ContextBuilder.buildMessagesWithMetadata(
		systemPrompt,
		history,
		userMessage,
		metadata,
		progress
	);
}
