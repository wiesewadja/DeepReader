/**
 * 移动端兼容门面：需要懒加载的模块统一入口。
 *
 * 背景：移动端 Capacitor Obsidian 无完整 Node polyfill（见 node-fs.ts 的三条约束）。
 *   除 Node 核心模块外，某些第三方库（如 adm-zip）在自身模块顶层 `require("fs")`/`"path"`，
 *   若被业务代码静态 `import`，esbuild 会把它们打进 main bundle 并在加载阶段求值，
 *   触发其顶层 Node require → 移动端加载即崩。
 *
 * 解法：业务代码不再静态 import 这类库，改走本门面的惰性工厂——加载阶段不触发，
 * 仅在实际调用（桌面端索引/解压路径）时才 require。移动端不会走到这些路径，故永不触发。
 *
 * ⚠️ 新增需要懒加载的库请统一加到这里，不要在业务文件里再贴 require 样板。
 *    业务文件禁止 `import X from "adm-zip"`（静态），统一用 `nodeAdmZip()`。
 */

// ─── Node 核心模块惰性工厂 ────────────────────────────────────────
// 移动端 Capacitor 无完整 Node polyfill（见 node-fs.ts / .project-rules/08-mobile-compat.md）。
// 业务代码访问 Node 核心模块统一走这里的工厂：
//   1. 加载阶段不触发（顶层无 Node import）→ 移动端加载不崩
//   2. 调用阶段才 require → 移动端靠"永不走到该代码路径"双轨规避
// 业务文件禁止再贴本地 getX() { return require(...) } 样板，统一从这里 import。
//
// ⚠️ fs/promises 子路径在移动端 polyfill 不保证可用 → nodeFsPromises 仅桌面端调用路径可用。
// ⚠️ child_process 移动端完全没有 → nodeChildProcess 仅桌面端调用路径可用。

type AdmZipCtor = typeof import("adm-zip");
type FsSyncModule = typeof import("fs");
type FsPromisesModule = typeof import("fs/promises");
type PathModule = typeof import("path");
type CryptoModule = typeof import("crypto");
type OsModule = typeof import("os");
type ChildProcessModule = typeof import("child_process");
type HttpsModule = typeof import("https");

/** adm-zip 实例类型（供业务代码标注 `zip: AdmZip` 用） */
export type AdmZip = InstanceType<AdmZipCtor>;

let _admZip: AdmZipCtor | null = null;
let _fsSync: FsSyncModule | null = null;
let _fsPromises: FsPromisesModule | null = null;
let _path: PathModule | null = null;
let _crypto: CryptoModule | null = null;
let _os: OsModule | null = null;
let _childProcess: ChildProcessModule | null = null;
let _https: HttpsModule | null = null;

/** 惰性加载 adm-zip（避免其顶层 require fs/path 在移动端加载期触发） */
export function nodeAdmZip(): AdmZipCtor {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_admZip ??= require("adm-zip"));
}

/** 惰性加载同步 fs（fs sync 版：existsSync/mkdirSync/readFileSync 等） */
export function nodeFsSync(): FsSyncModule {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_fsSync ??= require("fs"));
}

/** 惰性加载 fs/promises（与 node-fs.ts 同语义；移动端 polyfill 不保证可用，仅桌面端路径调用） */
export function nodeFsPromises(): FsPromisesModule {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_fsPromises ??= require("fs/promises"));
}

/** 惰性加载 path（裸名在移动端 polyfill 可用，但保持门面一致性） */
export function nodePath(): PathModule {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_path ??= require("path"));
}

/** 惰性加载 crypto（移动端不保证可用，仅桌面端路径调用） */
export function nodeCrypto(): CryptoModule {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_crypto ??= require("crypto"));
}

/** 惰性加载 os（移动端不保证可用，仅桌面端路径调用） */
export function nodeOs(): OsModule {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_os ??= require("os"));
}

/** 惰性加载 child_process（移动端完全没有，仅桌面端路径调用） */
export function nodeChildProcess(): ChildProcessModule {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_childProcess ??= require("child_process"));
}

/** 惰性加载 https（桌面端用于绕过 CORS 的流式请求；移动端不保证可用） */
export function nodeHttps(): HttpsModule {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_https ??= require("https"));
}
