// The computer players' logics for Rummikub. Each has { id, name, description, weight, plan(room, seat, options) } where
// plan returns { table, added } (the whole proposed table) or null to draw. 'standard' must stay first: it is what rooms
// saved before there were several AIs fall back to.
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import shuffler5 from './shuffler-5.js';
import shuffler10 from './shuffler-10.js';
import shuffler20 from './shuffler-20.js';
import sharp from './sharp.js';
import random from './random.js';

export const AIS = defineAIs([standard, shuffler5, shuffler10, shuffler20, sharp, random]);
