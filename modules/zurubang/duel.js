// One fight on the battlefield, decided.  This is the file the whole game hangs off: `fightAt` takes a battle — ten
// cards in five positions, the stacks, the graveyard, and what each player's hand of backs was worth — and settles the
// pair at one position, handing out the points and carrying out whatever the talents say must happen afterwards.
//
// It knows nothing about rooms, seats of people, sockets or the clock.  A battle is a plain object that survives
// JSON.stringify, and everything here either reads it or changes it in place.  Positions are 0 to 4, counted from the
// stacks, and a side is 0 or 1.
//
// The order the checks come in is the one thing to be careful about, and it is written out in decide() below.  The
// rulebook's own rulings, and the ones it leaves to us, are in README.md.
//
// Depends on ./cards.js and shared/messages.js.
import { BEATS, cardOf } from './cards.js';
import { msg } from '../../shared/messages.js';

/** What a fight is worth to the card that wins it, draws it, or loses it. */
export const WIN_POINTS = 2;
export const DRAW_POINTS = 1;
/** A Zurubang loses to anything this weak, and nothing else. */
export const ZURUBANG_FLOOR = 4;
/** How many cards each player places. */
export const POSITIONS = 5;

/** The other side. */
export const other = (side) => (side === 0 ? 1 : 0);

/**
 * A card's printed power, with the Zurubang's absent one standing for the infinity the card claims.
 *
 * @param {string | null} id  a card id, or null for a position nothing is standing in
 * @returns {number} the power, Infinity for a Zurubang, and 0 for nothing at all
 * Side effects: none.
 */
export const printedPower = (id) => {
  const card = cardOf(id);
  if (!card) return 0;
  return card.power === null ? Infinity : card.power;
};

/**
 * A fresh battle: ten empty positions and the three stacks the duel will draw its replacements from.
 *
 * @param {object} parts
 * @param {string[][]} parts.stacks      the three stacks, top of each at the end
 * @param {string[]} parts.graveyard     the discard pile, top at the end
 * @param {(string | null)[]} parts.fiveElement  the **element** behind each side's hand if it was five of a kind,
 *   else null.  The element, not the colour of the back: they are two different words for the same card, and the
 *   faces this is weighed against are elements.
 * @returns {object} the battle
 * Side effects: none (the arrays passed in are the ones it will use).
 */
export const newBattle = ({ stacks, graveyard, fiveElement = [null, null] }) => ({
  placed: [Array(POSITIONS).fill(null), Array(POSITIONS).fill(null)],
  stacks,
  graveyard,
  fiveElement,
  at: 0,
  fights: [],
  points: [0, 0],
  marker: 0,
});

// ---- the stacks ----

/**
 * The stack a card is taken off when the rules do not let anybody choose: the fullest, and the lowest-numbered of
 * those if two are level.  Three face-down stacks hold no information, so a choice between them would be a choice
 * about nothing; the one place a player really does choose is their own turn (see game.js).
 *
 * @param {string[][]} stacks
 * @returns {number} the stack to draw from, or -1 if every one of them is empty
 * Side effects: none.
 */
export function fullestStack(stacks) {
  let best = -1;
  for (let i = 0; i < stacks.length; i++) if (stacks[i].length && (best === -1 || stacks[i].length > stacks[best].length)) best = i;
  return best;
}

/**
 * Takes the top card off a stack.  When all three are empty the graveyard is shuffled back into them, so that a game
 * long enough to use up the deck carries on instead of stopping.
 *
 * @param {object} battle
 * @param {(() => number) | null} [rng]  needed only to shuffle the graveyard back in; without it the stacks stay empty
 * @param {number} [wanted]  a stack the drawer asked for; ignored if it is empty or out of range
 * @returns {string | null} the card, or null if there was nothing anywhere to draw
 * Side effects: takes a card off a stack, and may refill the stacks from the graveyard.
 */
export function drawCard(battle, rng = null, wanted = -1) {
  if (!battle.stacks.some((stack) => stack.length)) refillStacks(battle, rng);
  const from = Number.isInteger(wanted) && battle.stacks[wanted]?.length ? wanted : fullestStack(battle.stacks);
  return from === -1 ? null : battle.stacks[from].pop();
}

