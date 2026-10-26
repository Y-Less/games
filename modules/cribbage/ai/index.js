// The cribbage computer players. `standard` is first: it is the fallback for rooms saved before AIs existed.
import { defineAIs } from '../../../shared/ai.js';
import { balanced } from './balanced.js';
import { greedy } from './greedy.js';
import { pegger } from './pegger.js';
import { random } from './random.js';
import { sharp } from './sharp.js';
import { standard } from './standard.js';

export const AIS = defineAIs([standard, random, greedy, balanced, pegger, sharp]);
export { chooseDiscard, choosePlay, cribPotential } from './standard.js';
