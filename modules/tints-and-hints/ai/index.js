// The Tints and Hints computer players. Each AI is a plain object { id, name, description, weight } with two decision
// functions that take plain data and return a plain answer (see MODULES.md, "Computer players"):
//
//   hint({ round, tint }, rng)       -> the hint text (tint is the hinter's own secret square: the only secret it has)
//   guess({ round, cells, hints, guesses }, rng) -> one of `cells` (every legal square; hints and guesses are what that
//                                       seat can see, so never the secret tint)
import { defineAIs } from '../../../shared/ai.js';
import random from './random.js';

export const AIS = defineAIs([random]);
