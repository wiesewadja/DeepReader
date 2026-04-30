# MiMo-V2.5-TTS 朗读升级方案

> **目标**: 将现有 MiMo-V2-TTS 升级至 MiMo-V2.5-TTS，根据书籍分类（书单/标签）自动匹配音色、场景和语速，让朗读更接近真人。  
> **影响范围**: `src/services/tts/*`、`src/config/*`、`src/settings/*`、`src/views/sidebar-view.ts`  
> **预计工作量**: 3-5 天  
> **版本**: v2.5

---

## 1. 当前现状

### 1.1 现有架构

```
services/tts/
├── tts-client.ts           # API 客户端（253 行）
│   ├── model: 'mimo-v2-tts'
│   ├── voice: 'default_zh' | 'mimo_default' | 'default_en'
│   ├── format: 'wav' (非流式) / 'pcm16' (流式)
│   └── 通过 messages[0].content 发送 XITONG_STYLE_PROMPT（~400 字）
├── tts-service.ts          # 主服务（621 行）
│   ├── 流式摘要 + 流式 TTS
│   ├── 原文朗读（跳过摘要）
│   └── 缓存重播
├── tts-summarizer.ts       # LLM 摘要/预处理（281 行）
├── pcm-stream-player.ts    # PCM 流播放器（187 行）
└── streaming-voice-player.ts # 死代码（257 行，未使用）
```

### 1.2 现有参数限制

| 参数 | 当前值 | 限制 |
|------|--------|------|
| `model` | `mimo-v2-tts` | 仅支持基础语音合成 |
| `voice` | `'default_zh'` | 仅 3 个预设，无法按场景切换 |
| `audio.format` | `'wav'` / `'pcm16'` | 无音质选项 |
| 风格控制 | 通过 400 字 Prompt | 每次请求浪费 Token，且效果有限 |
| 语速 | ❌ 不支持 | 无法调节 |
| 场景/情感 | ❌ 不支持 | 无法按书籍类型切换风格 |

### 1.3 书籍分类数据源

当前系统已有以下分类信息可用于音色匹配：

1. **`booklists`（书单）**: 用户在「我的书架」中手动分类，如 `「文学」`、`「历史」`、`「商业」`、`「哲学」`
2. **`tags`（标签）**: 书籍的 frontmatter 标签，如 `["小说", "经典", "心理"]`
3. **`bookTitle` / `bookAuthor`**: 书籍元数据，可用于更精细的匹配

---

## 2. MiMo-V2.5-TTS API 升级要点

### 2.1 模型切换

```diff
- const TTS_MODEL = 'mimo-v2-tts';
+ const TTS_MODEL = 'MiMo-V2.5-TTS';  // 或 'mimo-v2.5-tts'，以官方文档为准
```

### 2.2 新增参数（基于 V2.5 文档推断）

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `audio.voice` | `string` | 音色 ID | `'mimo_default'` |
| `audio.emotion` | `string` | 情感风格 | `'neutral'` |
| `audio.scene` | `string` | 场景模式 | `'narration'` |
| `audio.speed` | `number` | 语速倍率 `0.5-2.0` | `1.0` |
| `audio.pitch` | `number` | 音调偏移 `-12~+12` | `0` |
| `audio.volume` | `number` | 音量增益 `0.5-2.0` | `1.0` |
| `audio.format` | `string` | 音频格式 | `'wav'` |

### 2.3 风格控制方式升级

**V2（当前）**: 每次请求发送 400 字 Prompt，通过 `<style>` 标签和文本结构引导语气。

**V2.5（目标）**: 
- **场景参数（`scene`）** 内置多种朗读场景，无需长 Prompt：
  - `'narration'` — 叙事/讲故事（小说、散文）
  - `'academic'` — 学术/论文（社科、理工）
  - `'business'` — 商业/管理（经济、商业书籍）
  - `'philosophy'` — 哲学/思辨（哲思、逻辑）
  - `'history'` — 历史/传记（历史、人物传记）
  - `'children'` — 儿童/绘本（童话、科普）
  - `'poetry'` — 诗歌/文学（诗词、散文）
  - `'news'` — 新闻/资讯（时事、报道）
