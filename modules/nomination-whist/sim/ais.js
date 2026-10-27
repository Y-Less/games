// The AIs the simulations can use: everything the live game has, plus the learned ones that are not offered to players
// yet (give an AI a weight above 0 and add it to ../ai/index.js to ship it), plus each learned bidder paired with the
// strongest card player, Sharp (`lut-sharp`, `lutc-sharp`), which is how to compare bidding tables when the play is as good
// as it gets. Sharp simulates inside every card it plays, so those are far slower than the rest.
import { defineAIs } from '../../../shared/ai.js';
import { AIS } from '../ai/index.js';
import { lut, lutc } from '../ai/lut.js';
import { sharp } from '../ai/sharp.js';

const withSharpPlay = (ai) => ({ ...ai, id: `${ai.id}-sharp`, name: `${ai.name} + Sharp play`, play: sharp.play });

export const SIM_AIS = defineAIs([...AIS, lut, lutc, withSharpPlay(lut), withSharpPlay(lutc)]);
