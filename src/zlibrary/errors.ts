export type ErrorCode =
	| 'LOGIN_FAILED'
	| 'NETWORK_ERROR'
	| 'DOMAIN_UNAVAILABLE'
	| 'DOWNLOAD_FAILED'
	| 'RATE_LIMITED'
	| 'AUTH_EXPIRED';

export class ZLibraryError extends Error {
	constructor(
		message: string,
		public readonly code: ErrorCode,
		public readonly statusCode?: number,
	) {
		super(message);
		this.name = 'ZLibraryError';
	}
}