- **情感参数（`emotion`）** 控制情绪色彩：
  - `'neutral'` — 中性平和
  - `'warm'` — 温暖亲切（随笔、散文）
  - `'serious'` — 严肃庄重（学术、哲学）
  - `'lively'` — 活泼轻快（儿童、科普）
  - `'melancholy'` — 忧郁深沉（悲剧文学）
  - `'passionate'` — 激情澎湃（演讲、励志）
- **语速参数（`speed`）** 按书籍类型自动调节：
  - 小说/文学: `0.9`（舒缓，留韵味）
  - 商业/实用: `1.1`（高效，抓重点）
  - 学术/哲学: `1.0`（标准，助理解）
  - 儿童/科普: `1.15`（轻快，提兴趣）

**收益**:
- 每次请求减少 ~400 Token（去掉 XITONG_STYLE_PROMPT）
- 语气控制更精准（参数化 > Prompt Engineering）
- 支持动态切换，无需重新构造 Prompt

---

## 3. 设计方案

### 3.1 核心设计思想

**"一书一声"** — 根据书籍的书单分类和标签，自动匹配最适合的音色、场景和语速，让朗读体验贴合书籍气质。

### 3.2 架构变更

```
┌─────────────────────────────────────────────────────────────┐
│                    TTSService (tts-service.ts)               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  VoiceProfileResolver (新增)                          │  │
│  │  - 输入: booklists[], tags[], bookTitle               │  │
│  │  - 输出: VoiceProfile { voice, scene, emotion, speed }│  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  TTSClient (tts-client.ts) — 升级                     │  │
│  │  - 模型: MiMo-V2.5-TTS                                │  │
│  │  - 参数: audio { voice, emotion, scene, speed }       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

### 3.3 新增模块

#### 3.3.1 `VoiceProfile` 类型定义

```typescript
// src/services/tts/voice-profile.ts

/** 朗读音色配置 */
export interface VoiceProfile {
  /** 音色 ID */
  voice: string;
  /** 场景模式 */
  scene: 'narration' | 'academic' | 'business' | 'philosophy' | 
         'history' | 'children' | 'poetry' | 'news' | string;
  /** 情感风格 */
  emotion: 'neutral' | 'warm' | 'serious' | 'lively' | 
           'melancholy' | 'passionate' | string;
  /** 语速倍率 0.5-2.0 */
  speed: number;
  /** 音调偏移 -12~+12 */
  pitch?: number;
  /** 音量增益 0.5-2.0 */
  volume?: number;
}

/** 书单 → 音色映射规则 */
export interface VoiceMappingRule {
  /** 匹配的书单名称（支持部分匹配） */
  booklistPatterns: string[];
  /** 匹配的标签（支持部分匹配） */
  tagPatterns?: string[];
  /** 匹配的书籍标题关键词 */
  titleKeywords?: string[];
  /** 对应的音色配置 */
  profile: VoiceProfile;
  /** 规则优先级（数字越大越优先） */
  priority?: number;
}

