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

// adm-zip 是 `export =` 构造器：typeof import("adm-zip") 才是构造器类型（export= 模块特性）。
type AdmZipCtor = typeof import("adm-zip");
/** adm-zip 实例类型（供业务代码标注 `zip: AdmZip` 用） */
export type AdmZip = InstanceType<AdmZipCtor>;

let _admZip: AdmZipCtor | null = null;

/** 惰性加载 adm-zip（避免其顶层 require fs/path 在移动端加载期触发） */
export function nodeAdmZip(): AdmZipCtor {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return (_admZip ??= require("adm-zip"));
}
