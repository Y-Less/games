// The Nomination Whist computer players. `standard` is first: it is the fallback for rooms saved before AIs existed.
import { defineAIs } from '../../../shared/ai.js';
import { cautious } from './cautious.js';
import { counter } from './counter.js';
import { optimist } from './optimist.js';
import { random } from './random.js';
import { sharp } from './sharp.js';
import { standard } from './standard.js';

export const AIS = defineAIs([standard, random, cautious, optimist, counter, sharp]);
