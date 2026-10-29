// Splendour simulations: do the two ways of playing (build an engine of cheap cards first, or spend gems on points from the
// start) do better at different target scores? Run it with
//
//   node modules/splendour/sim/run.js <experiment> [deals]
//
//   head      Engine against Rush at 10, 15 and 20 points (the main result)
//   sizes     how many cards the Engine should build before it switches, against Rush, at each target
//   rushes    the same Engine against the two kinds of Rush
//   mirror    each strategy against itself: how much going first is worth
//   tables    three and four players: Engine and Rush sharing one table
//   strength  Engine and Rush against the module's own strongest computer player
//   scan      Engine against Rush at every target from 10 to 20 (the game only offers 10, 15 and 20)
//
// Every deal is played twice, with the two strategies swapping seats, so that neither luck of the deal nor the advantage of
// going first can favour one of them. Wins that are shared count as a fraction.
import { AIS } from '../ai/index.js';
import { engine, rush } from './strategies.js';
import { playGame } from './play.js';
import { seeded } from '../../../shared/testkit.js';

const TARGETS = [10, 15, 20];
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const mean = (sum, n) => (n ? sum / n : 0);

const blank = () => ({ games: 0, wins: 0, prestige: 0, cards: 0, zero: 0, l1: 0, l2: 0, l3: 0, nobles: 0, reserved: 0, reachedSum: 0, reachedN: 0, firstToTarget: 0 });

function record(side, seat, res) {
  const player = res.seats[seat];
  side.games++;
  if (res.winners.includes(seat)) side.wins += 1 / res.winners.length;
  side.prestige += player.prestige;
  side.cards += player.cards;
  side.zero += player.zeroPoint;
  side.l1 += player.byLevel[0];
  side.l2 += player.byLevel[1];
  side.l3 += player.byLevel[2];
  side.nobles += player.nobles;
  side.reserved += player.reserved;
  if (player.reached !== null) {
    side.reachedSum += player.reached;
    side.reachedN++;
  }
}

/** A against B on `deals` deals, each played in both seat orders. */
export function headToHead(A, B, target, deals, seed = 1) {
  const a = blank();
  const b = blank();
  let seatZero = 0;
  let rounds = 0;
  let games = 0;
  for (let g = 0; g < deals; g++) {
    for (const aFirst of [true, false]) {
      const players = aFirst ? [A, B] : [B, A];
      const res = playGame(players, target, seeded(seed * 1000003 + g * 2 + (aFirst ? 0 : 1) + 1), seeded(seed * 7919 + g));
      record(a, aFirst ? 0 : 1, res);
      record(b, aFirst ? 1 : 0, res);
      if (res.winners.includes(0)) seatZero += 1 / res.winners.length;
      rounds += res.rounds;
      games++;
    }
  }
  const rate = a.wins / games;
  return { a, b, games, rate, error: 1.96 * Math.sqrt((rate * (1 - rate)) / games), seatZero: seatZero / games, rounds: rounds / games };
}

const describe = (side) =>
  `${mean(side.prestige, side.games).toFixed(1)} pts, ${mean(side.cards, side.games).toFixed(1)} cards (${mean(side.l1, side.games).toFixed(1)}/${mean(side.l2, side.games).toFixed(1)}/${mean(side.l3, side.games).toFixed(1)} by level, ${mean(side.zero, side.games).toFixed(1)} worth nothing), ${mean(side.nobles, side.games).toFixed(2)} nobles`;

function head(deals) {
  console.log(`\n## Engine (8 cards first) against Rush (only cards worth points), ${deals * 2} games at each target\n`);
  console.log('| target | Engine wins | ±95% | rounds | Engine, average game | Rush, average game |');
  console.log('| ---: | ---: | ---: | ---: | --- | --- |');
  for (const target of TARGETS) {
    const r = headToHead(engine(8), rush(1), target, deals, target);
    console.log(`| ${target} | **${pct(r.rate)}** | ${pct(r.error)} | ${r.rounds.toFixed(1)} | ${describe(r.a)} | ${describe(r.b)} |`);
  }
}

function sizes(deals) {
  const list = [0, 2, 4, 6, 8, 10, 12];
  console.log(`\n## How many cheap cards should the Engine build first? Win rate against Rush (1+ point cards only), ${deals * 2} games per cell\n`);
  console.log(`| cards built first | ${TARGETS.map((t) => `${t} points`).join(' | ')} |`);
  console.log(`| ---: | ${TARGETS.map(() => '---:').join(' | ')} |`);
  const best = Object.fromEntries(TARGETS.map((t) => [t, { size: -1, rate: -1 }]));
  const rows = [];
  for (const size of list) {
    const cells = TARGETS.map((target) => {
      const r = headToHead(engine(size), rush(1), target, deals, 100 + target + size);
      if (r.rate > best[target].rate) best[target] = { size, rate: r.rate };
      return r.rate;
    });
    rows.push([size, cells]);
  }
  for (const [size, cells] of rows) console.log(`| ${size}${size === 0 ? ' (= Rush)' : ''} | ${cells.map((rate, i) => (best[TARGETS[i]].size === size ? `**${pct(rate)}**` : pct(rate))).join(' | ')} |`);
  console.log(`\nBest size: ${TARGETS.map((t) => `${t} points: ${best[t].size}`).join(', ')}.`);
}

