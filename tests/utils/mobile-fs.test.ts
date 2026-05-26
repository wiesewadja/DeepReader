/**
 * mobile-fs.ts 单元测试
 * 验证跨平台文件系统工具函数
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock obsidian module
vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, ''),
}));

import {
	joinPath,
	basename,
	sha256Hex,
	vaultRead,
	vaultReadBinary,
	vaultExists,
	vaultList,
	vaultMkdir,
	vaultRemove,
	vaultWrite,
	vaultWriteBinary,
	resolveBookIdFromPdf,
} from '../../src/utils/mobile-fs.js';

// Mock App with vault adapter
function createMockApp(adapterOverrides: Record<string, any> = {}) {
	return {
		vault: {
			adapter: {
				read: vi.fn().mockResolvedValue('file content'),
				readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
				write: vi.fn().mockResolvedValue(undefined),
				writeBinary: vi.fn().mockResolvedValue(undefined),
				exists: vi.fn().mockResolvedValue(true),
				list: vi.fn().mockResolvedValue({ files: ['a.md'], folders: ['sub'] }),
				mkdir: vi.fn().mockResolvedValue(undefined),
				remove: vi.fn().mockResolvedValue(undefined),
				stat: vi.fn().mockResolvedValue({}),
				...adapterOverrides,
			},
		},
	} as any;
}

describe('mobile-fs: joinPath', () => {
	it('拼接多个路径段', () => {
		expect(joinPath('.pageindex', 'abc123', 'tree.json'))
			.toBe('.pageindex/abc123/tree.json');
	});

	it('处理空段', () => {
		expect(joinPath('a', '', 'b')).toBe('a/b');
	});

	it('处理尾部斜杠', () => {
		expect(joinPath('a/', 'b')).toBe('a/b');
	});

	it('处理双斜杠', () => {
		expect(joinPath('a//b', 'c')).toBe('a/b/c');
	});

	it('单段路径直接返回', () => {
		expect(joinPath('file.txt')).toBe('file.txt');
	});
});

describe('mobile-fs: basename', () => {
	it('提取文件名', () => {
		expect(basename('.pageindex/abc/tree.json')).toBe('tree.json');
	});

	it('移除扩展名', () => {
		expect(basename('.pageindex/abc/tree.json', '.json')).toBe('tree');
	});

	it('无路径分隔符时返回自身', () => {
		expect(basename('file.txt')).toBe('file.txt');
	});

	it('路径末尾无扩展名匹配时不变', () => {
		expect(basename('a/b.md', '.json')).toBe('b.md');
	});
});

describe('mobile-fs: sha256Hex', () => {
	it('计算字符串的 SHA-256 哈希', async () => {
		// "hello" 的 SHA-256 = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
		const hash = await sha256Hex('hello');
		expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
	});

	it('空字符串的哈希', async () => {
		const hash = await sha256Hex('');
		expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
	});

	it('中文内容的哈希', async () => {
		const hash = await sha256Hex('你好');
		expect(hash).toHaveLength(64); // SHA-256 输出 64 个十六进制字符
	});
});

describe('mobile-fs: vaultRead', () => {
	it('通过 vault.adapter.read 读取文件', async () => {
		const app = createMockApp();
		const content = await vaultRead(app, '.pageindex/abc/tree.json');
		expect(content).toBe('file content');
		expect(app.vault.adapter.read).toHaveBeenCalledWith('.pageindex/abc/tree.json');
	});

	it('路径经过 normalizePath', async () => {
		const app = createMockApp();
		await vaultRead(app, '.pageindex//abc///tree.json');
		expect(app.vault.adapter.read).toHaveBeenCalledWith('.pageindex/abc/tree.json');
	});
});

describe('mobile-fs: vaultReadBinary', () => {
	it('通过 vault.adapter.readBinary 读取二进制文件', async () => {
		const app = createMockApp();
		const data = await vaultReadBinary(app, 'audio.wav');
		expect(data).toBeInstanceOf(ArrayBuffer);
		expect(app.vault.adapter.readBinary).toHaveBeenCalledWith('audio.wav');
	});
});

describe('mobile-fs: vaultExists', () => {
	it('文件存在时返回 true', async () => {
		const app = createMockApp();
		expect(await vaultExists(app, 'file.txt')).toBe(true);
	});

	it('文件不存在时返回 false', async () => {
		// Obsidian adapter.stat() 对不存在的路径返回 null
			const app = createMockApp({ stat: vi.fn().mockResolvedValue(null) });
		expect(await vaultExists(app, 'missing.txt')).toBe(false);
	});
});

describe('mobile-fs: vaultList', () => {
	it('列出目录内容', async () => {
		const app = createMockApp();
		const result = await vaultList(app, '.pageindex');
		expect(result.files).toEqual(['a.md']);
		expect(result.folders).toEqual(['sub']);
		expect(app.vault.adapter.list).toHaveBeenCalledWith('.pageindex');
	});
});

describe('mobile-fs: vaultMkdir', () => {
	it('创建目录', async () => {
		const app = createMockApp();
		await vaultMkdir(app, 'new/dir');
		expect(app.vault.adapter.mkdir).toHaveBeenCalledWith('new/dir');
	});
});

describe('mobile-fs: vaultRemove', () => {
	it('删除文件', async () => {
		const app = createMockApp();
		await vaultRemove(app, 'old.txt');
		expect(app.vault.adapter.remove).toHaveBeenCalledWith('old.txt');
	});
});

describe('mobile-fs: vaultWrite', () => {
	it('写入文本文件', async () => {
		const app = createMockApp();
		await vaultWrite(app, 'test.txt', 'hello');
		expect(app.vault.adapter.write).toHaveBeenCalledWith('test.txt', 'hello');
	});
});

describe('mobile-fs: vaultWriteBinary', () => {
	it('写入二进制文件', async () => {
		const app = createMockApp();
		const data = new Uint8Array([1, 2, 3]);
		await vaultWriteBinary(app, 'test.bin', data);
		expect(app.vault.adapter.writeBinary).toHaveBeenCalledWith('test.bin', data);
	});
});

describe('mobile-fs: resolveBookIdFromPdf', () => {
	it('找到书籍文件时返回 bookId', async () => {
		const app = {
			vault: {
				adapter: { basePath: '/vault' },
				getFiles: vi.fn().mockReturnValue([
					{ path: 'books/test.pdf', extension: 'pdf' },
				]),
			},
		} as any;
		const bookId = await resolveBookIdFromPdf(app, 'test.pdf');
		expect(bookId).toBeTruthy();
		expect(bookId).toHaveLength(8);
	});

	it('未找到书籍文件时返回 null', async () => {
		const app = {
			vault: {
				adapter: { basePath: '/vault' },
				getFiles: vi.fn().mockReturnValue([
					{ path: 'books/other.pdf', extension: 'pdf' },
				]),
			},
		} as any;
		const bookId = await resolveBookIdFromPdf(app, 'nonexist.pdf');
		expect(bookId).toBeNull();
	});

	it('移动端无 basePath 时用 vault 相对路径哈希', async () => {
		const app = {
			vault: {
				adapter: { basePath: undefined },
				getFiles: vi.fn().mockReturnValue([
					{ path: 'books/test.pdf', extension: 'pdf' },
				]),
			},
		} as any;
		const bookId = await resolveBookIdFromPdf(app, 'test.pdf');
		expect(bookId).toBeTruthy();
		expect(bookId).toHaveLength(8);
	});
});
