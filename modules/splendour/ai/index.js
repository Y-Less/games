// Every Splendour AI.  The first one is the fallback for rooms saved before AIs existed (see shared/ai.js, aiById), so it
// must stay the original standard player.
//
// Depends on: ../../../shared/ai.js (defineAIs) and every strategy file in this folder.
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import random from './random.js';
import nobleHunter from './noble-hunter.js';
import engineBuilder from './engine-builder.js';
import rusher from './rusher.js';
import blocker from './blocker.js';
import sharp from './sharp.js';

/** Every Splendour AI, in the order of the list above (index 0 is the fallback). */
export const AIS = defineAIs([standard, sharp, nobleHunter, engineBuilder, rusher, blocker, random]);
