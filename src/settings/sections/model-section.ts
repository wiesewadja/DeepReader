/**
 * 模型配置 Tab — 角色分配
 */

import type { SectionContext } from '../types';
import type { RoleType } from '../../config/types';
import { createRoleCard } from '../components/role-card';

const PROPOSITION_ENABLED = false;

export function renderModelSection(
  container: HTMLElement,
  ctx: SectionContext,
  expandedSections: Set<string>,
  onRerender: () => void,
): void {
  container.createEl('h3', { text: '模型配置' });
  container.createEl('p', {
    text: '为每种用途选择服务商和模型。需要先在「AI 服务」Tab 中配置好 API Key。',
    cls: 'setting-item-description',
  });

  // Core roles default to expanded
  for (const id of ['role-chat', 'role-router', 'role-pageindex']) {
    if (!expandedSections.has(id)) expandedSections.add(id);
  }

  const roleCtx = {
    plugin: ctx.plugin,
    expandedSections,
    onToggle: (sectionId: string) => {
      if (expandedSections.has(sectionId)) {
        expandedSections.delete(sectionId);
      } else {
        expandedSections.add(sectionId);
      }
      onRerender();
    },
    onRerender,
  };

  // 核心服务
  const coreCard = container.createDiv({ cls: 'deeppdf-settings-card' });
  coreCard.createEl('h4', { text: '核心服务' });
  const requiredRoles: { role: RoleType; label: string; desc: string }[] = [
    { role: 'chat', label: '主对话', desc: '用于主要对话和分析' },
    { role: 'router', label: '路由', desc: '用于查询路由和快速检索' },
    { role: 'pageindex', label: '页面索引', desc: '用于书籍索引时的 LLM 调用' },
  ];
  for (const { role, label, desc } of requiredRoles) {
    createRoleCard(coreCard, role, label, desc, false, roleCtx);
  }

  // 增强服务
  const enhanceCard = container.createDiv({ cls: 'deeppdf-settings-card' });
  enhanceCard.createEl('h4', { text: '增强服务（可选）' });
  const optionalRoles: { role: RoleType; label: string; desc: string }[] = [
    ...(PROPOSITION_ENABLED ? [{ role: 'proposition' as RoleType, label: '原子事实', desc: '提取原子事实卡片（禁用则不提取）' }] : []),
    { role: 'embedding', label: '向量化', desc: '用于语义搜索的向量嵌入（禁用则降级 BM25）' },
    { role: 'reranker', label: '重排序', desc: '对搜索结果进行精细重排（禁用则不重排）' },
    { role: 'tts', label: '语音播报', desc: 'AI 语音合成播报（禁用则无语音功能）' },
    { role: 'imagegen', label: '图片生成', desc: '信息图/插画生成（禁用则使用默认生图服务）' },
  ];
  for (const { role, label, desc } of optionalRoles) {
    createRoleCard(enhanceCard, role, label, desc, true, roleCtx);
  }
}
