// Plays a range of whole games between named AIs and totals what each AI did.  Used by tourney.js (the command-line runner,
// one range per worker job) and by the tests.  The same seed and range always give the same totals.
// Depends on: ais.js (the AIs by id), game.js (playGame), and rng.js (seeding).
import { SIM_AIS } from './ais.js';
import { playGame } from './game.js';
import { mixSeed, mulberry32 } from './rng.js';

/** The AIs a tournament can use, looked up by id. */
export const byId = new Map(SIM_AIS.map((ai) => [ai.id, ai]));
/**
 * An empty set of totals for one AI.
 * @returns {{ games: number, rounds: number, score: number, wins: number, bids: number, hits: number, tricks: number, bidTotal: number, instantWins: number }} zeroed counters
 * Side effects: none.
 */
export const blank = () => ({ games: 0, rounds: 0, score: 0, wins: 0, bids: 0, hits: 0, tricks: 0, bidTotal: 0, instantWins: 0 });

/**
 * Plays games numbered `from` to `to - 1` and returns the totals for each AI name.
 * Seats rotate game by game, so no AI is favoured by where it sits, and an AI listed twice shares one set of totals.
 * @param {{ names: string[], seed: number, from: number, to: number, schedule: number[], missPoints: boolean, instantWin: boolean, jokers?: boolean }} job  `names` is one AI id per seat
 * @returns {Object<string, object>} totals (see blank) by AI id; `wins` is fractional when a game is tied
 * Side effects: none (the RNG is local to the range).
 */
export function playGames({ names, seed, from, to, schedule, missPoints, instantWin, jokers = false }) {
  const rng = mulberry32(mixSeed(seed, from));
  const totals = Object.fromEntries([...new Set(names)].map((name) => [name, blank()]));
  for (let g = from; g < to; g++) {
    const shift = g % names.length; // rotate the seats
    const seatNames = names.map((_, seat) => names[(seat + shift) % names.length]);
    const ais = seatNames.map((name) => byId.get(name));
    const firstDealer = Math.floor(rng() * names.length);
    const { scores, winners, rounds, instantWin: instant } = playGame({ ais, firstDealer, schedule, missPoints, instantWin, jokers }, rng);
    // Credit each seat's result to the AI that sat there this game.
    seatNames.forEach((name, seat) => {
      const t = totals[name];
      t.games++;
      t.score += scores[seat];
      if (winners.includes(seat)) t.wins += 1 / winners.length;
      if (instant === seat) t.instantWins++;
      for (const r of rounds) {
        t.rounds++;
        t.bids++;
        t.bidTotal += r.nominations[seat];
        t.tricks += r.taken[seat];
        if (r.nominations[seat] === r.taken[seat]) t.hits++;
      }
    });
  }
  return totals;
}
