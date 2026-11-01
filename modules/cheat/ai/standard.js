// The Cheat computer players that think. They differ in how readily they cheat and how readily they call:
//
//   play({ hand, rank, pileSize, handSizes, decks, maxPlay, rng, ... })  -> one to four cards from the hand
//   call({ hand, last, pileSize, handSizes, decks, final, rng, ... })    -> true to call "Cheat!" on the last play
//
// The random numbers come inside the context (ctx.rng), as in every other game's AIs; nothing is passed as a second argument.
// An honest play puts down every card of the rank claimed (up to four). With none, a player must cheat, and puts down the
// cards that are cheapest to lose. Calling is certain when the last play claims more cards than can exist outside the caller's
// own hand; otherwise it is a matter of how big the claim is, how big the pile is that a wrong call would pick up, and whether
// the player who made it is nearly out. Depends on ./lib.js only.
import { impossible, junk, ofRank } from './lib.js';

/**
 * Builds one of the thinking computer players from a few personality dials.
 *
 * @param {object} spec  the player definition
 * @param {string} spec.id  stable identifier
 * @param {string} spec.name  display name
 * @param {string} spec.description  one-line description shown to players
 * @param {number} spec.weight  how often it is picked when seats are filled at random
 * @param {number} [spec.cheats=0]  0..1, how readily it cheats even when it holds the right cards
 * @param {number} [spec.eager=1]  multiplier on the probability of calling "Cheat!"
 * @returns {{id: string, name: string, description: string, weight: number, play: Function, call: Function}} the AI object
 * Side effects: none (the returned play and call functions advance the rng they are given).
 */
export function makeThinker({ id, name, description, weight, cheats = 0, eager = 1 }) {
  return {
    id,
    name,
    description,
    weight,
    // Chooses the cards to play: honest when it holds the rank (with an occasional spare card slipped in by cheats), else the cheapest junk.
    play: ({ hand, rank, maxPlay, rng }) => {
      const honest = ofRank(hand, rank).slice(0, maxPlay);
      if (honest.length) {
        // A cheat sometimes slips a spare card in with the true ones.
        if (cheats && honest.length < maxPlay && hand.length > honest.length && rng() < cheats * 0.6) return [...honest, ...junk(hand.filter((c) => !honest.includes(c)), 1, rng)];
        return honest;
      }
      const howMany = cheats && hand.length > 3 && rng() < cheats ? 2 : 1;
      return junk(hand, howMany, rng);
    },
    // Decides whether to call: always when the claim is impossible, else a probability that grows with the claim size and with an
    // opponent close to going out, shrinks with the pile (a wrong call picks it up), and jumps in the final check.
    call: (ctx) => {
      if (impossible(ctx)) return true;
      const { last, pileSize, handSizes, final, rng } = ctx;
      let p = 0.05 + 0.09 * (last.count - 1);
      if (handSizes[last.seat] <= 2) p += 0.15;
      if (final) p += 0.45; // they win unless somebody speaks now
      else p *= 1 / (1 + pileSize / 14); // a wrong call picks the pile up
      return rng() < Math.min(0.95, p * eager);
    },
  };
}

export const standard = makeThinker({
  id: 'standard',
  name: 'Standard',
  description: 'Plays honestly when it can, cheats cheaply when it must, and calls when a play cannot be true or looks too good to be.',
  weight: 3,
});

export const suspicious = makeThinker({
  id: 'suspicious',
  name: 'Suspicious',
  description: 'Calls often, even when the pile is big.',
  weight: 2,
  eager: 2.2,
});

export const bluffer = makeThinker({
  id: 'bluffer',
  name: 'Bluffer',
  description: 'Gets rid of cards fast by cheating even when it holds the right ones.',
  weight: 2,
  cheats: 0.7,
  eager: 0.8,
});

export default standard;
