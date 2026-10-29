// Name styles: the small border and background around a player's name, bought in the shop and shown wherever the name
// appears. The server lists them as shop items and checks a player owns the one they choose; the client draws them
// (src/components/StyledName.vue) from the colours here, so a style is one entry in this list.
//
// `border` and `fill` are CSS colours. `fill` may also be a gradient. `text` is optional (default: the normal text colour).

export const NAME_STYLES = [
  { id: 'plain', name: 'Plain', price: 0, border: 'transparent', fill: 'transparent' },
  { id: 'bronze', name: 'Bronze', price: 300, border: '#b0773e', fill: 'rgb(176 119 62 / 0.2)' },
  { id: 'silver', name: 'Silver', price: 500, border: '#c4cdd6', fill: 'rgb(196 205 214 / 0.16)' },
  { id: 'gold', name: 'Gold', price: 800, border: '#e0b84a', fill: 'rgb(224 184 74 / 0.2)' },
  { id: 'ruby', name: 'Ruby', price: 600, border: '#d9506a', fill: 'rgb(217 80 106 / 0.2)' },
  { id: 'emerald', name: 'Emerald', price: 600, border: '#4fc08a', fill: 'rgb(79 192 138 / 0.18)' },
  { id: 'sapphire', name: 'Sapphire', price: 600, border: '#5a8fe0', fill: 'rgb(90 143 224 / 0.2)' },
  { id: 'amethyst', name: 'Amethyst', price: 600, border: '#a478dc', fill: 'rgb(164 120 220 / 0.2)' },
  { id: 'midnight', name: 'Midnight', price: 1000, border: '#7fd0ff', fill: '#0c1830', text: '#dff3ff' },
  { id: 'sunset', name: 'Sunset', price: 1500, border: '#ffb36b', fill: 'linear-gradient(100deg, rgb(255 106 80 / 0.45), rgb(255 190 90 / 0.45))' },
  { id: 'royal', name: 'Royal', price: 2000, border: '#e0b84a', fill: 'linear-gradient(100deg, #3a1d6e, #6a2f8f)', text: '#fff3cf' },
  { id: 'obsidian', name: 'Obsidian', price: 1000, border: '#8a8f99', fill: '#14161a', text: '#e6e8ec' },
  { id: 'ocean', name: 'Ocean', price: 1500, border: '#4fd0d0', fill: 'linear-gradient(100deg, rgb(20 90 140 / 0.6), rgb(40 190 190 / 0.5))' },
  { id: 'ember', name: 'Ember', price: 1500, border: '#ff7a3d', fill: 'linear-gradient(100deg, rgb(120 20 20 / 0.7), rgb(255 130 50 / 0.55))', text: '#fff1e6' },
  { id: 'toxic', name: 'Toxic', price: 1000, border: '#39ff88', fill: '#07140d', text: '#b8ffd6' },
];

export const DEFAULT_NAME_STYLE = { style: 'plain' };

const byId = new Map(NAME_STYLES.map((s) => [s.id, s]));
export const nameStyleById = (id) => byId.get(id) ?? byId.get('plain');
export const isNameStyle = (id) => typeof id === 'string' && byId.has(id);
