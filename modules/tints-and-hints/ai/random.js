// The only computer player for Tints and Hints, for testing: it has no real logic. The grid is cut into 4 x 4 blocks of
// squares, each with a colour description. As the hinter it describes the block that holds its secret square; as a
// guesser it picks a random square from the block the latest hint describes (or any square, if the hint is not one of
// the descriptions, such as a person's own words). Randomness comes only from the `rng` the game passes in.
import { COLS, ROWS, cellsDescribedBy, describeCell } from '../grid.js';

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const random = {
  id: 'random',
  name: 'Random',
  description: 'Describes the colour of the 4 x 4 block holding its square, and guesses a random square of the block a hint describes. For testing.',
  /** hint({ round, tint }, rng) -> the description of the block that holds the tint */
  hint: ({ tint }, rng) => describeCell(tint) ?? 'a colour',
  /** guess({ round, cells, hints }, rng) -> one of the squares (`cells` lists every legal one) */
  guess: ({ round = 1, cells = COLS.flatMap((c) => ROWS.map((r) => c + r)), hints = {} }, rng) => {
    const block = cellsDescribedBy(round === 2 ? hints.second : hints.first);
    return pick(block ? block.filter((c) => cells.includes(c)) : cells, rng);
  },
};

export default random;
