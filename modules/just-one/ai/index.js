// The Just One computer players. Each AI is a plain object { id, name, description, weight } with three decision functions
// that take plain data and return a plain answer (see MODULES.md, "Computer players"):
//
//   clue({ word, related }, rng)      -> the clue text (word is the secret word, which a writer knows)
//   guess({ clues, words }, rng)      -> a word from `words`, or '' to pass (clues are what the guesser can see, never the word)
//   best({ word, clues }, rng)        -> the index in `clues` of the best hint (word is the one they have just guessed)
//
// The first entry is the fallback.
import { defineAIs } from '../../../shared/ai.js';
import random from './random.js';
import standard, { adventurous } from './standard.js';

export const AIS = defineAIs([standard, adventurous, random]);