/**
 * Deals the graveyard back out as three fresh stacks, which is what keeps a long game going.  Without an rng (a test
 * reading a battle, say) it does nothing: a stack dealt in a known order would be a stack somebody could read.
 *
 * @param {object} battle
 * @param {(() => number) | null} rng
 * @returns {boolean} whether there was anything to deal
 * Side effects: empties the graveyard and fills the stacks.
 */
export function refillStacks(battle, rng) {
  if (!rng || !battle.graveyard.length) return false;
  const cards = battle.graveyard.splice(0, battle.graveyard.length);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  battle.stacks.forEach((stack) => stack.splice(0, stack.length));
  cards.forEach((card, i) => battle.stacks[i % battle.stacks.length].push(card));
  return true;
}

// ---- reading the battlefield ----

/** Is the card at this position face up?  Every position up to and including the one being fought has been turned. */
const isFaceUp = (battle, position) => position <= battle.at;

/**
 * Every card on the battlefield, with where it is.
 * @param {object} battle
 * @returns {{ id: string, side: number, position: number }[]}
 * Side effects: none.
 */
const onField = (battle) =>
  battle.placed.flatMap((row, side) => row.flatMap((id, position) => (id ? [{ id, side, position }] : [])));

// ---- the talents ----

/**
 * How much a talent adds to its card's power.  Every one of these reads the battlefield as it stands at the moment of
 * its own fight, which is why they are given the whole context rather than two cards.
 *
 * @type {Record<string, (c: object) => number>}
 */
const POWER = {
  // +1 for each card of its own element face up, counting the card opposite but never itself.
  elemental: (c) => onField(c.battle).filter((p) => isFaceUp(c.battle, p.position) && !(p.side === c.side && p.position === c.position) && cardOf(p.id).face === c.card.face).length,
  // +5 on the one position it calls home, and nothing anywhere else.
  'energy-knight': (c) => (c.card.position === c.position + 1 ? 5 : 0),
  // +1 on position 2, up to +4 on position 5.
  troll: (c) => c.position,
  // +4 against an even printed power; a Zurubang has no number at all, so it is not even.
  'carrot-knight': (c) => (Number.isFinite(printedPower(c.againstId)) && printedPower(c.againstId) % 2 === 0 ? 4 : 0),
  // +8 against water.
  'otter-warrior': (c) => (c.against?.face === 'water' ? 8 : 0),
  // +2 for every spirit card still face down: the positions this fight has not reached.
  'dark-warlord': (c) => 2 * onField(c.battle).filter((p) => !isFaceUp(c.battle, p.position) && cardOf(p.id).face === 'spirit').length,
  // +2 for every non-elemental card anywhere on the battlefield, turned or not, except herself.
  melody: (c) => 2 * onField(c.battle).filter((p) => !(p.side === c.side && p.position === c.position) && cardOf(p.id).face === 'none').length,
  // One more power on position 4, one less on position 5.
  beholder: (c) => (c.position === 3 ? 1 : c.position === 4 ? -1 : 0),
  // The drawn card's power, added to his own.  A Zurubang drawn has no number, so it adds nothing.
  'beast-kid': (c) => (Number.isFinite(printedPower(c.drawn)) ? printedPower(c.drawn) : 0),
  // +4 if the card drawn has an earth face.
  druid: (c) => (cardOf(c.drawn)?.face === 'earth' ? 4 : 0),
};

/** The talents that draw a card from a stack before the fight is decided, and throw it away afterwards. */
const DRAWS_FIRST = new Set(['beast-kid', 'druid']);

/**
 * Talents that simply say what they beat.  They are asked after the element, because every one of them is written as
 * an exception to power rather than to the element circle.
 *
 * @type {Record<string, (c: object) => boolean>}
 */
const BEATS_OUTRIGHT = {
  // Any non-fire card of power 9 or more, flying or not.  A Zurubang's infinity counts.
  gnomeling: (c) => c.against?.face !== 'fire' && printedPower(c.againstId) >= 9,
  // Every other non-elemental card.
  'ember-monkey': (c) => c.against?.face === 'none',
};

/** The talents whose card cannot be destroyed.  Only the named one takes a point for it; the Zurubang simply survives. */
const INDESTRUCTIBLE = new Set(['indestructible', 'zurubang']);

/** The abilities a talent grants on top of the ones printed on the card. */
const EXTRA_ABILITIES = {
  // Flying on position 1, destroying on position 2, shooting on position 3, and nothing but power after that.
  beholder: (position) => ['flying', 'destroying', 'shooting'][position] ?? null,
};

