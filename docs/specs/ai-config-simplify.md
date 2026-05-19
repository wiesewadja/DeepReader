# Spec: AI 配置简化 — 新手模式

> 基于 2026-05-19 讨论的决策记录

## 模型映射（最终确认）

| 角色 | 模型 | Provider | 说明 |
|------|------|----------|------|
| chat | mimo-v2.5 | xiaomi | 主对话 |
| router | Step-3.5-Flash | siliconflow | 快速路由 |
| pageindex | mimo-v2.5 | xiaomi | 索引摘要 |
| proposition | mimo-v2.5 | xiaomi | 命题提取 |
| embedding | Qwen/Qwen3-Embedding-0.6B | siliconflow | 向量嵌入 |
| reranker | Qwen/Qwen3-Reranker-0.6B | siliconflow | 重排序 |
| tts | mimo-v2.5-tts-voicedesign | xiaomi | 语音合成 |
| imagegen | sensenova-u1-fast | sensenova | 图片生成（专家模式） |

## 预设配置

### 预设 1: 小米 MIMO
- Token Plan API Key → chat, pageindex, proposition, tts
- SiliconFlow API Key → router, embedding, reranker
- imagegen → null（专家模式手动配置）

### 预设 2: 硅基流动
- SiliconFlow API Key → chat, router, pageindex, embedding, reranker

### 删除
- deepseek-economy
- openai-standard

## 交互设计

### 新手模式（首次配置）
- Provider 卡片选择（小米 MIMO / 硅基流动）
- 小米 MIMO 需要填两个 Key（Token Plan + SiliconFlow）
- 硅基流动只需填一个 Key
- 测试连接 → 确认配置

### 专家模式（底部折叠）
- 展开后显示完整 Provider 列表
- 8 种角色矩阵可手动调整
- imagegen 在此配置

## 降级规则

- 小米预设：router/embedding/reranker 需要 SiliconFlow Key，未填则角色不可用
- 不再静默切换 Provider
- embedding/reranker 缺失 → 对应功能禁用

## 待实施

- [ ] 更新 `presets.ts`：删除 2 个预设，更新角色映射
- [ ] 更新 `llm-section.ts`：双 Key 输入 UI（小米预设）
- [ ] 更新 `settings.ts`：`defaultRoles()` 使用新模型映射
- [ ] 构建验证：`npm run build`
- [ ] 测试验证：`npm run test:run`