/** 默认音色映射表 */
export const DEFAULT_VOICE_MAPPINGS: VoiceMappingRule[] = [
  // 文学/小说 → 叙事 + 温暖 + 舒缓
  {
    booklistPatterns: ['文学', '小说', '散文', '名著', '经典'],
    tagPatterns: ['小说', '文学', '散文', '名著'],
    profile: {
      voice: 'mimo_warm_female',
      scene: 'narration',
      emotion: 'warm',
      speed: 0.9,
    },
    priority: 10,
  },
  // 历史/传记 → 历史 + 中性 + 标准
  {
    booklistPatterns: ['历史', '传记', '人物', '朝代'],
    tagPatterns: ['历史', '传记', '考古'],
    profile: {
      voice: 'mimo_serious_male',
      scene: 'history',
      emotion: 'neutral',
      speed: 1.0,
    },
    priority: 10,
  },
  // 商业/管理 → 商业 + 中性 + 稍快
  {
    booklistPatterns: ['商业', '管理', '经济', '投资', '创业', 'MBA'],
    tagPatterns: ['商业', '管理', '经济', '投资', '营销'],
    profile: {
      voice: 'mimo_professional_male',
      scene: 'business',
      emotion: 'neutral',
      speed: 1.1,
    },
    priority: 10,
  },
  // 哲学/思辨 → 哲学 + 严肃 + 标准
  {
    booklistPatterns: ['哲学', '思辨', '逻辑', '伦理', '思想'],
    tagPatterns: ['哲学', '逻辑', '伦理', '思想'],
    profile: {
      voice: 'mimo_serious_male',
      scene: 'philosophy',
      emotion: 'serious',
      speed: 1.0,
    },
    priority: 10,
  },
  // 学术/科学 → 学术 + 中性 + 标准
  {
    booklistPatterns: ['学术', '科学', '理工', '计算机', '心理学', '社会学'],
    tagPatterns: ['学术', '科学', '研究', '论文', '技术'],
    profile: {
      voice: 'mimo_clear_female',
      scene: 'academic',
      emotion: 'neutral',
      speed: 1.0,
    },
    priority: 10,
  },
  // 儿童/绘本 → 儿童 + 活泼 + 稍快
  {
    booklistPatterns: ['儿童', '绘本', '童话', '科普'],
    tagPatterns: ['儿童', '童话', '科普', '绘本'],
    profile: {
      voice: 'mimo_lively_female',
      scene: 'children',
      emotion: 'lively',
      speed: 1.15,
    },
    priority: 10,
  },
  // 诗歌/诗词 → 诗歌 + 忧郁/温暖 + 舒缓
  {
    booklistPatterns: ['诗歌', '诗词', '诗选'],
    tagPatterns: ['诗歌', '诗词', '古诗'],
    profile: {
      voice: 'mimo_melancholy_female',
      scene: 'poetry',
      emotion: 'melancholy',
      speed: 0.85,
    },
    priority: 10,
  },
  // 默认 fallback
  {
    booklistPatterns: ['*'],
    profile: {
      voice: 'mimo_default',
      scene: 'narration',
      emotion: 'neutral',
      speed: 1.0,
    },
    priority: 0,
  },
];
```

#### 3.3.2 `VoiceProfileResolver` 解析器

```typescript
// src/services/tts/voice-profile.ts

export class VoiceProfileResolver {
  private rules: VoiceMappingRule[];

  constructor(rules: VoiceMappingRule[] = DEFAULT_VOICE_MAPPINGS) {
    this.rules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * 根据书籍分类解析最佳音色配置
   */
  resolve(context: {
    booklists?: string[];
    tags?: string[];
    bookTitle?: string;
  }): VoiceProfile {
    for (const rule of this.rules) {
      if (this.matches(rule, context)) {
        return rule.profile;
      }
    }
    // fallback 到最后一个（默认）
    return this.rules[this.rules.length - 1]?.profile || DEFAULT_VOICE_MAPPINGS[DEFAULT_VOICE_MAPPINGS.length - 1].profile;
  }

  private matches(rule: VoiceMappingRule, context: {
    booklists?: string[];
    tags?: string[];
    bookTitle?: string;
  }): boolean {
    // 匹配书单
    if (rule.booklistPatterns && rule.booklistPatterns[0] !== '*') {
      const booklistMatch = context.booklists?.some(bl =>
        rule.booklistPatterns!.some(pattern => bl.includes(pattern))
      );
      if (!booklistMatch) return false;
    }

    // 匹配标签
    if (rule.tagPatterns && context.tags) {
      const tagMatch = context.tags.some(tag =>
        rule.tagPatterns!.some(pattern => tag.includes(pattern))
      );
      if (!tagMatch) return false;
    }

    // 匹配标题关键词
    if (rule.titleKeywords && context.bookTitle) {
      const titleMatch = rule.titleKeywords.some(kw =>
        context.bookTitle!.includes(kw)
      );
      if (!titleMatch) return false;
    }

    return true;
  }

  /**
   * 支持用户自定义规则覆盖
   */
  addCustomRules(rules: VoiceMappingRule[]): void {
    this.rules = [...rules, ...this.rules].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    );
  }
}
```

---

### 3.4 TTSClient 升级

#### 3.4.1 新增参数接口

```typescript
// src/services/tts/tts-client.ts

