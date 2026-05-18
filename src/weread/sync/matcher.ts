/**
 * 书籍匹配器 — 微信读书书籍与 DeepReader 已索引书籍的模糊匹配
 *
 * 匹配规则：
 * 1. 标题归一化后必须匹配（包含关系或完全相等）
 * 2. 作者归一化后至少有一个名字重合；若任一侧作者为空则宽松通过
 */

export interface IndexedBook {
    bookId: string;
    title: string;
    author: string;
}

export interface WereadBookSummary {
    bookId: string;
    title: string;
    author: string;
}

export interface MatchResult {
    wereadBookId: string;
    wereadTitle: string;
    deepReaderBookId: string;
    deepReaderTitle: string;
    matched: boolean;
}

/**
 * 标题归一化：
 * - 移除所有空格
 * - 移除括号内容：（...）、(...)、【...】
 * - 移除中英文标点
 * - 转小写
 */
export function normalizeTitle(title: string): string {
    return title
        // 移除括号及其内容（中文圆括号、英文圆括号、【】）
        .replace(/（[^）]*）/g, '')
        .replace(/\([^)]*\)/g, '')
        .replace(/【[^】]*】/g, '')
        // 移除中英文标点
        .replace(/[，。！？：；""''【】《》、·—…\-\.,!?;:'"()\[\]{}<>\/\\@#$%^&*+=~`|]/g, '')
        // 移除所有空格
        .replace(/\s+/g, '')
        // 转小写
        .toLowerCase();
}

/**
 * 作者归一化：
 * - 移除国家前缀 [美]、【英】 等
 * - 移除括号内容
 * - 移除中英文标点
 * - 移除空格
 * - 转小写
 */
export function normalizeAuthor(author: string): string {
    return author
        // 移除国家前缀 [xxx] 和 【xxx】
        .replace(/\[[^\]]*\]/g, '')
        .replace(/【[^】]*】/g, '')
        // 移除括号及其内容
        .replace(/（[^）]*）/g, '')
        .replace(/\([^)]*\)/g, '')
        // 移除中英文标点
        .replace(/[，。！？：；""''【】《》、·—…\-\.,!?;:'"()\[\]{}<>\/\\@#$%^&*+=~`|]/g, '')
        // 移除所有空格
        .replace(/\s+/g, '')
        // 转小写
        .toLowerCase();
}

/**
 * 检查两个归一化作者名是否有重合
 * - 将归一化后的字符串拆分为单个名字（按常见分隔符）
 * - 至少有一个名字完全匹配
 * - 若任一侧为空，宽松通过
 */
function authorsOverlap(authorA: string, authorB: string): boolean {
    const normA = normalizeAuthor(authorA);
    const normB = normalizeAuthor(authorB);

    // 宽松：任一侧作者为空则通过
    if (!normA || !normB) return true;

    // 拆分名字：按常见分隔符（逗号、分号、顿号等已在归一化中被移除，
    // 所以归一化后的作者名是连在一起的）
    // 直接比较整个归一化字符串
    if (normA === normB) return true;

    // 一侧包含另一侧（处理 "IanGoodfellow" vs "IanGoodfellowYoshuaBengio" 的情况）
    if (normA.includes(normB) || normB.includes(normA)) return true;

    return false;
}

/**
 * 检查两个归一化标题是否匹配
 * - 完全相等，或一方包含另一方
 */
function titlesMatch(titleA: string, titleB: string): boolean {
    const normA = normalizeTitle(titleA);
    const normB = normalizeTitle(titleB);

    if (!normA || !normB) return false;

    return normA === normB || normA.includes(normB) || normB.includes(normA);
}

/**
 * 将微信读书书籍与 DeepReader 已索引书籍进行匹配
 *
 * @param wereadBooks - 微信读书书籍列表
 * @param indexedBooks - DeepReader 已索引书籍列表
 * @returns 匹配结果数组
 */
export function matchBooks(
    wereadBooks: WereadBookSummary[],
    indexedBooks: IndexedBook[],
): MatchResult[] {
    return wereadBooks.map(wereadBook => {
        // 查找第一个标题匹配且作者有重叠的索引书籍
        const matchedIndexed = indexedBooks.find(indexed =>
            titlesMatch(wereadBook.title, indexed.title) &&
            authorsOverlap(wereadBook.author, indexed.author),
        );

        if (matchedIndexed) {
            return {
                wereadBookId: wereadBook.bookId,
                wereadTitle: wereadBook.title,
                deepReaderBookId: matchedIndexed.bookId,
                deepReaderTitle: matchedIndexed.title,
                matched: true,
            };
        }

        return {
            wereadBookId: wereadBook.bookId,
            wereadTitle: wereadBook.title,
            deepReaderBookId: '',
            deepReaderTitle: '',
            matched: false,
        };
    });
}
