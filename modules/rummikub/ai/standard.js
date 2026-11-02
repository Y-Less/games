// The original computer player: it may take the whole table apart and rebuild it, and plays whatever uses the most points.
import { SEARCH_BUDGET, standardPlay } from '../search.js';

// Depends on ../search.js (standardPlay).  Its id must stay 'standard': rooms saved before there were several AIs use it.
// Its plan takes (room, seat, { budget }) and returns { table, added } or null to draw; the budget caps the search effort so a
// turn cannot take unbounded time.
export default {
  id: 'standard',
  name: 'Classic',
  description: 'Rearranges anything on the table to get as many points out of its rack as it can.',
  weight: 1,
  plan: (room, seat, { budget = SEARCH_BUDGET } = {}) => standardPlay(room, seat, { budget }),
};
