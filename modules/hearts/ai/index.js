// The Hearts computer players. Adding one: drop a file in this folder that exports an AI object and add it to the list
// below (see MODULES.md, "Computer players"). 'standard' must stay first: it is what a bot without a recorded AI uses.
//
// An AI is { id, name, description, weight, choosePass(ctx), choosePlay(ctx), bidsMoon?(ctx) }.
//   choosePass(ctx) returns three cards from ctx.hand.
//   choosePlay(ctx) returns one of ctx.legal.
// The context is plain data built by game.js (aiContext): seat, hand, legal, trick [{ seat, card }] (the plays so far),
// history [{ plays, winner }] (finished tricks of this hand), taken (cards won per seat), scores, settings
// { target, jackOfDiamonds, moon }, heartsBroken, tricksPlayed, handNumber, direction, passed, received, moonBid and rng.
// Nothing about other players' hands is ever in it.
import { defineAIs } from '../../../shared/ai.js';
import standard from './standard.js';
import sharp from './sharp.js';
import moon from './moon.js';
import jack from './jack.js';
import avoider from './avoider.js';
import random from './random.js';

export const AIS = defineAIs([standard, sharp, moon, jack, avoider, random]);