/**
 * The talents that act before anything else at their position, replacing the card opposite.  Each returns a message
 * for the record, or null if it had nothing to do.
 *
 * @type {Record<string, (c: object) => (object | null)>}
 */
const BEFORE = {
  // The card opposite is thrown away and replaced from a stack of this card's owner's choosing.
  'mercy-twister': (c) => replaceOpposite(c, drawCard(c.battle, c.rng), 'mercyTwister'),
  // A card opposite of power 8 or less is dragged off the graveyard, once.
  'ogre-mage': (c) => (printedPower(c.againstId) <= 8 ? replaceOpposite(c, c.battle.graveyard.pop() ?? null, 'ogreMage') : null),
  // The card opposite is exchanged for the top of the graveyard, whatever it is.
  necromancer: (c) => replaceOpposite(c, c.battle.graveyard.pop() ?? null, 'necromancer'),
};

/**
 * Puts a card in the opposite position and sends the one that was there to the bottom of the graveyard, so that the
 * same exchange cannot immediately undo itself.
 *
 * The card that is sent away is **not** named in the message.  It never fought: it was face down when the talent
 * reached it and it is face down in the graveyard now, so saying what it was would tell both players a card that only
 * one of them ever knew.  The card that takes its place is named, because it is about to fight and be turned over.
 *
 * @param {object} c          the fight context
 * @param {string | null} replacement  what to put there, or null if there was nothing to be had
 * @param {string} why        the key of the talent doing it, for the record
 * @returns {object | null} a message for the record, or null if nothing happened
 * Side effects: changes the battlefield and the graveyard.
 */
function replaceOpposite(c, replacement, why) {
  if (!replacement) return null;
  const gone = c.againstId;
  c.battle.placed[other(c.side)][c.againstPosition] = replacement;
  if (gone) c.battle.graveyard.unshift(gone);
  return msg(`fight.${why}`, { replacement: msg(`cards.${replacement}`) });
}

// ---- one fight ----

/**
 * Everything a talent needs to know about its own card's fight.
 *
 * @param {object} battle
 * @param {number} side
 * @param {number} position
 * @param {(() => number) | null} rng
 * @returns {object} the context the talent tables are given
 * Side effects: none.
 */
function contextFor(battle, side, positions, rng) {
  const position = positions[side];
  // Where the card it is fighting stands, which is the same position in the ordinary five fights and need not be in a
  // sudden death — a talent that replaces "the opposite card" has to put the new one where the old one actually was.
  const againstPosition = positions[other(side)];
  const againstId = battle.placed[other(side)][againstPosition];
  const id = battle.placed[side][position];
  return { battle, side, position, againstPosition, rng, id, card: cardOf(id), againstId, against: cardOf(againstId), drawn: null };
}

/**
 * Every ability a card has in this fight: the ones printed on it, and any its talent grants where it stands.
 *
 * @param {object} c  the fight context
 * @returns {Set<string>}
 * Side effects: none.
 */
function abilitiesOf(c) {
  const abilities = new Set(c.card?.abilities ?? []);
  const extra = EXTRA_ABILITIES[c.card?.talent]?.(c.position);
  if (extra) abilities.add(extra);
  return abilities;
}

/**
 * A card's power in this fight, printed power and talent together.
 *
 * @param {object} c  the fight context, whose `drawn` is already filled in if its talent draws
 * @returns {number}
 * Side effects: none.
 */
function powerOf(c) {
  const base = printedPower(c.id);
  const bonus = POWER[c.card?.talent]?.(c) ?? 0;
  return Number.isFinite(base) ? base + bonus : base;
}

/**
 * Who wins the pair, in the order the rules ask the questions.  Nothing here changes anything.
 *
 * 1. A Zurubang beats everything, except a card of power 4 or less, which beats it.
 * 2. The element, which five of a kind widens.  Non-elemental faces never collide.
 * 3. A talent that says outright what it beats.
 * 4. A Dragon meeting a shooting card draws.
 * 5. Shooting beats flying, whatever the powers are.
 * 6. A flying card that is weaker escapes, for a draw — unless the other one flies too.
 * 7. Power, and equal powers draw.
 *
 * Where a rule other than the element would have both sides winning, it decides nothing and the next question is
 * asked instead.  The element is the exception, and has to be: five of a kind only ever adds the one element that
 * normally beats you, so a hand that holds it would cancel itself out every single time if the two were weighed
 * equally.  It is an exception to the circle, so it beats the circle.
 *
 * @param {object[]} sides   the two contexts, 0 then 1
 * @param {Set<string>[]} abilities  each side's abilities
 * @param {number[]} powers  each side's power
 * @param {(string | null)[]} fiveElement  the element behind each side's five-of-a-kind hand, if they had one
 * @returns {{ winner: number | null, by: string }} the winning side and which rule decided it
 * Side effects: none.
 */
