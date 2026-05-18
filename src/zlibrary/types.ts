/**
 * Z-Library EAPI 类型定义
 */

export interface ZLibraryBook {
	id: number;
	hash: string;
	title: string;
	author: string;
	extension: string;
	filesize: number;
	filesizeString: string;
	cover?: string;
	year?: number;
	language?: string;
	publisher?: string;
	pages?: number;
	isbn?: string;
	md5?: string;
	description?: string;
	interestScore?: string;
	qualityScore?: string;
}

export interface SearchOptions {
	exact?: boolean;
	limit?: number;
	page?: number;
	yearFrom?: number;
	yearTo?: number;
	languages?: string[];
	extensions?: string[];
	order?: 'newest' | 'popular' | 'title';
}

export interface SearchResult {
	books: ZLibraryBook[];
	total: number;
	page: number;
	totalPages: number;
}

export interface DownloadInfo {
	downloadLink: string;
	description: string;
	extension: string;
}

export interface UserProfile {
	userId: number;
	email: string;
	downloadsTodayLimit: number;
	downloadsTodayLeft: number;
	isPremium: boolean;
}