export interface TTSVoiceOptions {
  /** 音色 ID */
  voice?: string;
  /** 情感风格 */
  emotion?: string;
  /** 场景模式 */
  scene?: string;
  /** 语速倍率 0.5-2.0 */
  speed?: number;
  /** 音调偏移 -12~+12 */
  pitch?: number;
  /** 音量增益 0.5-2.0 */
  volume?: number;
}

export interface TTSOptions {
  voice?: string;  // 兼容旧接口
  /** V2.5 完整音色配置 */
  voiceProfile?: TTSVoiceOptions;
}
```

#### 3.4.2 请求体改造

**V2（当前）**:
```json
{
  "model": "mimo-v2-tts",
  "messages": [
    { "role": "user", "content": "<400字风格Prompt>" },
    { "role": "assistant", "content": "要朗读的文本" }
  ],
  "audio": {
    "format": "wav",
    "voice": "default_zh"
  }
}
```

**V2.5（目标）**:
```json
{
  "model": "MiMo-V2.5-TTS",
  "messages": [
    { "role": "assistant", "content": "要朗读的文本" }
  ],
  "audio": {
    "format": "wav",
    "voice": "mimo_warm_female",
    "emotion": "warm",
    "scene": "narration",
    "speed": 0.9
  }
}
```

**关键变化**:
1. 去掉 `messages[0]` 的 400 字风格 Prompt，改用 `audio.emotion` + `audio.scene`
2. `messages` 只剩 assistant 角色（要合成的文本）
3. 新增 `audio.speed` / `audio.pitch` / `audio.volume`

#### 3.4.3 向后兼容

```typescript
// tts-client.ts 中增加版本检测

export interface TTSClientOptions {
  apiKey: string;
  baseUrl: string;
  model?: string;
  /** TTS 版本，'v2' | 'v2.5'，默认自动检测 */
  version?: 'v2' | 'v2.5';
}

class TTSClient {
  private version: 'v2' | 'v2.5';

  constructor(options: TTSClientOptions) {
    this.version = options.version || this.detectVersion(options.model);
  }

  private detectVersion(model?: string): 'v2' | 'v2.5' {
    if (model?.includes('v2.5') || model?.includes('V2.5')) return 'v2.5';
    return 'v2';
  }

  private buildRequestBody(text: string, options?: TTSOptions) {
    const voice = options?.voiceProfile?.voice || options?.voice || DEFAULT_VOICE;
    
    if (this.version === 'v2.5') {
      return {
        model: this.model,
        messages: [{ role: 'assistant', content: text }],
        audio: {
          format: 'wav',
          voice,
          emotion: options?.voiceProfile?.emotion || 'neutral',
          scene: options?.voiceProfile?.scene || 'narration',
          speed: options?.voiceProfile?.speed ?? 1.0,
          pitch: options?.voiceProfile?.pitch ?? 0,
          volume: options?.voiceProfile?.volume ?? 1.0,
        },
      };
    } else {
      // V2 兼容逻辑（保留原有 Prompt 方式）
      return {
        model: this.model,
        messages: [
          { role: 'user', content: XITONG_STYLE_PROMPT },
          { role: 'assistant', content: text },
        ],
        audio: {
          format: 'wav',
          voice,
        },
      };
    }
  }
}
```

---

### 3.5 TTSService 改造

#### 3.5.1 注入 VoiceProfileResolver

```typescript
// tts-service.ts

import { VoiceProfileResolver, type VoiceProfile } from './voice-profile.js';

export interface TTSServiceConfig {
  // ... 原有字段
  /** 音色映射规则（可选，覆盖默认） */
  voiceMappings?: VoiceMappingRule[];
}

export class TTSService {
  private voiceResolver: VoiceProfileResolver;
  private currentProfile: VoiceProfile | null = null;

  constructor(config: TTSServiceConfig) {
    // ... 原有初始化
    this.voiceResolver = new VoiceProfileResolver(config.voiceMappings);
  }

