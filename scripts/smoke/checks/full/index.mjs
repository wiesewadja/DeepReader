/**
 * Full 14 增量场景注册表
 *
 * Core 9 + Full 14 = 23 个场景
 * 已删除: S-07 (重复 S-22)、S-09 (需 LLM)、S-31 (需 PI 任务)
 */

import s01 from './s-01.mjs';
import s02 from './s-02.mjs';
import s04 from './s-04.mjs';
import s11 from './s-11.mjs';
import s12 from './s-12.mjs';
import s19 from './s-19.mjs';
import s20 from './s-20.mjs';
import s21 from './s-21.mjs';
import s26 from './s-26.mjs';
import s27 from './s-27.mjs';
import s29 from './s-29.mjs';
import s32 from './s-32.mjs';
import s34 from './s-34.mjs';

export const fullChecks = [
	s01,
	s02,
	s04,
	s11,
	s12,
	s19,
	s20,
	s21,
	s26,
	s27,
	s29,
	s32,
	s34,
];
