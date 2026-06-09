/**
 * Core 冒烟场景注册表
 */

import sRes from './s-res.mjs';
import sCmd from './s-cmd.mjs';
import s22 from './s-22.mjs';
import s23 from './s-23.mjs';
import s25 from './s-25.mjs';
import sLd from './s-ld.mjs';
import s17 from './s-17.mjs';
import s24 from './s-24.mjs';
import sRpAnti from '../S-RP-ANTI.check.mjs';
import sSec from './s-sec.mjs';

export const coreChecks = [
	sRes,
	sCmd,
	s22,
	s23,
	s25,
	sLd,
	s17,
	s24,
	sRpAnti,
	sSec,
];