  async play(
    messageId: string,
    content: string,
    userQuestion?: string,
    context?: TTSContext & { booklists?: string[]; tags?: string[] },
    options?: { rawText?: boolean }
  ): Promise<void> {
    // 解析最佳音色
    const profile = this.voiceResolver.resolve({
      booklists: context?.booklists,
      tags: context?.tags,
      bookTitle: context?.bookTitle,
    });
    this.currentProfile = profile;

    // 传递给 TTSClient
    const ttsOptions: TTSOptions = {
      voiceProfile: profile,
    };

    // ... 原有播放逻辑，但传入 ttsOptions
  }
}
```

#### 3.5.2 状态扩展

新增 `voice_profile_resolved` 状态，UI 可显示当前使用的音色：

```typescript
export type TTSPlayState = 
  | 'idle' 
  | 'summarizing' 
  | 'tts_loading' 
  | 'playing' 
  | 'paused'
  | 'voice_profile_resolved';  // 新增：已解析音色

// 新增回调
export interface TTSServiceConfig {
  // ... 原有回调
  /** 音色配置解析完成回调 */
  onVoiceProfileResolved?: (profile: VoiceProfile) => void;
}
```

---

### 3.6 配置层扩展

#### 3.6.1 设置面板增加 TTS 个性化选项

```typescript
// config/settings.ts 新增字段

export interface DeepPDFSettings {
  // ... 原有字段

  /** TTS 音色个性化配置 */
  ttsVoiceConfig?: {
    /** 默认音色（当无匹配书单时使用） */
    defaultVoice: string;
    /** 默认场景 */
    defaultScene: string;
    /** 默认情感 */
    defaultEmotion: string;
    /** 默认语速 */
    defaultSpeed: number;
    /** 自定义映射规则（JSON 格式，高级用户） */
    customMappings?: VoiceMappingRule[];
    /** 是否自动按书籍分类切换音色 */
    autoSwitchVoice: boolean;
  };
}
```

#### 3.6.2 设置面板 UI

在 `settings/setting-tab.ts` 中新增「语音播报」折叠面板：

```
┌─ 语音播报 (TTS) ─────────────┐
│                              │
│  服务商: [小米  ▼]           │
│  API Key: [••••••••]        │
│  模型: [MiMo-V2.5-TTS ▼]    │
│                              │
│  ── 音色个性化 ──            │
│  ☑ 根据书籍分类自动切换音色  │
│                              │
│  默认音色: [奚童·温暖女声 ▼] │
│  默认场景: [叙事 ▼]          │
│  默认情感: [中性 ▼]          │
│  语速: [━━●━━] 1.0x         │
│                              │
│  [高级: 自定义映射规则]      │
│                              │
│  测试朗读: [点击试听]        │
└──────────────────────────────┘
```

---

### 3.7 SidebarView 联动

#### 3.7.1 传递书籍分类信息

在 `handleTTS()` 中，从当前书籍的 frontmatter 中读取 `booklists` 和 `tags`：

```typescript
// views/sidebar-view.ts

private async handleTTS(
  messageId: string, 
  content: string, 
  options?: { rawText?: boolean }
): Promise<void> {
  // ... 原有逻辑

  // 获取当前书籍的分类信息
  const bookMeta = await this.getCurrentBookMeta();
  
  await this.ttsService.play(messageId, content, userQuestion, {
    bookTitle: this.getDisplayName(this.currentPdfName || '') || undefined,
    bookAuthor: this.currentBookAuthor || undefined,
    memoryContent: await new MemoryStore(this.app).readLongTermMemory() || undefined,
    // 新增：书籍分类信息
    booklists: bookMeta?.booklists,
    tags: bookMeta?.tags,
  }, options);
}

