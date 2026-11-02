// The Scribblers computer players.  Adding one: drop a file in this folder that exports an AI object and add it to the
// list below (see MODULES.md, "Computer players").  'standard' must stay first: it is what a computer player without a
// recorded AI uses.
//
// An AI is { id, name, description, weight, chooseWord(ctx), guess(ctx) }.
//   chooseWord(ctx) returns which of the words offered to draw, as its place in ctx.choices.
//   guess(ctx) returns a word to guess, or null if it can think of nothing.
// The context is plain data built by game.js (aiContext): choices (only when it is drawing), hints as that seat is
// allowed to see them, words (the game's own list), tried (its own guesses this turn), seen (everybody's wrong guesses
// this turn, which the panel shows anyway) and rng.  The word being drawn is never in it.
//
// What a computer player *draws* is not decided here: a picture has to be fetched from the web, which no AI may do.
// The socket layer does that (server.js and picture.js) once an AI has chosen the word.
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import sharp from './sharp.js';
import hopeful from './hopeful.js';
import random from './random.js';

export const AIS = defineAIs([standard, sharp, hopeful, random]);
