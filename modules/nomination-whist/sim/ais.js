// The AIs the simulations can use: everything the live game has (including the bid-value bidder `lutv`, which is
// the Statistician), plus the older learned ones that are not offered to players (give an AI a weight above 0 and add it to
// ../ai/index.js to ship it), plus each learned bidder paired with the
// strongest card player, Sharp (`lut-sharp`, `lutc-sharp`), which is how to compare bidding tables when the play is as good
// as it gets. Sharp simulates inside every card it plays, so those are far slower than the rest.
import { defineAIs } from '../../../shared/ai.js';
import { AIS } from '../ai/index.js';
import { lut, lutc, lutv, lutvTable } from '../ai/lut.js';
import { sharp } from '../ai/sharp.js';

/**
 * Pairs a learned bidder with Sharp's card play, so bidding tables can be compared when the play is as good as it gets.
 * @param {object} ai  an AI with `id`, `name` and `nominate`
 * @returns {object} a copy whose `id` ends in `-sharp` and whose `play` is Sharp's
 * Side effects: none.
 */
const withSharpPlay = (ai) => ({ ...ai, id: `${ai.id}-sharp`, name: `${ai.name} + Sharp play`, play: sharp.play });

/** `lutc` held to the table for games without Jokers even in a Jokers game: the baseline for the table learned for them. */
// (The `nominate` override below forces `jokers: false` so lutc reads its no-Jokers table whatever the game says.)
const lutcPlain = { ...lutc, id: 'lutc-plain', name: 'Lookup (table-aware, no-Jokers table)', nominate: (ctx) => lutc.nominate({ ...ctx, jokers: false }) };

export const SIM_AIS = defineAIs([...AIS, lut, lutc, lutcPlain, lutvTable, withSharpPlay(lut), withSharpPlay(lutc), withSharpPlay(lutv)]);