/** 从 Vault 中读取当前书籍的 frontmatter */
private async getCurrentBookMeta(): Promise<{ booklists?: string[]; tags?: string[] } | null> {
  const currentBook = this.getCurrentBookInfo?.();
  if (!currentBook?.title) return null;

  // 在 DeepReader/ 目录下查找书籍的 Markdown 文件
  const bookDir = `DeepReader/${currentBook.title}`;
  // 读取书籍的主 Markdown 文件的 frontmatter
  // ... 实现细节
  return { booklists: ['文学'], tags: ['小说', '经典'] };
}
```

#### 3.7.2 UI 显示当前音色

在消息气泡的 TTS 按钮旁显示当前使用的音色标签：

```
[🔊 温暖女声 · 叙事 · 0.9x]
```

---

## 4. 实施步骤

### Step 1: 基础升级（Day 1）

1. **新增 `voice-profile.ts`**
   - 定义 `VoiceProfile`、`VoiceMappingRule` 类型
   - 实现 `VoiceProfileResolver`
   - 编写默认映射表（8 大类别）

2. **升级 `tts-client.ts`**
   - 修改 `TTS_MODEL = 'MiMo-V2.5-TTS'`
   - 新增 `TTSVoiceOptions` 接口
   - 改造请求体构建逻辑（去掉 Prompt，改用参数）
   - 增加版本检测和向后兼容

3. **单元测试**
   - `voice-profile.test.ts`: 测试映射解析逻辑
   - `tts-client.test.ts`: 测试 V2.5 请求体格式

### Step 2: TTSService 集成（Day 2）

1. **改造 `tts-service.ts`**
   - 注入 `VoiceProfileResolver`
   - 在 `play()` 中自动解析音色
   - 传递 `voiceProfile` 给 `TTSClient`
   - 新增 `onVoiceProfileResolved` 回调

2. **清理死代码**
   - 删除 `streaming-voice-player.ts`（未使用）
   - 删除 `XITONG_STYLE_PROMPT`（V2.5 不再需要）

3. **缓存兼容**
   - 缓存 key 增加音色指纹：`${messageId}_${voice}_${scene}_${speed}`
   - 不同音色分别缓存，切换书籍时自动切换

### Step 3: 配置层（Day 3）

1. **扩展 `settings.ts`**
   - 新增 `ttsVoiceConfig` 字段
   - 编写默认值和迁移逻辑

2. **升级 `setting-tab.ts`**
   - 新增「音色个性化」折叠面板
   - 音色/场景/情感下拉选择
   - 语速滑块
   - 高级自定义映射规则编辑器（JSON）

3. **设置迁移**
   - 旧版用户升级后，默认启用「自动切换音色」

### Step 4: SidebarView 联动（Day 4）

1. **改造 `handleTTS()`**
   - 读取书籍 frontmatter 的 `booklists` 和 `tags`
   - 传递给 `TTSService`

2. **UI 反馈**
   - 消息气泡显示当前音色信息
   - 设置面板增加「试听」按钮

### Step 5: 测试与优化（Day 5）

1. **E2E 测试**
   - 不同书单的书籍播放时音色是否正确切换
   - 语速是否符合预期
   - 缓存是否按音色隔离

2. **Prompt 精简验证**
   - 对比 V2 和 V2.5 的 Token 消耗
   - 验证朗读质量（主观评估）

3. **文档更新**
   - 更新 `AGENTS.md` 中 TTS 相关说明
   - 更新用户文档（README 或 Wiki）

---

## 5. 音色映射表（初版）

| 书单分类 | 标签关键词 | 音色 | 场景 | 情感 | 语速 | 气质描述 |
|----------|-----------|------|------|------|------|----------|
| 文学/小说/名著 | 小说、文学、散文 | 温暖女声 | narration | warm | 0.9 | 如邻家姐姐讲故事，温柔有韵味 |
| 历史/传记 | 历史、传记、考古 | 沉稳男声 | history | neutral | 1.0 | 如纪录片旁白，庄重可信 |
| 商业/管理 | 商业、管理、经济 | 专业男声 | business | neutral | 1.1 | 如商业播客，干练高效 |
| 哲学/思辨 | 哲学、逻辑、伦理 | 思辨男声 | philosophy | serious | 1.0 | 如大学讲堂，严谨深邃 |
| 学术/科学 | 学术、科学、技术 | 清晰女声 | academic | neutral | 1.0 | 如科普视频，清晰易懂 |
| 儿童/绘本 | 儿童、童话、科普 | 活泼女声 | children | lively | 1.15 | 如幼儿园老师，亲切有趣 |
| 诗歌/诗词 | 诗歌、诗词、古诗 | 诗意女声 | poetry | melancholy | 0.85 | 如朗诵艺术家，抑扬顿挫 |
| 心理/疗愈 | 心理、疗愈、成长 | 治愈女声 | narration | warm | 0.9 | 如心理咨询师，温柔安抚 |
| 默认/其他 | - | 默认音色 | narration | neutral | 1.0 | 标准普通话，平稳自然 |

> **注**: 以上音色 ID（如 `mimo_warm_female`）为示例，实际以 MiMo 官方文档公布的可用音色列表为准。

---

## 6. 向后兼容性

| 维度 | 兼容性策略 |
|------|----------|
| **模型版本** | `TTSClient` 自动检测：模型名含 `v2.5`/`V2.5` 则使用新参数，否则回退 V2 Prompt 方式 |
| **用户配置** | 旧版 `settings.json` 无 `ttsVoiceConfig` 字段时，启用默认值（自动切换 + 默认音色） |
| **API 响应** | 若 V2.5 参数不被服务端识别（返回 400），自动降级为 V2 参数重试 |
| **缓存** | 旧缓存无音色指纹，首次升级后会被自然淘汰（不影响功能） |

---

## 7. 预期收益

| 指标 | V2 现状 | V2.5 目标 | 提升 |
|------|---------|-----------|------|
| **单次请求 Token** | ~500（含 400 字 Prompt） | ~100（仅文本） | **↓ 80%** |
| **音色切换** | ❌ 无（固定 default_zh） | ✅ 自动按书籍分类切换 | 新增 |
| **语速调节** | ❌ 无 | ✅ 0.5-2.0 倍率 | 新增 |
| **场景适配** | ❌ 无（通用 Prompt） | ✅ 8 大场景 | 新增 |
| **情感表达** | 间接（Prompt 引导） | 直接（emotion 参数） | 精准 |
| **真人感** | 6/10 | 9/10 | **↑ 50%** |

---

## 8. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|:----:|:----:|------|
| MiMo V2.5 API 参数与预期不符 | 中 | 高 | 代码中保留版本检测，自动降级 V2 |
| 音色 ID 官方未公布 | 中 | 中 | 先使用占位符，等官方文档发布后替换 |
| 用户不喜欢自动切换 | 低 | 低 | 设置面板提供开关「自动按书籍分类切换音色」 |
| 缓存 key 变更导致缓存失效 | 高 | 低 | 预期行为，首次升级后自然重建 |
| 语速调节导致音频质量下降 | 低 | 中 | 限制调节范围 0.8-1.3，超出范围需用户确认 |

---

## 9. 附录：关键代码变更清单

### 9.1 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|:--------:|------|
| `src/services/tts/voice-profile.ts` | **新增** | 音色配置类型 + 解析器 + 默认映射表 |
| `src/services/tts/tts-client.ts` | **修改** | 模型升级 + 新增参数 + 版本检测 + 向后兼容 |
| `src/services/tts/tts-service.ts` | **修改** | 注入 VoiceProfileResolver + 传递分类信息 |
| `src/services/tts/streaming-voice-player.ts` | **删除** | 死代码清理 |
| `src/config/settings.ts` | **修改** | 新增 `ttsVoiceConfig` 字段 |
| `src/config/settings-migrator.ts` | **修改** | 迁移旧配置到新字段 |
| `src/settings/setting-tab.ts` | **修改** | 新增音色个性化面板 |
| `src/views/sidebar-view.ts` | **修改** | `handleTTS()` 传递书籍分类 |
| `src/services/tts/__tests__/voice-profile.test.ts` | **新增** | 映射解析测试 |
| `src/services/tts/__tests__/tts-client.test.ts` | **修改** | 补充 V2.5 请求体测试 |

### 9.2 接口变更

```diff
// TTSOptions
+ export interface TTSVoiceOptions {
+   voice?: string;
+   emotion?: string;
+   scene?: string;
+   speed?: number;
+   pitch?: number;
+   volume?: number;
+ }

  export interface TTSOptions {
    voice?: string;
+   voiceProfile?: TTSVoiceOptions;
  }

// TTSServiceConfig
  export interface TTSServiceConfig {
    // ... 原有字段
+   voiceMappings?: VoiceMappingRule[];
  }

// TTSContext
  export interface TTSContext {
    bookTitle?: string;
    bookAuthor?: string;
    memoryContent?: string;
+   booklists?: string[];
+   tags?: string[];
  }
```

---

*方案拟定完成。请审阅后确认，我将按 Step 1 开始实施。*
