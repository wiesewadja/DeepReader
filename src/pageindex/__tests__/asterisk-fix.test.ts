import { describe, it, expect } from 'vitest';
import { fixAbnormalAsterisks } from '../exporters/epub-to-obsidian.js';

describe('fixAbnormalAsterisks', () => {
    it('should fix dispersed single-char bold pattern', () => {
        const input = '观**念**检**核**与**实**践';
        const expected = '**观念检核与实践**';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should fix consecutive single-char bold pattern', () => {
        const input = '1**.**思**维**的**三**个**层**次';
        const expected = '**1.思维的三个层次**';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should fix mixed pattern: 用**证**据**支**持**观**点', () => {
        const input = '用**证**据**支**持**观**点';
        const expected = '**用证据支持观点**';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should NOT fix normal multi-char bold', () => {
        const input = '这是**正常加粗**文本';
        const expected = '这是**正常加粗**文本';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should NOT fix lines with fewer than 3 single-char bolds', () => {
        const input = '只有**两**个**字**加粗';
        const expected = '只有**两**个**字**加粗';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should skip heading lines', () => {
        const input = '# **这**是**标**题';
        const expected = '# **这**是**标**题';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should skip code block markers', () => {
        const input = '```**代**码**块**```';
        const expected = '```**代**码**块**```';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should handle multiple lines', () => {
        const input = '观**念**检**核**与**实**践\n这是**正常加粗**文本\n1**.**思**维**的**三**个**层**次';
        const expected = '**观念检核与实践**\n这是**正常加粗**文本\n**1.思维的三个层次**';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should handle line with mixed normal and abnormal patterns', () => {
        const input = '正常**加粗**观**念**检**核**';
        // 混合了 "加粗" (2字符) 和单字符加粗，整体修正为加粗是合理的
        const expected = '**正常加粗观念检核**';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
    
    it('should handle empty lines', () => {
        const input = '';
        const expected = '';
        expect(fixAbnormalAsterisks(input)).toBe(expected);
    });
});