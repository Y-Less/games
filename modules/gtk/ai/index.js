// The GTK computer players.  Each AI is a plain object { id, name, description, weight } with two decision functions
// that take plain data and return a plain answer (see MODULES.md, "Computer players"):
//
//   write({ pool, offset }, rng)   -> the answer text it writes (its own, or a made-up one; it never knows which
//                                     answers the others have written)
//   pick({ options }, rng)         -> the index in `options` of the answer it believes is the true one (`options` holds
//                                     only the answers that seat is allowed to pick, as text)
//
// The first entry is the fallback (what the computer players did before there were AIs to choose between).
// Depends on: shared/ai.js (defineAIs) and the strategies in random.js and standard.js.
import { defineAIs } from '../../../shared/ai.js';
import random from './random.js';
import standard, { sharp } from './standard.js';

export const AIS = defineAIs([standard, sharp, random]);