export function decide(sides, abilities, powers, fiveElement) {
  const zurubang = sides.map((c) => c.card?.talent === 'zurubang');
  if (zurubang[0] && zurubang[1]) return { winner: null, by: 'zurubang' };
  for (const side of [0, 1]) {
    if (!zurubang[side]) continue;
    const weak = printedPower(sides[other(side)].id) <= ZURUBANG_FLOOR;
    return { winner: weak ? other(side) : side, by: 'zurubang' };
  }

  const byElement = elementWinner(
    sides.map((c) => c.card?.face),
    fiveElement,
  );
  if (byElement !== null) return { winner: byElement, by: 'element' };

  const talentWin = [0, 1].map((side) => Boolean(BEATS_OUTRIGHT[sides[side].card?.talent]?.(sides[side])));
  const byTalent = onlyOne(talentWin);
  if (byTalent !== null) return { winner: byTalent, by: 'talent' };

  const dragon = [0, 1].some((side) => sides[side].card?.talent === 'dragon' && abilities[other(side)].has('shooting'));
  if (dragon) return { winner: null, by: 'dragon' };

  const shot = [0, 1].map((side) => abilities[side].has('shooting') && abilities[other(side)].has('flying'));
  const byShooting = onlyOne(shot);
  if (byShooting !== null) return { winner: byShooting, by: 'shooting' };

  if (abilities[0].has('flying') !== abilities[1].has('flying')) {
    const flier = abilities[0].has('flying') ? 0 : 1;
    if (powers[flier] < powers[other(flier)]) return { winner: null, by: 'flying' };
  }

  if (powers[0] === powers[1]) return { winner: null, by: 'power' };
  return { winner: powers[0] > powers[1] ? 0 : 1, by: 'power' };
}

/** The one side a pair of claims is true of, or null when it is neither of them or both. */
const onlyOne = ([a, b]) => (a === b ? null : a ? 0 : 1);

/**
 * Does this face beat that one by the circle alone?  Spirit beats air beats water beats fire beats earth, and earth
 * beats spirit.  A non-elemental face neither wins nor loses this way.
 *
 * @param {string | undefined} mine  @param {string | undefined} theirs
 * @returns {boolean}
 * Side effects: none.
 */
export function beatsByElement(mine, theirs) {
  if (!mine || !theirs || mine === 'none' || theirs === 'none') return false;
  return BEATS[mine] === theirs;
}

/**
 * Does five backs of one element let this face beat that one?  The hand's element beats the element that normally
 * beats it, and only that: it is one more arrow on the circle, pointing back the way.
 *
 * @param {string | undefined} mine  @param {string | undefined} theirs
 * @param {string | null | undefined} fiveElement  the element behind this side's five-of-a-kind hand, or null
 * @returns {boolean}
 * Side effects: none.
 */
export function beatsBySpecial(mine, theirs, fiveElement) {
  if (!fiveElement || !mine || !theirs || theirs === 'none') return false;
  return mine === fiveElement && BEATS[theirs] === fiveElement;
}

/**
 * Which side the element gives the fight to, or null when it gives it to neither.
 *
 * A five-of-a-kind hand is asked about first, because it is written as an exception to the circle and the only
 * element it can ever add is the one that was about to beat it: weighed equally, every such hand would cancel itself
 * out and the rule would never once do anything.  Two of them pointing at each other is impossible in a circle of
 * five, so the question of what to do about that does not arise — but the plain circle is still asked both ways
 * round, and still decides nothing if a change elsewhere ever makes it answer twice.
 *
 * @param {(string | undefined)[]} faces  each side's face element
 * @param {(string | null)[]} fiveElement  each side's five-of-a-kind element, or null
 * @returns {number | null}
 * Side effects: none.
 */
export function elementWinner(faces, fiveElement = [null, null]) {
  const special = [0, 1].map((side) => beatsBySpecial(faces[side], faces[other(side)], fiveElement[side]));
  const bySpecial = onlyOne(special);
  if (bySpecial !== null) return bySpecial;
  return onlyOne([0, 1].map((side) => beatsByElement(faces[side], faces[other(side)])));
}

