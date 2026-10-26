// A test bench for the Hearts AIs: plays whole games of computers against computers with chosen AIs in each seat.
// Used by ai.test.js; handy from a script too.
import * as g from './game.js';

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plays one whole game. `ais` is the AI id for each of the four seats. Every move is checked for legality by the rules
 * (the game throws on an illegal one). Returns { room, hands: [{ points, moon, details }], scores }.
 */
export function playGame({ ais, seed, settings = {}, rng = seeded(seed) }) {
  const room = g.createRoom({ code: 'a-b-c', hostId: 1, hostName: 'Ann', settings: { target: 100, ...settings } });
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
 * Plays `games` games with `subject` in seat (game number mod 4) and `field` (an AI id, or an array of three) in the
 * others, rotating the subject's seat so no seat is favoured. Returns the subject's and the field's averages.
 */
export function versus({ subject, field, games, settings = {}, seedBase = 1 }) {
  const out = { games, subjectScore: 0, fieldScore: 0, subjectWins: 0, subjectHandPoints: 0, hands: 0, subjectMoons: 0, fieldMoons: 0, subjectJacks: 0, fieldJacks: 0, subjectHands: 0, fieldHands: 0 };
  for (let n = 0; n < games; n++) {
    const subjectSeat = n % 4;
    const others = Array.isArray(field) ? [...field] : [field, field, field];
    const ais = Array.from({ length: 4 }, (_, i) => (i === subjectSeat ? subject : others.shift()));
    const { room, hands, scores } = playGame({ ais, seed: seedBase + n, settings });
    out.subjectScore += scores[subjectSeat];
    out.fieldScore += (scores.reduce((a, b) => a + b, 0) - scores[subjectSeat]) / 3;
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
    out.fieldHands += hands.length * 3;
  }
  return out;
}
