// How the screen guides the player through each tool: which things to click, and how they become the request's
// parameters. The server checks everything again; this only decides what to ask for and what to highlight.
export const TOOL_KINDS = {
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

/** A fresh guided-use state for a tool. */
export function startMode(tool, grid) {
  const def = TOOL_KINDS[tool.id] ?? { kind: 'confirm' };
  return { id: tool.id, name: tool.name, cost: tool.cost, how: tool.how, ...def, die: null, trackDie: null, from: null, moves: [], grid };
}
