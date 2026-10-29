// Animations bought in the shop: effects on a player's name pill, its border or its background (seen by everyone who sees the name) and on their own
// website background (seen only by them, behind every page and game table). The server lists them as shop items and checks
// a player owns the one they choose; the client draws them in CSS (src/components/StyledName.vue and BackgroundFx.vue).
// `none` is the free, still choice in each list.

// `part` is what moves: the pill's border or its background.
export const NAME_ANIMATIONS = [
  { id: 'none', name: 'Still', price: 0, part: 'none' },
  { id: 'glow', name: 'Glow', price: 500, part: 'border' },
  { id: 'pulse', name: 'Pulse', price: 600, part: 'background' },
  { id: 'stripes', name: 'Moving stripes', price: 800, part: 'background' },
  { id: 'shimmer', name: 'Shimmer', price: 800, part: 'background' },
  { id: 'sparkle', name: 'Sparkle', price: 900, part: 'background' },
  { id: 'flow', name: 'Flowing colour', price: 1000, part: 'background' },
  { id: 'rainbow', name: 'Rainbow border', price: 1500, part: 'border' },
];

export const BACKGROUND_ANIMATIONS = [
  { id: 'none', name: 'Still', price: 0 },
  { id: 'sweep', name: 'Light sweep', price: 600 },
  { id: 'gradient', name: 'Moving gradient', price: 1200 }, // slides the gradient you chose on your Profile along its angle
  { id: 'stars', name: 'Twinkling stars', price: 800 },
  { id: 'snow', name: 'Snowfall', price: 800 },
  { id: 'embers', name: 'Rising embers', price: 1000 },
  { id: 'aurora', name: 'Aurora', price: 1500 },
  { id: 'matrix-a', name: 'Matrix A', price: 1500 }, // the first rain: each column of letters slides down the screen
  { id: 'matrix', name: 'Matrix B', price: 1500 }, // the letters stay put: a head leaves them behind and they fade
];

const nameIds = new Set(NAME_ANIMATIONS.map((a) => a.id));
const backgroundIds = new Set(BACKGROUND_ANIMATIONS.map((a) => a.id));
export const isNameAnimation = (id) => typeof id === 'string' && nameIds.has(id);
export const isBackgroundAnimation = (id) => typeof id === 'string' && backgroundIds.has(id);