/**
 * Fights the pair at the battle's current position: the talents that act first, then the decision, then the points,
 * then everything the talents do afterwards (destroying, discarding, swapping, and the Basilisk).  The record it
 * returns is what the table and the move log are drawn from.
 *
 * In sudden death the two cards are at positions of their own choosing rather than facing each other, and `positions`
 * says which: every talent still reads the position its own card is standing on, as the rulebook insists.
 *
 * @param {object} battle
 * @param {(() => number) | null} [rng]  for the stacks, where a talent has to draw
 * @param {number[]} [positions]  where each side's card stands (the same position for both, in the ordinary five fights)
 * @returns {object} the fight: its cards, powers, winner, points, and the notes of what the talents did
 * Side effects: changes the battle — its points, its battlefield, its stacks, and its graveyard — and adds the fight
 *   to `battle.fights`.
 */
export function fightAt(battle, rng = null, positions = [battle.at, battle.at]) {
  const notes = [];
  const order = battle.marker === 1 ? [1, 0] : [0, 1];

  // The talents that act before anything else, the holder of the Duel card first.
  for (const side of order) {
    const c = contextFor(battle, side, positions, rng);
    const note = BEFORE[c.card?.talent]?.(c);
    if (note) notes.push(note);
  }

  const sides = [contextFor(battle, 0, positions, rng), contextFor(battle, 1, positions, rng)];
  for (const side of order) {
    if (!DRAWS_FIRST.has(sides[side].card?.talent)) continue;
    sides[side].drawn = drawCard(battle, rng);
    if (sides[side].drawn) notes.push(msg('fight.drew', { card: msg(`cards.${sides[side].id}`), drawn: msg(`cards.${sides[side].drawn}`) }));
  }

  const abilities = sides.map(abilitiesOf);
  const powers = sides.map(powerOf);
  const { winner, by } = decide(sides, abilities, powers, battle.fiveElement ?? [null, null]);

  const points = [0, 0];
  if (winner === null) points[0] = points[1] = DRAW_POINTS;
  else points[winner] = WIN_POINTS;

  const fight = {
    positions,
    // The position a fight belongs to, for the table and for the picking up afterwards; null in a sudden death, where
    // the two cards were chosen separately and face each other across the battlefield rather than at one position.
    position: positions[0] === positions[1] ? positions[0] : null,
    cards: [sides[0].id, sides[1].id],
    powers,
    drawn: [sides[0].drawn, sides[1].drawn],
    winner,
    by,
    points,
    // How many of the other player's cards each side destroyed in this fight: one apiece most of the time, and as
    // many as five when a Basilisk lands on the last position.
    destroyed: [0, 0],
    notes,
  };
  after(battle, sides, abilities, fight, rng);
  battle.points[0] += fight.points[0];
  battle.points[1] += fight.points[1];
  for (const side of order) if (sides[side].drawn) battle.graveyard.push(sides[side].drawn);
  battle.fights.push(fight);
  return fight;
}

/**
 * Everything that happens once the pair is settled: the extra points talents hand out, the cards that leave the
 * battlefield, and the replacements that take their places.  The holder of the Duel card draws first.
 *
 * @param {object} battle
 * @param {object[]} sides
 * @param {Set<string>[]} abilities
 * @param {object} fight  changed in place: its points and its notes
 * @param {(() => number) | null} rng
 * @returns {void}
 * Side effects: changes the battlefield, the stacks, the graveyard, and the fight.
 */
