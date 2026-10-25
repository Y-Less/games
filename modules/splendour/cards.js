// The card set for Splendour: five gem colours, 90 development cards and ten noble tiles, all defined here.
// The set is generated from a small table of cost patterns, so it is deterministic and perfectly balanced between the
// colours: every pattern is used once for each bonus colour (rotated round the colour wheel, and mirrored on odd
// patterns so that neighbouring colours are not always paired in the same way).

export const COLOURS = ['diamond', 'sapphire', 'emerald', 'ruby', 'onyx'];
export const COLOUR_NAMES = ['Diamond', 'Sapphire', 'Emerald', 'Ruby', 'Onyx'];
export const GOLD = 5; // the index of Gold in a token array (five colours, then gold)
export const TOKEN_KINDS = 6;

// Each pattern: [prestige, [cost by distance from the card's own colour: 0 = own colour, 1.. = following colours]].
const PATTERNS = {
  1: [
    [0, [0, 1, 1, 1, 1]],
    [0, [0, 1, 2, 1, 1]],
    [0, [0, 2, 2, 0, 1]],
    [0, [0, 0, 1, 1, 3]],
    [0, [0, 3, 0, 0, 0]],
    [0, [2, 0, 0, 2, 0]],
    [0, [0, 0, 2, 1, 0]],
    [1, [0, 4, 0, 0, 0]],
  ],
  2: [
    [1, [0, 3, 0, 2, 2]],
    [1, [2, 2, 3, 0, 0]],
    [2, [0, 0, 0, 5, 0]],
    [2, [0, 4, 2, 0, 1]],
    [2, [0, 5, 3, 0, 0]],
    [3, [0, 0, 6, 0, 0]],
  ],
  3: [
    [3, [0, 3, 3, 3, 5]],
    [4, [0, 0, 0, 0, 7]],
    [4, [3, 0, 3, 6, 0]],
    [5, [0, 3, 0, 0, 7]],
  ],
};

export const LEVELS = [1, 2, 3];
export const CARDS_PER_LEVEL = { 1: 40, 2: 30, 3: 20 };

function build() {
  const cards = [];
  let n = 1;
  for (const level of LEVELS) {
    PATTERNS[level].forEach(([points, offsets], index) => {
      for (let bonus = 0; bonus < COLOURS.length; bonus++) {
        const cost = [0, 0, 0, 0, 0];
        const direction = index % 2 === 0 ? 1 : -1;
        offsets.forEach((amount, k) => {
          cost[(((bonus + direction * k) % 5) + 5) % 5] += amount;
        });
        cards.push({ id: `c${String(n++).padStart(2, '0')}`, level, bonus, points, cost });
      }
    });
  }
  return cards;
}

export const CARDS = Object.freeze(build().map((c) => Object.freeze(c)));
export const CARD_BY_ID = Object.freeze(Object.fromEntries(CARDS.map((c) => [c.id, c])));
export const cardsOfLevel = (level) => CARDS.filter((c) => c.level === level);
export const isCardId = (id) => typeof id === 'string' && Object.hasOwn(CARD_BY_ID, id);

// Noble tiles: each needs a number of card bonuses in two or three colours.
const [D, S, E, R, O] = [0, 1, 2, 3, 4];
const need = (spec) => Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v]));
export const NOBLES = Object.freeze(
  [
    ['n1', 'The Archivist', need({ [D]: 4, [S]: 4 })],
    ['n2', 'The Harbourmaster', need({ [S]: 4, [E]: 4 })],
    ['n3', 'The Herbalist', need({ [E]: 4, [R]: 4 })],
    ['n4', 'The Furnace-Keeper', need({ [R]: 4, [O]: 4 })],
    ['n5', 'The Night Warden', need({ [O]: 4, [D]: 4 })],
    ['n6', 'The Lapidary', need({ [D]: 3, [S]: 3, [E]: 3 })],
    ['n7', 'The Cartographer', need({ [S]: 3, [E]: 3, [R]: 3 })],
    ['n8', 'The Alchemist', need({ [E]: 3, [R]: 3, [O]: 3 })],
    ['n9', 'The Lamplighter', need({ [R]: 3, [O]: 3, [D]: 3 })],
    ['n10', 'The Weigher of Stones', need({ [O]: 3, [D]: 3, [S]: 3 })],
  ].map(([id, name, requires]) => Object.freeze({ id, name, points: 3, requires: Object.freeze(requires) })),
);
export const NOBLE_BY_ID = Object.freeze(Object.fromEntries(NOBLES.map((n) => [n.id, n])));
export const isNobleId = (id) => typeof id === 'string' && Object.hasOwn(NOBLE_BY_ID, id);
