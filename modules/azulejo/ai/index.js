// The Azulejo computer players, from the best to "any legal move". `standard` must stay first: rooms saved before AIs
// existed (and any unknown id) fall back to the first entry through aiById.
//
// An AI is { id, name, description, weight, chooseMove(state, seat, moves, rng), chooseColumn(state, seat, pending, rng) };
// see common.js for the plain-data `state` they receive.
// Depends on: shared/ai.js (defineAIs) and one module per AI in this folder.
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import sharp from './sharp.js';
import greedy from './greedy.js';
import rowFinisher from './row-finisher.js';
import colourCollector from './colour-collector.js';
import denier from './denier.js';
import random from './random.js';

// The registry the game and the server use: the list of AIs (in strength order) with their selection weights checked by defineAIs.
export const AIS = defineAIs([standard, sharp, greedy, rowFinisher, colourCollector, denier, random]);
