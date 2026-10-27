// Plays a range of whole games between named AIs and totals what each AI did. Used by tourney.js (the command-line runner,
// one range per worker job) and by the tests. The same seed and range always give the same totals.
import { AIS } from '../ai/index.js';
import { playGame } from './game.js';
import { mixSeed, mulberry32 } from './rng.js';

export const byId = new Map(AIS.map((ai) => [ai.id, ai]));
export const blank = () => ({ games: 0, rounds: 0, score: 0, wins: 0, bids: 0, hits: 0, tricks: 0, bidTotal: 0, instantWins: 0 });

/** Plays games numbered `from` to `to - 1` and returns the totals for each AI name. */
export function playGames({ names, seed, from, to, schedule, missPoints, instantWin }) {
  const rng = mulberry32(mixSeed(seed, from));
  const totals = Object.fromEntries([...new Set(names)].map((name) => [name, blank()]));
  for (let g = from; g < to; g++) {
    const shift = g % names.length; // rotate the seats
    const seatNames = names.map((_, seat) => names[(seat + shift) % names.length]);
    const ais = seatNames.map((name) => byId.get(name));
    const firstDealer = Math.floor(rng() * names.length);
    const { scores, winners, rounds, instantWin: instant } = playGame({ ais, firstDealer, schedule, missPoints, instantWin }, rng);
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
