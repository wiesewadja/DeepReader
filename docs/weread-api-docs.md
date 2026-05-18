# 微信读书 API 接口文档

> 版本：1.0.3 | 更新日期：2026-05-17
> 基于 WeRead Agent API Gateway 整理

---

## 目录

- [通用规范](#通用规范)
- [接口总览](#接口总览)
- [一、搜索](#一搜索)
- [二、书籍信息](#二书籍信息)
- [三、书架管理](#三书架管理)
- [四、阅读统计](#四阅读统计)
- [五、笔记与划线](#五笔记与划线)
- [六、书籍点评](#六书籍点评)
- [七、推荐](#七推荐)
- [八、用户信息](#八用户信息)
- [附录：评分映射表](#附录评分映射表)
- [附录：深度链接 URL Schema](#附录深度链接-url-schema)

---

## 通用规范

### 统一入口

```
POST https://i.weread.qq.com/api/agent/gateway
```

### 鉴权

| Header | 值 |
|--------|-----|
| `Authorization` | `Bearer <WEREAD_API_KEY>` |
| `Content-Type` | `application/json` |

API Key 格式：`wrk-xxxxxxxx`，绑定用户身份（vid），需要用户身份的接口会自动注入。

### 请求格式

所有请求为 JSON Body，参数**必须平铺在顶层**，禁止嵌套在 `params`/`data`/`body` 等对象中。

```json
{
  "api_name": "/store/search",
  "keyword": "三体",
  "count": 10,
  "skill_version": "1.0.3"
}
```

| 顶层字段 | 类型 | 必填 | 说明 |
|---------|------|------|------|
| `api_name` | string | 是 | 接口名称 |
| `skill_version` | string | 是 | 当前版本号（当前为 `1.0.3`） |
| 业务参数 | - | 视接口而定 | 与 `api_name`、`skill_version` 平级 |

> ⚠️ 如果用 `params` 包裹会导致后端收不到业务参数，分页接口会重复返回第一页。

### 响应格式

```json
{
  "errcode": 0,
  ...业务字段
}
```

- `errcode` 非 0 表示错误
- 回包经过字段裁剪，只返回核心字段
- 如果回包中出现 `upgrade_info` 字段，表示需要升级 skill 版本

### 可用接口查看

发送以下请求可获取所有可用接口列表及参数定义：

```json
{"api_name": "/_list", "skill_version": "1.0.3"}
```

### 通用规则

1. **版本上报**：每次请求必须携带 `skill_version`
2. **参数平铺**：所有业务参数在 body 顶层
3. **bookId 解析**：用户提供书名时，先调 `/store/search` 获取 bookId
4. **上下文**：对话中记住已查询的 bookId
5. **时间戳展示**：所有 Unix 时间戳展示时转为 `YYYY-MM-DD` 格式
6. **阅读时长**：单位为秒，展示时转为 "X小时Y分钟"

---

## 接口总览

| # | 接口 | 说明 | 需登录 |
|---|------|------|--------|
| 1 | `/store/search` | 搜索书籍/作者/书单/听书/公众号/文章 | 是 |
| 2 | `/book/info` | 获取书籍基本信息 | 否 |
| 3 | `/book/chapterinfo` | 获取章节目录 | 否 |
| 4 | `/book/getprogress` | 获取阅读进度 | 是 |
| 5 | `/book/bookmarklist` | 获取用户对某本书的划线列表 | 是 |
| 6 | `/book/underlines` | 获取章节划线热度统计 | 是 |
| 7 | `/book/bestbookmarks` | 获取书籍热门划线 | 是 |
| 8 | `/book/readreviews` | 获取划线下的想法/评论 | 是 |
| 9 | `/book/recommend` | 获取个性化推荐 | 是 |
| 10 | `/book/similar` | 获取相似书推荐 | 是 |
| 11 | `/shelf/sync` | 获取书架列表 | 是 |
| 12 | `/review/list` | 获取书籍公开点评 | 是 |
| 13 | `/review/list/mine` | 获取个人在某书上的想法/笔记 | 是 |
| 14 | `/review/single` | 获取单条想法/评论详情 | 是 |
| 15 | `/user/notebooks` | 获取所有有笔记的书籍列表 | 是 |
| 16 | `/readdata/detail` | 获取阅读统计数据 | 是 |

---

## 一、搜索

### `POST /store/search` — 搜索

搜索书籍、作者、书单、听书、公众号、文章等。

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `keyword` | string | 是 | - | 搜索关键词 |
| `scope` | int | 否 | `10` | 搜索类型（见下表） |
| `maxIdx` | int | 否 | `0` | 翻页偏移 |
| `count` | int | 否 | `15` | 每页数量。用户未指定时不传此参数 |

#### scope 枚举

| scope | 名称 | 说明 |
|-------|------|------|
| `0` | 全部 | 综合搜索，返回多个分组 |
| `10` | 电子书 | 只搜电子书（不含网文） |
| `16` | 网文小说 | 只搜网文小说 |
| `14` | 微信听书 | 有声书/专辑/播客 |
| `6` | 作者 | 搜索作者 |
| `12` | 全文 | 搜索书籍正文内容 |
| `13` | 书单 | 搜索书单 |
| `2` | 公众号 | 搜索公众号 |
| `4` | 文章 | 搜索公众号文章 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `sid` | string | 搜索会话 ID |
| `hasMore` | int | 是否有更多（1=有, 0=无） |
| `results` | array | 搜索结果分组数组 |

#### `results[].` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `title` | string | 分组标题（如"电子书""作者"） |
| `scope` | int | 分组类型 |
| `scopeCount` | int | 该分组总结果数 |
| `currentCount` | int | 本次返回数量 |
| `books` | array | 书籍/结果数组 |

#### `results[].books[].` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `searchIdx` | string | 搜索序号（用于翻页） |
| `bookInfo` | object | 书籍信息对象 |

#### `bookInfo` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookId` | string | 书籍唯一标识 |
| `title` | string | 书名 |
| `author` | string | 作者 |
| `cover` | string | 封面图 URL |
| `intro` | string | 书籍简介 |
| `publisher` | string | 出版社 |
| `category` | string | 分类 |
| `payType` | int | 付费类型 |
| `price` | int | 价格（单位：分） |
| `soldout` | int | 是否下架（1=下架） |
| `readingCount` | int | 在读人数 |
| `newRating` | int | 评分（0-100，千分制详见附录） |
| `newRatingCount` | int | 评分人数 |
| `newRatingDetail` | object | 评分标签（如 `{"title":"神作"}`） |

#### 翻页逻辑

`hasMore` 为 1 时，用最后一条的 `searchIdx` 作为下一页的 `maxIdx`。

---

## 二、书籍信息

### `POST /book/info` — 书籍基本信息

无需登录。

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | 是 | 书籍 ID |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookId` | string | 书籍 ID |
| `title` | string | 书名 |
| `author` | string | 作者 |
| `translator` | string | 译者 |
| `cover` | string | 封面 URL |
| `intro` | string | 简介 |
| `category` | string | 分类 |
| `publisher` | string | 出版社 |
| `publishTime` | string | 出版时间 |
| `isbn` | string | ISBN |
| `wordCount` | int | 总字数 |
| `newRating` | int | 评分（0-100） |
| `newRatingCount` | int | 评分人数 |
| `newRatingDetail` | object | 评分分布详情 |

### `POST /book/chapterinfo` — 章节目录

无需登录。

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | 是 | 书籍 ID |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookId` | string | 书籍 ID |
| `synckey` | int | 同步 key（版本号） |
| `chapterUpdateTime` | int | 章节最后更新时间（Unix 时间戳） |
| `chapters` | array | 章节数组 |

#### `chapters[].` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `chapterUid` | int | 章节 UID（用于其他接口如 underlines） |
| `chapterIdx` | int | 章节序号 |
| `title` | string | 章节标题 |
| `wordCount` | int | 章节字数 |
| `level` | int | 目录层级（1=一级标题, 2=二级…） |
| `updateTime` | int | 章节更新时间 |
| `price` | int | 章节价格（0=免费） |
| `paid` | int | 是否已购买（1=已购买） |
| `isMPChapter` | int | 是否公众号章节（1=是） |
| `anchors` | array | 章节内锚点/子标题数组 |

### `POST /book/getprogress` — 阅读进度

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | 是 | 书籍 ID |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookId` | string | 书籍 ID |
| `book` | object | 阅读进度对象 |
| `book.chapterUid` | int | 当前阅读章节 UID |
| `book.chapterOffset` | int | 当前章节内偏移 |
| `book.progress` | int | 阅读进度百分比（0-100，1=1%，100=已读完） |
| `book.updateTime` | int | 最后阅读时间（Unix 时间戳） |
| `book.recordReadingTime` | int | 累计阅读时长（秒） |
| `book.finishTime` | int | 读完时间（仅 progress=100 时存在） |
| `book.isStartReading` | bool | 是否已开始阅读 |
| `timestamp` | int | 服务端时间戳 |

> 注意：progress 是 0-100 的整数，0=未读，1-99=部分阅读，100=已读完。只有 100 才代表读完。

---

## 三、书架管理

### `POST /shelf/sync` — 获取书架列表

无需额外请求参数，用户身份通过 API Key 自动识别。

#### 请求参数

无

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `books` | array | 电子书/导入书/公众号类书籍条目数组 |
| `albums` | array | 专辑/有声书数组（与 books 完全独立） |
| `mp` | object/null | 文章收藏入口对象；非空表示有 1 个"文章收藏"条目 |
| `archive` | array | 书单数组 |
| `bookCount` | int | 可枚举电子书数量，通常等于 `books.length` |

#### `books[].` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookId` | string | 书籍唯一标识 |
| `title` | string | 书名 |
| `author` | string | 作者 |
| `cover` | string | 封面图 URL |
| `category` | string | 分类 |
| `readUpdateTime` | int | 最近阅读时间（Unix 时间戳） |
| `finishReading` | int | 是否读完（1=读完） |
| `updateTime` | int | 书籍更新时间（Unix 时间戳） |
| `isTop` | int | 是否置顶 |
| `secret` | int | 是否私密（1=私密） |

#### `albums[].albumInfo` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `albumId` | string | 专辑唯一标识 |
| `name` | string | 专辑名称 |
| `authorName` | string | 演播/作者 |
| `cover` | string | 封面图 URL |
| `trackCount` | int | 音频集数 |
| `finishStatus` | string | 完结状态（如"已完结"） |
| `finish` | int | 是否完结（1=完结） |
| `payType` | int | 付费类型 |
| `intro` | string | 专辑简介 |
| `updateTime` | int | 更新时间（Unix 时间戳） |

#### `albums[].albumInfoExtra` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `secret` | int | 是否私密 |
| `lecturePaid` | int | 是否已购买（1=已购买） |
| `lectureReadUpdateTime` | int | 最近收听时间（Unix 时间戳） |
| `isTop` | int | 是否置顶 |

#### 数量计算口径

| 指标 | 计算公式 |
|------|----------|
| 书架可见条目总数 | `books.length + albums.length + (mp 非空 ? 1 : 0)` |
| 电子书数 | `bookCount` 或 `books.length` |
| 有声书/专辑数 | `albums.length` |
| 私密阅读数 | `books[].secret==1` 数量 + `albums[].secret==1` 数量 + (`mp` 非空 ? 1 : 0) |
| 公开阅读数 | `books[].secret==0` 数量 + `albums[].secret==0` 数量 |

---

## 四、阅读统计

### `POST /readdata/detail` — 阅读统计详情

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `mode` | string | 否 | `monthly` | 统计维度：`weekly`=本周, `monthly`=本月, `annually`=本年, `overall`=总计 |
| `baseTime` | int | 否 | `0` | 基准时间戳（0=当前周期）。传历史时间戳可查看该周期数据 |

`mode` 与 `baseTime` 配合：

| mode | 周期粒度 | baseTime 行为 |
|------|----------|---------------|
| `weekly` | 自然周 | 归一到该周周一 00:00 |
| `monthly` | 自然月 | 归一到该月 1 日 00:00 |
| `annually` | 自然年 | 归一到该年 1 月 1 日 00:00 |
| `overall` | 全部历史 | 固定为 0 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `baseTime` | int | 统计周期的基准时间戳 |
| `readTimes` | object | 分桶阅读时长明细（key=分桶起始时间戳, value=秒数） |
| `dailyReadTimes` | object | 年度模式的每日阅读时长明细（key=日期时间戳, value=秒数） |
| `readDays` | int | 有效阅读天数（单日阅读满 1 分钟计为 1 天） |
| `totalReadTime` | int | 总阅读/收听时长（**单位：秒**） |
| `dayAverageReadTime` | int | 日均阅读时长（秒），分母为自然日数（不是 readDays） |
| `compare` | float | 与上一周期的日均时长对比比例（正数=增长，负数=下降） |
| `readLongest` | array | 读得最多的书/有声内容排行（最多 10 条，按 readTime 降序） |
| `readStat` | array | 阅读统计摘要数组 |
| `preferCategory` | array | 偏好阅读分类数组 |
| `preferCategoryWord` | string | 偏好分类文案 |
| `preferTime` | array | 24小时阅读时段分布（值=秒数，顺序从 6 点开始到次日 5 点） |
| `preferTimeWord` | string | 偏好时段文案 |
| `preferAuthor` | array | 偏好作者数组 |
| `authorCount` | int | 符合统计条件的作者总数 |
| `preferPublisher` | array | 偏好出版社数组 |
| `preferCp` | array | 偏好版权方数组 |
| `readRate` | int | 文字阅读占比百分比 |
| `wrReadTime` | int | 文字阅读时长（秒） |
| `wrListenTime` | int | 听书/TTS/有声内容时长（秒） |
| `rank` | object | 本周好友阅读排行 |
| `registTime` | int | 用户注册时间戳 |
| `medals` | array | 勋章数组 |
| `recordReadingTime` | int | 总朗读/记录类阅读时长（秒） |
| `yearReport` | array | 年度报告入口数组 |

#### `readLongest[].` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `book` | object | 书籍信息（bookId, title, author, cover 等）。电子书 |
| `albumInfo` | object | 有声内容信息。有声书/专辑时返回 |
| `readTime` | int | 在该统计范围内的阅读/收听时长（秒） |
| `recordReadingTime` | int | 朗读/记录类阅读时长（秒） |
| `tags` | array | 标签（如`笔记最多`、`单日阅读最久`） |

#### `readStat[].` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `stat` | string | 统计项名称（常见：`读过`、`读完`、`阅读`、`笔记`） |
| `counts` | string | 统计值文案（如 `12本`、`45天`、`120条`） |
| `scheme` | string | App 跳转链接（可能为空） |

#### 跨周期统计逻辑

`/readdata/detail` 只支持固定自然周期查询。跨区间统计需组合多个周期：

1. 跨年区间：按自然年拆分，逐年代入 `mode=annually` 查询
2. 整周期使用 `totalReadTime` 累加
3. 边界周期优先使用 `dailyReadTimes` 做日级扣减

---

## 五、笔记与划线

### `POST /user/notebooks` — 笔记本概览

获取所有有笔记的书籍列表。

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `count` | int | 否 | `20` | 每页数量 |
| `lastSort` | int | 否 | - | 翻页游标（上一页最后一条的 `sort` 值） |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalBookCount` | int | 有笔记的书籍总数 |
| `totalNoteCount` | int | 笔记总条数，统计口径为 `reviewCount + noteCount + bookmarkCount` 的汇总 |
| `hasMore` | int | 是否有更多（1=有） |
| `books` | array | 有笔记的书籍列表 |
| `books[].bookId` | string | 书籍 ID |
| `books[].book` | object | 书籍信息（title, author, cover 等） |
| `books[].reviewCount` | int | 想法/点评数 |
| `books[].noteCount` | int | 划线数（高亮标注的原文条数） |
| `books[].bookmarkCount` | int | 书签数 |
| `books[].readingProgress` | int | 阅读进度 |
| `books[].markedStatus` | int | 标记状态（1=读完, 0=在读） |
| `books[].sort` | int | 排序值（最近笔记时间，用于翻页） |

> **笔记数** = `reviewCount + noteCount + bookmarkCount`，不要把 `noteCount` 单独当作总笔记数。

#### 分页规则

使用基于时间排序值的游标分页，不支持 `offset`/`limit`。

1. 首页只传 `count`
2. `hasMore` 为 1 时，取本页最后一项的 `sort`，下次作为 `lastSort` 传入

### `POST /book/bookmarklist` — 划线内容列表

获取用户对某本书的划线列表（自动过滤书签）。

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | 是 | 书籍 ID |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `updated` | array | 划线数组 |
| `updated[].bookmarkId` | string | 划线唯一 ID |
| `updated[].bookId` | string | 书籍 ID |
| `updated[].chapterUid` | int | 所在章节 UID |
| `updated[].markText` | string | 划线原文 |
| `updated[].createTime` | int | 创建时间（Unix 时间戳） |
| `updated[].type` | int | 类型（0=书签, 1=划线） |
| `updated[].range` | string | 位置范围（如 "900-2004"） |
| `updated[].colorStyle` | int | 划线颜色样式 |
| `chapters` | array | 章节信息数组 |
| `chapters[].chapterUid` | int | 章节 UID |
| `chapters[].chapterIdx` | int | 章节序号 |
| `chapters[].title` | string | 章节标题 |
| `book` | object | 书籍信息 |

### `POST /book/underlines` — 章节划线热度统计

获取某章节每条划线的热度统计（不含划线文本）。

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `bookId` | string | 是 | - | 书籍 ID |
| `chapterUid` | int | 是 | - | 章节 UID（从 `/book/chapterinfo` 获取） |
| `synckey` | int | 否 | `0` | 增量同步 key |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookId` | string | 书籍 ID |
| `chapterUid` | int | 章节 UID |
| `underlines` | array | 划线热度统计数组 |
| `underlines[].range` | string | 划线位置范围（如 "393-401"） |
| `underlines[].count` | int | 划线人数 |
| `underlines[].score` | int | 热度分数 |
| `underlines[].type` | int | 划线类型 |
| `synckey` | int | 同步 key |

### `POST /book/bestbookmarks` — 热门划线

获取全书的 Popular Highlights（含划线原文和划线人数，按热度排序，最多 20 条）。

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `bookId` | string | 是 | - | 书籍 ID |
| `chapterUid` | int | 否 | `0` | 章节 UID（0=全部章节） |
| `synckey` | int | 否 | `0` | 增量同步 key |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `synckey` | int | 同步 key |
| `totalCount` | int | 热门划线总数 |
| `items` | array | 热门划线数组 |
| `items[].bookId` | string | 书籍 ID |
| `items[].userVid` | int | 代表用户 VID |
| `items[].bookmarkId` | string | 划线唯一 ID |
| `items[].chapterUid` | int | 所在章节 UID |
| `items[].range` | string | 划线位置范围（如 "393-401"） |
| `items[].markText` | string | 划线原文文本 |
| `items[].totalCount` | int | 划线人数 |
| `chapters` | array | 章节信息数组（同 bookmarklist） |

### `POST /book/readreviews` — 划线下的想法/评论

#### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bookId` | string | 是 | 书籍 ID |
| `chapterUid` | int | 是 | 章节 UID |
| `reviews` | array | 是 | 要查询的划线范围数组 |

`reviews[].` 结构：

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `range` | string | 是 | - | 划线位置范围（从 `/book/bestbookmarks` 获取） |
| `maxIdx` | int | 否 | `0` | 翻页偏移 |
| `count` | int | 否 | `20` | 每页数量（服务端上限 20，超过截断） |
| `synckey` | int | 否 | `0` | 翻页游标 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `bookId` | string | 书籍 ID |
| `chapterUid` | int | 章节 UID |
| `reviews` | array | 每个 range 的想法列表 |
| `reviews[].range` | string | 划线范围 |
| `reviews[].totalCount` | int | 该范围下想法总数 |
| `reviews[].hasMore` | int | 是否有更多（1=有） |
| `reviews[].maxIdx` | int | 翻页偏移 |
| `reviews[].pageReviews` | array | 想法数组 |
| `reviews[].pageReviews[].reviewId` | string | 想法 ID |
| `reviews[].pageReviews[].review.abstract` | string | 划线原文 |
| `reviews[].pageReviews[].review.content` | string | 想法内容 |
| `reviews[].pageReviews[].review.range` | string | 划线位置范围 |
| `reviews[].pageReviews[].review.createTime` | int | 创建时间 |
| `reviews[].pageReviews[].review.author` | object | 作者信息 |

---

## 六、书籍点评

### `POST /review/list` — 书籍公开点评

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `bookId` | string | 是 | - | 书籍 ID |
| `reviewListType` | int | 否 | `0` | 筛选类型：0=全部, 1=推荐, 2=不行, 3=最新, 4=一般 |
| `count` | int | 否 | `20` | 每页数量 |
| `maxIdx` | int | 否 | `0` | 翻页偏移 |
| `synckey` | int | 否 | `0` | 翻页游标 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `synckey` | int | 翻页游标 |
| `reviewsCnt` | int | 点评总数 |
| `recentTotalCnt` | int | 最新点评数 |
| `reviewsHasMore` | int | 是否有更多（1=有） |
| `reviewsHas5Star` | int | 是否有五星推荐（1=有） |
| `reviewsHas1Star` | int | 是否有一星差评（1=有） |
| `reviewsHasRecent` | int | 是否有最新点评（1=有） |
| `friendCommentCount` | int | 好友点评数 |
| `friendUniqueCount` | int | 点评好友数 |
| `friendCommentUsers` | array | 点评好友信息 |
| `deepVRecommendInfo` | object | 资深会员推荐摘要（如 `{"title":"2337 个资深会员点评", ...}`） |
| `deepVRecommendValue` | int | 资深会员推荐比例（862 = 86.2%） |
| `deepVUniqueCount` | int | 点评资深会员数 |
| `reviews` | array | 点评数组 |

#### `reviews[].` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `idx` | int | 序号（用于翻页，下次 maxIdx 传最后一条的 idx） |
| `review` | object | 点评内容对象 |

#### `review.review` 嵌套结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `reviewId` | string | 点评 ID |
| `content` | string | 点评文本内容 |
| `htmlContent` | string | 点评 HTML 内容 |
| `star` | int | 评分（20=一星, 40=二星, 60=三星, 80=四星, 100=五星） |
| `isFinish` | bool | 是否读完此书 |
| `createTime` | int | 创建时间（Unix 时间戳） |
| `chapterName` | string | 所在章节名 |
| `author` | object | 评论者信息（userVid, name, avatar） |

### `POST /review/list/mine` — 个人在某书上的想法/笔记

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `bookid` | string | 是 | - | 书籍 ID（注意字段名全小写） |
| `synckey` | int | 否 | `0` | 翻页游标 |
| `count` | int | 否 | `20` | 每页数量 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `reviews` | array | 想法/点评数组 |
| `totalCount` | int | 总条数 |
| `hasMore` | int | 是否有更多（1=有） |
| `synckey` | int | 翻页游标 |
| `removed` | array | 已删除的 review ID 列表（增量同步用） |

#### `reviews[].review` 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `reviewId` | string | 唯一 ID |
| `content` | string | 内容文本 |
| `createTime` | int | 创建时间（Unix 时间戳） |
| `star` | int | 评分（0-5，-1=无评分） |
| `chapterName` | string | 所在章节名 |
| `isFinish` | bool | 是否读完 |

### `POST /review/single` — 单条想法详情

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `reviewId` | string | 是 | - | 想法/评论 ID |
| `commentsCount` | int | 否 | `10` | 拉取评论数量 |
| `commentsDirection` | int | 否 | `1` | 评论排序方向：0=倒序, 1=正序 |
| `likesCount` | int | 否 | `10` | 拉取点赞数量 |
| `likesDirection` | int | 否 | `0` | 点赞排序方向：0=倒序 |
| `synckey` | int | 否 | `0` | 增量同步 key |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `reviewId` | string | 想法 ID |
| `review` | object | 想法详情对象（content, bookId, chapterUid, createTime, author 等） |
| `htmlContent` | string | 富文本内容 |
| `synckey` | int | 同步 key |

---

## 七、推荐

### `POST /book/recommend` — 个性化推荐

基于用户阅读记录的个性化推荐，与 App 首页「为你推荐」一致。

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `count` | int | 否 | `12` | 每页数量 |
| `maxIdx` | int | 否 | `0` | 翻页偏移 |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `books` | array | 推荐书籍数组 |
| `books[].bookId` | string | 书籍 ID |
| `books[].title` | string | 书名 |
| `books[].author` | string | 作者 |
| `books[].cover` | string | 封面图 URL |
| `books[].intro` | string | 简介 |
| `books[].category` | string | 分类 |
| `books[].reason` | string | 推荐理由 |
| `books[].readingCount` | int | 在读人数 |
| `books[].searchIdx` | string | 结果序号（用于翻页） |
| `books[].newRating` | int | 评分（0-100） |
| `books[].newRatingCount` | int | 评分人数 |
| `books[].newRatingDetail` | object | 评分标签（如 `{"title":"神作"}`） |
| `books[].price` | int | 价格（分） |
| `books[].payType` | int | 付费类型 |
| `books[].type` | int | 书籍类型（0=电子书） |

#### 翻页

用最后一条的 `searchIdx` 作为下次的 `maxIdx`。

### `POST /book/similar` — 相似书推荐

基于某本书推荐相似书籍。

#### 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `bookId` | string | 是 | - | 书籍 ID |
| `count` | int | 否 | `12` | 每页数量 |
| `maxIdx` | int | 否 | `0` | 翻页偏移 |
| `sessionId` | string | 否 | - | 翻页会话 ID（首次不传，后续传回包中的值） |

#### 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `booksimilar` | object | 相似推荐对象 |
| `booksimilar.sessionId` | string | 会话 ID（翻页时传入下次请求） |
| `booksimilar.books` | array | 推荐书籍数组 |
| `booksimilar.books[].idx` | int | 结果序号 |
| `booksimilar.books[].book` | object | 书籍信息 |
| `booksimilar.books[].book.bookInfo` | object | 书籍信息（bookId, title, author, cover 等） |

#### 翻页

用最后一条的 `idx` 作为 `maxIdx`，带上 `sessionId`。

---

## 八、用户信息

### `POST /review/single` → 查看单条想法详情

（已在第六章列出）

### 用户阅读概况

通过组合以下接口获取用户阅读概况：

1. 书架：`/shelf/sync`
2. 阅读进度：对书架中的书调 `/book/getprogress`
3. 笔记：调 `/book/bookmarklist`
4. 阅读统计：`/readdata/detail`（`mode=overall`）

---

## 附录：评分映射表

`newRating` 字段为 0-100 的整数（千分制/百分制），与展示标签的对应关系：

| 评分范围 | 星级 | 标签 |
|---------|------|------|
| 90-100 | ⭐⭐⭐⭐⭐ | 神作 |
| 75-89 | ⭐⭐⭐⭐ | 力荐 |
| 55-74 | ⭐⭐⭐ | 推荐 |
| 35-54 | ⭐⭐ | 一般 |
| 0-34 | ⭐ | 不行 |

## 附录：深度链接 URL Schema

用于在微信读书 App 中打开对应位置。

### 打开书籍（跳转到上次阅读进度）

```
weread://reading?bId={bookId}
```

### 跳转到指定章节

```
weread://reading?bId={bookId}&chapterUid={chapterUid}
```

### 跳转到划线/想法所在位置

```
weread://bestbookmark?bookId={bookId}&chapterUid={chapterUid}&rangeStart={rangeStart}&rangeEnd={rangeEnd}&userVid={userVid}
```

> `range` 格式为 `"起始-结束"`（如 `"900-2004"`），拆分后分别填入 `rangeStart` 和 `rangeEnd`。

---

> 文档编制日期：2026-05-17 | 基于 Agent API Gateway v1.0.3
> 如需验证最新接口列表，发送 `{"api_name": "/_list", "skill_version": "1.0.3"}` 到网关
