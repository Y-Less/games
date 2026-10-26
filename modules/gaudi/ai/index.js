// The Gaudi computer players, from the original to "any legal placement". `standard` must stay first: rooms saved before
// AIs existed (and any unknown id) fall back to the first entry through aiById.
//
// An AI is { id, name, description, weight, chooseWindow(options, rng), chooseStep(state, seat, rng) }; see common.js
// for the plain-data `state` they receive and the three kinds of step they return.
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import sharp from './sharp.js';
import privateChaser from './private-chaser.js';
import publicHunter from './public-hunter.js';
import tidy from './tidy.js';
import toolUser from './tool-user.js';
import random from './random.js';

export const AIS = defineAIs([standard, sharp, privateChaser, publicHunter, tidy, toolUser, random]);
