// The Dixnt computer players. Each AI is a plain object { id, name, description, weight } plus three decision
// functions that take plain data and return a plain answer, so they work the same in the bot process, in a test and
// anywhere else. None of them touches the network, the clock or Math.random: the `rng` argument is the only randomness.
//
//   chooseWord({ hints: string[], hand: number[], cards, round, judging }, rng)           -> one of `hints`
//   playCard({ word: string | null, hand: number[], cards, round, judging }, rng)         -> one of `hand`
//        (word is null when this player is the imposter and cannot see the clue)
//   vote({ word, table: [{ playerId, cardId }], targets: string[], me, imposter: boolean,
//          chooser: boolean, judging, cards, scores: { [playerId]: number } }, rng)       -> one of `targets`
//        (spotting the imposter; in the 'favourite' style it is the chooser picking the best card)
//
// `cards` is the card metadata (see cards.js): categories only, since that is all the site knows about its cards.
import { defineAIs } from '../../../shared/ai.js';
import { contrarian } from './contrarian.js';
import { literal } from './literal.js';
import { random } from './random.js';
import { sharp } from './sharp.js';
import { standard } from './standard.js';

export const AIS = defineAIs([standard, random, literal, contrarian, sharp]);
export { buildCardInfo, NO_CARDS } from './cards.js';
