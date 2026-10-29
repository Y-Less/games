// The Wavelength computer players. Each AI is a plain object { id, name, description, weight } with two decision
// functions that take plain data and return a plain answer (see MODULES.md, "Computer players"):
//
//   clue({ target, anchors }, rng)  -> the clue text (target is the psychic's own secret position, 0 to 100)
//   guess({ clue, anchors }, rng)   -> a position from 0 to 100 (clue is what everybody can see, never the target)
//
// `anchors` are the example clues of the spectrum, [{ position, text }]. The first entry is the fallback.
import { defineAIs } from '../../../shared/ai.js';
import random from './random.js';
import standard, { wobbly } from './standard.js';

export const AIS = defineAIs([standard, wobbly, random]);