function after(battle, sides, abilities, fight, rng) {
  const leaving = [false, false];
  const order = battle.marker === 1 ? [1, 0] : [0, 1];
  const note = (key, side, params) => fight.notes.push(msg(`fight.${key}`, { card: msg(`cards.${sides[side].id}`), ...params }));
  const award = (side, amount, key) => {
    fight.points[side] += amount;
    note(key, side, { points: amount });
  };

  for (const side of [0, 1]) {
    const c = sides[side];
    const talent = c.card?.talent;
    const foe = other(side);
    const won = fight.winner === side;
    const lost = fight.winner === foe;

    // Destroying takes the card opposite, whoever won, unless that card cannot be destroyed.
    if (abilities[side].has('destroying')) {
      if (INDESTRUCTIBLE.has(sides[foe].card?.talent)) {
        if (sides[foe].card?.talent === 'indestructible') award(foe, 1, 'unharmed');
      } else {
        leaving[foe] = true;
        fight.destroyed[side] += 1;
        note('destroyed', foe);
      }
    }

    if (talent === 'zurubang' && lost) {
      leaving[side] = true;
      award(foe, 1, 'zurubangFell');
    }
    if (talent === 'hill-dwarf') {
      if (won) award(side, 1, 'hillDwarf');
      if (lost) leaving[side] = true;
    }
    if (talent === 'cole-sage' && won) award(side, 2, 'coleSage');
    if (talent === 'sorcerer-apprentice' && won) award(side, 1, 'sorcerer');
    if (talent === 'bembi' && lost && sides[foe].card?.face === 'fire') {
      award(side, 4, 'bembi');
      leaving[side] = true;
    }
    if (talent === 'necromancer' && lost) leaving[side] = true;
  }

  // The Ki-Rin draws once the destroying is settled, because a destroyed Ki-Rin never draws at all.
  for (const side of order) {
    if (sides[side].card?.talent !== 'ki-rin' || leaving[side]) continue;
    const drawn = drawCard(battle, rng);
    if (!drawn) continue;
    battle.graveyard.push(drawn);
    // Recorded with the other talents' draws, because it is the same thing: a card taken off a stack in front of both
    // players, which is public from the moment it is turned.
    fight.drawn[side] = drawn;
    const power = printedPower(drawn);
    if (power >= 1 && power <= 7) award(side, 1, 'kiRin');
    else leaving[side] = true;
    fight.notes.push(msg('fight.kiRinDrew', { card: msg(`cards.${sides[side].id}`), drawn: msg(`cards.${drawn}`) }));
  }

  // The Basilisk on the last position clears everything of the other player's that can be destroyed, itself included.
  for (const side of [0, 1]) {
    if (sides[side].card?.talent !== 'basilisk' || fight.positions[side] !== POSITIONS - 1) continue;
    leaving[side] = true;
    note('basilisk', side);
    for (let p = 0; p < POSITIONS; p++) {
      // The card facing the Basilisk is left to `leaving`, below: the Basilisk has the destroying ability, so it has
      // already been marked, and sweeping it here as well would throw away the card that replaced it.
      const id = battle.placed[other(side)][p];
      if (!id || p === fight.positions[other(side)] || INDESTRUCTIBLE.has(cardOf(id)?.talent)) continue;
      fight.destroyed[side] += 1;
      sweep(battle, other(side), p, rng);
    }
  }

  // Two swapping cards facing each other swap twice and so stay where they are.  A sudden death pairs two cards that
  // are not opposite one another at all, so nothing changes sides there.
  const swaps = [0, 1].map((side) => sides[side].card?.talent === 'swap');
  if (fight.position !== null && swaps[0] !== swaps[1]) {
    fight.swap = true;
    note('swap', swaps[0] ? 0 : 1);
  }

  for (const side of order) if (leaving[side]) sweep(battle, side, fight.positions[side], rng);
}

/**
 * Takes a card off the battlefield to the graveyard and puts a fresh one from the stacks face down in its place —
 * which is what happens to a card that is destroyed, and to one its own talent throws away.
 *
 * @param {object} battle
 * @param {number} side
 * @param {number} position
 * @param {(() => number) | null} rng
 * @returns {string | null} the card that took its place, if there was one to be had
 * Side effects: changes the battlefield, the stacks, and the graveyard.
 */
export function sweep(battle, side, position, rng) {
  const gone = battle.placed[side][position];
  // The replacement is drawn before the swept card reaches the graveyard, so that a card can never be shuffled back
  // in and dealt straight into the place it has just left.
  const replacement = drawCard(battle, rng);
  if (gone) battle.graveyard.push(gone);
  battle.placed[side][position] = replacement;
  return replacement;
}

/**
 * The cards each player takes back off the battlefield once the duel is over, with the swapping cards changing sides.
 *
 * @param {object} battle
 * @returns {string[][]} the cards going back to each hand
 * Side effects: none.
 */
export function pickUp(battle) {
  const hands = [[], []];
  for (let position = 0; position < POSITIONS; position++) {
    const swap = battle.fights.find((f) => f.position === position)?.swap;
    for (const side of [0, 1]) {
      const id = battle.placed[side][position];
      if (id) hands[swap ? other(side) : side].push(id);
    }
  }
  return hands;
}
