// How the screen guides the player through each tool: which things to click, and how they become the request's
// parameters.  The server checks everything again; this only decides what to ask for and what to highlight.
/**
 * The guidance of each tool, by tool id: `kind` says what the player is asked to click (see useTools' toolParams), `min`/`max`
 * how many slide moves are needed, `options` the rules a slide relaxes (passed to rules.js) and `sameColour` that a second
 * moved die must match the first.  Tools missing from here fall back to a plain confirm button in startMode.
 * Side effects: none (a constant).
 */
const TOOL_KINDS = {
  lathe: { kind: 'delta' }, // a pool die, then raise or lower it
  mirror: { kind: 'pool' }, // a pool die
  refire: { kind: 'pool' },
  exchange: { kind: 'exchange' }, // a pool die and a die on the round track
  kiln: { kind: 'confirm' },
  'swift-hand': { kind: 'confirm' },
  slide: { kind: 'moves', min: 1, max: 1, options: {} },
  twin: { kind: 'moves', min: 2, max: 2, options: {} },
  tint: { kind: 'moves', min: 1, max: 1, options: { ignoreColour: true } },
  gauge: { kind: 'moves', min: 1, max: 1, options: { ignoreShade: true } },
  echo: { kind: 'moves', min: 1, max: 2, options: {}, sameColour: true },
  'free-pane': { kind: 'free', options: { ignoreTouch: true } },
};

/**
 * A fresh guided-use state for a tool.
 *
 * @param {{ id: string, cost: number }} tool  a tool card from the view (its words are read from its id, see the locale file)
 * @param {(object | null)[]} grid  the player's window now (slide tools preview their moves on a copy of it)
 * @returns {object} the kind of guidance, the choices made so far (none) and the window to preview on
 * Side effects: none (the grid is shared, not copied: slide moves replace m.grid rather than editing it).
 */
export function startMode(tool, grid) {
  const def = TOOL_KINDS[tool.id] ?? { kind: 'confirm' };
  return { id: tool.id, cost: tool.cost, ...def, die: null, trackDie: null, from: null, moves: [], grid };
}
