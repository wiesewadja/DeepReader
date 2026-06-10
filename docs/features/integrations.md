# 外部集成（F-26 ~ F-29）

> **架构深度文档**（配套）：
> - 微信读书 → [integrations/weread-api.md](../integrations/weread-api.md)
> - Z-Library → [integrations/zlibrary.md](../integrations/zlibrary.md)
> - Proactive Engine → [integrations/proactive.md](../integrations/proactive.md)
> - User Profile → [integrations/profile.md](../integrations/profile.md)
> - TTS + ASR → [integrations/tts-asr.md](../integrations/tts-asr.md)
>
> 用户已有阅读历史在微信读书。用户需要书才能开始。
> 微信读书的标注是用户思维的痕迹。

## F-26: 微信读书账号绑定

- **为什么存在**: 用户已有阅读历史在微信读书。把微信的标注导入，让 DeepReader 从第一天就有用户上下文——知道用户读过什么、关注什么。
- **用户故事**: 作为微信读书用户，我希望把微信读书的书库同步到 DeepReader
- **前置条件**: 微信读书 API Key 已获取（通过 `微信读书：打开设置配置 API Key` 命令）
- **输入**: API Key
- **输出**: 微信书库出现在 Library 视图中
- **验收标准**:
  - [ ] API Key 加密保存
  - [ ] 拉取书库 < 30s
  - [ ] 失败时显示明确错误（401/网络/限流）
  - [ ] 支持清除/重新配置 API Key
  - [ ] 隐私提示：Key 仅本地存储
- **对应测试**:
  - 单元: `tests/unit/weread/{client,shelf,bookid}.test.ts`
  - E2E: `tests/e2e/specs/weread-api-debug.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.6

---

## F-27: 微信读书标注同步

- **为什么存在**: 微信读书的标注是用户思维的痕迹。导入后 AI 能基于用户的标注理解"用户关注什么"——这是信念四（渐进理解用户）的重要数据源。
- **用户故事**: 作为用户，我希望把微信读书里的标注/想法自动同步到本地
- **前置条件**: F-26 已完成
- **输入**: 触发 `微信读书：同步笔记`
- **输出**: 标注 + 想法写入 `DeepReader/微信读书/{书名}/`
- **验收标准**:
  - [ ] 增量同步（仅拉取新标注）
  - [ ] 保留章节/页码信息
  - [ ] 想法（thoughts）和标注（highlights）分别保存
  - [ ] 同步进度可见
  - [ ] 失败时不破坏已有数据
  - [ ] 同步日志可查看
- **对应测试**:
  - 单元: `tests/unit/weread/{diff,highlight-importer,markdown-renderer,time,mapping-stats}.test.ts`
  - E2E: `tests/e2e/specs/weread-sync.e2e.ts`、`weread-ui.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.6

---

## F-28: 微信强制全量同步 + 重匹配

- **为什么存在**: 增量同步会漂移。提供全量重置能力，是数据完整性的安全网。用户在数据不对时需要一个"推倒重来"的选项。
- **用户故事**: 作为用户，我希望在增量同步出错时强制全量重拉，或重新匹配本地书与微信书
- **前置条件**: F-26 已完成
- **输入**: 命令 `微信读书：强制全量同步` / `微信读书：重新匹配书籍`
- **输出**: 全量数据 / 重新匹配的映射表
- **验收标准**:
  - [ ] 强制全量会清空旧标注后重新拉取
  - [ ] 重匹配基于书名+作者相似度
  - [ ] 手动指定匹配对可保存
  - [ ] 操作有二次确认
  - [ ] 失败时回滚
- **对应测试**:
  - 单元: `tests/unit/weread/{matcher,text-matcher}.test.ts`（间接）
  - 覆盖状态: ⚠️ 间接
- **详见**: product-manual §2.6

---

## F-29: Z-Library 搜索 + 下载

- **为什么存在**: 用户需要书才能开始。降低"获取电子书"这个门槛。默认关闭是法律合规——用户需自行评估风险。
- **用户故事**: 作为用户，我希望能在 DeepReader 里直接搜 Z-Library 找电子书
- **前置条件**: 用户主动启用 Z-Library（默认关闭）；已阅读并同意免责
- **输入**: 关键词 / 作者 / ISBN
- **输出**: Z-Library 搜索结果（书名/作者/格式/大小）+ 下载链接
- **验收标准**:
  - [ ] 默认禁用（需在设置中显式开启）
  - [ ] 首次启用显示完整免责声明
  - [ ] 搜索结果 < 30s 返回
  - [ ] 下载到 `DeepReader/Downloads/`
  - [ ] 下载后可一键加入书库
  - [ ] cookie 持久化（避免重复登录）
- **对应测试**:
  - 单元: `tests/unit/zlibrary/{client,cookie-jar}.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §1.2
