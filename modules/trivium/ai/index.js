// Trivium's computer players.  Each one is a file of its own beside this; adding another is dropping a file in and
// putting it in this list.  The first entry is the fallback a room falls back to when its saved AI id is unknown, so
// `standard` stays where it is.
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import swot from './swot.js';
import quickfire from './quickfire.js';
import chancer from './chancer.js';
import ditherer from './ditherer.js';

export const AIS = defineAIs([standard, swot, quickfire, chancer, ditherer]);
