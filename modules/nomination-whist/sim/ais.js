// The AIs the simulations can use: everything the live game has, plus the learned ones that are not offered to players
// yet (give an AI a weight above 0 and add it to ../ai/index.js to ship it).
import { defineAIs } from '../../../shared/ai.js';
import { AIS } from '../ai/index.js';
import { lut } from '../ai/lut.js';

export const SIM_AIS = defineAIs([...AIS, lut]);
