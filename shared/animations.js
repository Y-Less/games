// Animations bought in the shop: effects on a player's name border (seen by everyone who sees the name) and on their own
// website background (seen only by them, behind every page and game table). The server lists them as shop items and checks
// a player owns the one they choose; the client draws them in CSS (src/components/StyledName.vue and BackgroundFx.vue).
// `none` is the free, still choice in each list.

export const NAME_ANIMATIONS = [
  { id: 'none', name: 'Still', price: 0 },
  { id: 'glow', name: 'Glow', price: 500 },
  { id: 'pulse', name: 'Pulse', price: 600 },
  { id: 'shimmer', name: 'Shimmer', price: 800 },
  { id: 'rainbow', name: 'Rainbow border', price: 1500 },
];

export const BACKGROUND_ANIMATIONS = [
  { id: 'none', name: 'Still', price: 0 },
  { id: 'sweep', name: 'Light sweep', price: 600 },
  { id: 'stars', name: 'Twinkling stars', price: 800 },
  { id: 'snow', name: 'Snowfall', price: 800 },
  { id: 'embers', name: 'Rising embers', price: 1000 },
  { id: 'aurora', name: 'Aurora', price: 1500 },
];

const nameIds = new Set(NAME_ANIMATIONS.map((a) => a.id));
const backgroundIds = new Set(BACKGROUND_ANIMATIONS.map((a) => a.id));
export const isNameAnimation = (id) => typeof id === 'string' && nameIds.has(id);
export const isBackgroundAnimation = (id) => typeof id === 'string' && backgroundIds.has(id);
