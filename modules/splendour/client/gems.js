// Colours and shapes of the five gems and Gold (index 5).  Every gem has its own SHAPE as well as its own colour,
// so the game can be played without telling colours apart.  The names themselves are words a player reads, so they are
// not here: GEM_KEYS gives each gem's key under `gems.` in the locale files (see MODULES.md, "Languages").
import { msg } from '../../../shared/messages.js';

// Locale key of each gem's name, indexed by colour (0 to 4) with Gold at 5.
export const GEM_KEYS = ['diamond', 'sapphire', 'emerald', 'ruby', 'onyx', 'gold'];

/**
 * A gem's name as a message, for a sentence built on the client (see shared/messages.js).
 * @param {number} colour  0 to 4, or 5 for Gold
 * @returns {{ key: string }}
 * Side effects: none.
 */
export const gemMsg = (colour) => msg(`gems.${GEM_KEYS[colour]}`);

/**
 * "{count} {gem}" as a message, for the lists of gems in a payment, a cost, or a noble's requirement.
 * @param {number} count  how many
 * @param {number} colour  0 to 4, or 5 for Gold
 * @returns {{ key: string, params: object }}
 * Side effects: none.
 */
export const gemCountMsg = (count, colour) => msg('facts.gemCount', { count, gem: gemMsg(colour) });
// Fill colour of each gem, same indexing.
export const GEM_FILL = ['#f3f7fa', '#3f7fe0', '#2fb577', '#e04a5b', '#4b4b5a', '#f0b84a'];
// Outline colour of each gem, same indexing.
export const GEM_STROKE = ['#9db1bf', '#a9c8ff', '#9ce8c3', '#ffb3bb', '#b2b2c6', '#fff0c6'];
// Text colour that reads well on top of each gem's fill (for counts drawn on a gem), same indexing.
export const GEM_INK = ['#1b2a33', '#ffffff', '#06281a', '#ffffff', '#ffffff', '#2a1c05'];
// Shape name of each gem (a key of SHAPES), same indexing.
export const GEM_SHAPES = ['rhombus', 'circle', 'octagon', 'triangle', 'hexagon', 'star'];

/**
 * An SVG path from its drawing commands, one argument each.
 * @param {...string} commands  the commands in order ('M12 1.5', 'L22.5 12', ...)
 * @returns {string} the `d` attribute value
 * Side effects: none.
 */
const path = (...commands) => commands.join(' ');

/**
 * Builds the points string of the Gold star: 16 points alternating outer and inner radius around (12, 12).
 * @returns {string} SVG `points` attribute value
 * Side effects: none.
 */
const star = () => {
  const points = [];
  for (let k = 0; k < 16; k++) {
    const radius = k % 2 === 0 ? 11.5 : 6.6;
    const angle = (k * Math.PI) / 8 - Math.PI / 2;
    points.push(`${(12 + radius * Math.cos(angle)).toFixed(2)},${(12 + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return points.join(' ');
};

/** The outline of each shape on a 24 by 24 canvas, and a lighter "facet" drawn on top of it. */
export const SHAPES = {
  rhombus: { outline: path('M12 1.5', 'L22.5 12', 'L12 22.5', 'L1.5 12', 'Z'), facet: path('M12 1.5', 'L22.5 12', 'L12 12', 'Z') },
  circle: { outline: path('M12 1.8', 'a10.2 10.2 0 1 0 0.001 0', 'Z'), facet: path('M12 1.8', 'A10.2 10.2 0 0 1 22.2 12', 'L12 12', 'Z') },
  octagon: { outline: path('M7.8 2', 'H16.2', 'L22 7.8', 'V16.2', 'L16.2 22', 'H7.8', 'L2 16.2', 'V7.8', 'Z'), facet: path('M7.8 2', 'H16.2', 'L22 7.8', 'L12 12', 'Z') },
  triangle: { outline: path('M12 2.2', 'L22.4 21', 'H1.6', 'Z'), facet: path('M12 2.2', 'L22.4 21', 'L12 21', 'Z') },
  hexagon: { outline: path('M12 1.6', 'L21.4 6.8', 'V17.2', 'L12 22.4', 'L2.6 17.2', 'V6.8', 'Z'), facet: path('M12 1.6', 'L21.4 6.8', 'L12 12', 'Z') },
  star: { polygon: star(), facet: path('M12 0.5', 'L14.2 8', 'L12 12', 'Z') },
};