function rushes(deals) {
  console.log(`\n## Engine (8) against each kind of Rush, ${deals * 2} games per cell\n`);
  console.log(`| Rush buys only cards worth | ${TARGETS.map((t) => `${t} points`).join(' | ')} |`);
  console.log(`| --- | ${TARGETS.map(() => '---:').join(' | ')} |`);
  for (const points of [1, 2, 3]) {
    console.log(`| ${points}+ points | ${TARGETS.map((target) => pct(headToHead(engine(8), rush(points), target, deals, 300 + target + points).rate)).join(' | ')} |`);
  }
}

function mirror(deals) {
  console.log(`\n## Each strategy against itself: how often does the player who goes first win? (${deals * 2} games per cell)\n`);
  console.log(`| strategy | ${TARGETS.map((t) => `${t} points`).join(' | ')} |`);
  console.log(`| --- | ${TARGETS.map(() => '---:').join(' | ')} |`);
  for (const make of [() => engine(8), () => rush(1)]) {
    const name = make().name;
    console.log(`| ${name} | ${TARGETS.map((target) => pct(headToHead(make(), make(), target, deals, 500 + target).seatZero)).join(' | ')} |`);
  }
}

function tables(deals) {
  console.log(`\n## Engine and Rush at one table (each deal played in every seating), ${deals} deals\n`);
  console.log('| table | target | Engine wins (per player) | Rush wins (per player) | rounds |');
  console.log('| --- | ---: | ---: | ---: | ---: |');
  const layouts = { '3 players: 1 Engine, 2 Rush': ['E', 'R', 'R'], '3 players: 2 Engine, 1 Rush': ['E', 'E', 'R'], '4 players: 2 Engine, 2 Rush': ['E', 'E', 'R', 'R'] };
  for (const [label, kinds] of Object.entries(layouts)) {
    for (const target of TARGETS) {
      const win = { E: 0, R: 0 };
      const seats = { E: 0, R: 0 };
      let rounds = 0;
      let games = 0;
      const turns = kinds.length;
      for (let g = 0; g < deals; g++) {
        for (let shift = 0; shift < turns; shift++) {
          const order = kinds.map((_, i) => kinds[(i + shift) % turns]);
          const players = order.map((k) => (k === 'E' ? engine(8) : rush(1)));
          const res = playGame(players, target, seeded(900 * g + shift + target * 31 + turns), seeded(g + target));
          order.forEach((k, seat) => {
            seats[k]++;
            if (res.winners.includes(seat)) win[k] += 1 / res.winners.length;
          });
          rounds += res.rounds;
          games++;
        }
      }
      console.log(`| ${label} | ${target} | ${pct(win.E / seats.E)} | ${pct(win.R / seats.R)} | ${(rounds / games).toFixed(1)} |`);
    }
  }
}

function strength(deals) {
  console.log(`\n## A sanity check: the two strategies against the module's strongest computer player ("sharp"), ${deals * 2} games per cell\n`);
  const sharp = AIS.find((ai) => ai.id === 'sharp');
  console.log(`| strategy against sharp | ${TARGETS.map((t) => `${t} points`).join(' | ')} |`);
  console.log(`| --- | ${TARGETS.map(() => '---:').join(' | ')} |`);
  for (const [label, make] of [['Engine (8)', () => engine(8)], ['Rush (1+)', () => rush(1)]]) {
    console.log(`| ${label} | ${TARGETS.map((target) => pct(headToHead(make(), sharp, target, deals, 700 + target).rate)).join(' | ')} |`);
  }
}

function scan(deals) {
  console.log(`
## Engine (8) and the best-sized Engine against Rush at every target from 10 to 20 points, ${deals * 2} games per cell (two players)
`);
  console.log('| target | Engine (8) beats Rush (1+) | Engine (8) beats Rush (2+) |');
  console.log('| ---: | ---: | ---: |');
  for (let target = 10; target <= 20; target++) {
    console.log(`| ${target} | ${pct(headToHead(engine(8), rush(1), target, deals, 1100 + target).rate)} | ${pct(headToHead(engine(8), rush(2), target, deals, 1200 + target).rate)} |`);
  }
}

const experiments = { head, sizes, rushes, mirror, tables, strength, scan };
const [name, count] = process.argv.slice(2);
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('run.js')) {
  if (!experiments[name]) {
    console.error(`Usage: node run.js <${Object.keys(experiments).join('|')}> [deals]`);
    process.exit(1);
  }
  const started = Date.now();
  experiments[name](Number(count) || 2000);
  console.log(`\n(${((Date.now() - started) / 1000).toFixed(0)} s)`);
}
