// The Cheat computer players.  Each AI is a plain object { id, name, description, weight } with two decision functions that
// take plain data and return a plain answer (see MODULES.md, "Computer players"):
//
//   play(ctx)  -> one to four cards from ctx.hand, claimed as ctx.rank
//   call(ctx)  -> true to call "Cheat!" on ctx.last (in the final check, ctx.final, false is "I believe you")
//
// The context holds only what the seat may know, plus the game's rng as ctx.rng (see aiContext in game.js).  The first
// entry is the fallback.
import { defineAIs } from '../../../shared/ai.js';
import random from './random.js';
import standard, { bluffer, suspicious } from './standard.js';

export const AIS = defineAIs([standard, suspicious, bluffer, random]);
