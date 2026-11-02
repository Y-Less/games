// A test bench for the Hearts AIs: plays whole games of computers against computers with chosen AIs in each seat.
// Used by ai.test.js; handy from a script too.  Depends on game.js (the real rules) and shared/random.js (seeded rng).
import * as g from './game.js';
import { seeded } from '../../shared/random.js';

export { seeded };

/**
 * Plays one whole game. `ais` is the AI id for each seat (3 to 7 of them, 4 by default in versus).  Every move is checked for legality by the rules
 * (the game throws on an illegal one).
 * @param {object} options
 * @param {string[]} options.ais  AI id per seat; its length is the seat count.
 * @param {number} [options.seed]  seed for the default rng.
 * @param {object} [options.settings]  overrides for the room settings (target 100, no Jack by default).
 * @param {() => number} [options.rng]  random source, defaults to seeded(seed).
 * @returns {{room: object, hands: {points: number[], moon: (number|null), details: object[]}[], scores: number[]}}
 *   the finished room, a record per hand, and the final scores.
 * Side effects: none outside the throwaway room it creates; advances rng; throws if the game stalls or fails to finish.
 */
export function playGame({ ais, seed, settings = {}, rng = seeded(seed) }) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target: 100, jackOfDiamonds: false, seats: ais.length, ...settings } });
  g.fillWithBots(room, 1);
  g.start(room, 1, rng);
  room.seats[0] = { kind: 'bot', id: 'bot:90', name: 'Zed' };
  room.seats.forEach((seat, i) => (seat.ai = ais[i]));
  const hands = [];
  for (let guard = 0; guard < 100000 && room.phase !== 'finished'; guard++) {
    if (room.phase === 'handEnd') {
      hands.push({ points: room.lastHand.points, moon: room.lastHand.moon, details: room.lastHand.details });
      g.forceNextHand(room, rng);
      continue;
    }
    if (!g.runPending(room, rng)) throw new Error(`nothing to do in ${room.phase}`);
  }
  if (room.phase !== 'finished') throw new Error('the game did not finish');
  hands.push({ points: room.lastHand.points, moon: room.lastHand.moon, details: room.lastHand.details });
  return { room, hands, scores: [...room.scores] };
}

/**
 * Plays `games` games with `subject` in seat (game number mod seats) and `field` (an AI id, or an array of seats - 1) in the
 * others, rotating the subject's seat so no seat is favoured.  Returns the subject's and the field's averages.
 * @param {object} options
 * @param {string} options.subject  AI id under test.
 * @param {string|string[]} options.field  AI id for every other seat, or an array of seats - 1 ids.
 * @param {number} options.games  how many games to play.
 * @param {object} [options.settings]  room setting overrides.
 * @param {number} [options.seedBase]  first game's seed; each game adds its index.
 * @param {number} [options.seats]  number of players (default 4).
 * @returns {object} totals: games, subjectScore, fieldScore, subjectWins, hands, moons, and Jacks for subject and field.
 * Side effects: none (runs games in memory).
 */
export function versus({ subject, field, games, settings = {}, seedBase = 1, seats = 4 }) {
  const out = { games, subjectScore: 0, fieldScore: 0, subjectWins: 0, subjectHandPoints: 0, hands: 0, subjectMoons: 0, fieldMoons: 0, subjectJacks: 0, fieldJacks: 0, subjectHands: 0, fieldHands: 0 };
  for (let n = 0; n < games; n++) {
    const subjectSeat = n % seats;
    const others = Array.isArray(field) ? [...field] : Array.from({ length: seats - 1 }, () => field);
    const ais = Array.from({ length: seats }, (_, i) => (i === subjectSeat ? subject : others.shift()));
    const { room, hands, scores } = playGame({ ais, seed: seedBase + n, settings });
    out.subjectScore += scores[subjectSeat];
    out.fieldScore += (scores.reduce((a, b) => a + b, 0) - scores[subjectSeat]) / (seats - 1);
    if (room.winners.includes(subjectSeat)) out.subjectWins += 1 / room.winners.length;
    for (const hand of hands) {
      out.hands++;
      if (hand.moon === subjectSeat) out.subjectMoons++;
      else if (hand.moon !== null) out.fieldMoons++;
      hand.details.forEach((d, seat) => {
        if (!d.jack) return;
        if (seat === subjectSeat) out.subjectJacks++;
        else out.fieldJacks++;
      });
    }
    out.subjectHands += hands.length;
    out.fieldHands += hands.length * (seats - 1);
  }
  return out;
}
