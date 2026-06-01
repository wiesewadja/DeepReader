/**
 * Core 9 场景注册表
 *
 * Slice 1: 仅含 S-RES
 * 后续 slice 增量添加: S-LD, S-CMD, S-22, S-23, S-17, S-25, S-30, S-24
 */

import sRes from './s-res.mjs';
import sCmd from './s-cmd.mjs';
import s22 from './s-22.mjs';
import s23 from './s-23.mjs';
import s25 from './s-25.mjs';
import sLd from './s-ld.mjs';
import s17 from './s-17.mjs';
import s30 from './s-30.mjs';
import s24 from './s-24.mjs';

export const coreChecks = [
	sRes,
	sCmd,
	s22,
	s23,
	s25,
	sLd,
	s17,
	s30,
	s24,
];
