// Avatars: a little figure built from layered parts (skin, hair, eyes, a hat ...), shown in a player's pop-up. This file is
// the catalogue, shared by the server (which lists the priced parts in the shop and refuses parts a player has not bought)
// and the client (src/avatarArt.js draws each part). An avatar is one chosen option id per slot, e.g. { skin: 'tan', hair: 'curly' }.
//
// An option has an `id`, a `name` and a `price` in coins (0 = free for everyone). Colour options also have `colour`, and a
// backdrop may have `gradient` (two colours) instead.

export const AVATAR_SLOTS = [
  {
    slot: 'skin',
    label: 'Skin',
    options: [
      { id: 'pale', name: 'Pale', price: 0, colour: '#f6d9c4' },
      { id: 'light', name: 'Light', price: 0, colour: '#efc3a0' },
      { id: 'tan', name: 'Tan', price: 0, colour: '#d9a37a' },
      { id: 'brown', name: 'Brown', price: 0, colour: '#a8734f' },
      { id: 'deep', name: 'Deep', price: 0, colour: '#7a4a30' },
      { id: 'dark', name: 'Dark', price: 0, colour: '#4f2f20' },
    ],
  },
  {
    slot: 'hair',
    label: 'Hair',
    options: [
      { id: 'short', name: 'Short', price: 0 },
      { id: 'bald', name: 'Bald', price: 0 },
      { id: 'long', name: 'Long', price: 100 },
      { id: 'scraggly', name: 'Long and scraggly', price: 200 },
      { id: 'curly', name: 'Curly', price: 150 },
      { id: 'spiky', name: 'Spiky', price: 150 },
      { id: 'bun', name: 'Bun', price: 200 },
      { id: 'afro', name: 'Afro', price: 250 },
      { id: 'mohawk', name: 'Mohawk', price: 300 },
      { id: 'bob', name: 'Bob', price: 150 },
      { id: 'pigtails', name: 'Pigtails', price: 200 },
      { id: 'quiff', name: 'Quiff', price: 250 },
    ],
  },
  {
    slot: 'hairColour',
    label: 'Hair colour',
    options: [
      { id: 'black', name: 'Black', price: 0, colour: '#1f1a1a' },
      { id: 'brown', name: 'Brown', price: 0, colour: '#5a3825' },
      { id: 'blonde', name: 'Blonde', price: 0, colour: '#d9b45a' },
      { id: 'ginger', name: 'Ginger', price: 0, colour: '#b5502a' },
      { id: 'grey', name: 'Grey', price: 0, colour: '#aeb4b8' },
      { id: 'pink', name: 'Pink', price: 150, colour: '#e86fa5' },
      { id: 'blue', name: 'Blue', price: 150, colour: '#4a8fe0' },
      { id: 'green', name: 'Green', price: 150, colour: '#4fb06a' },
      { id: 'purple', name: 'Purple', price: 150, colour: '#8a5ad0' },
    ],
  },
  {
    slot: 'facialHair',
    label: 'Facial hair',
    options: [
      { id: 'none', name: 'None', price: 0 },
      { id: 'stubble', name: 'Stubble', price: 100 },
      { id: 'moustache', name: 'Moustache', price: 150 },
      { id: 'handlebar', name: 'Handlebar', price: 250 },
      { id: 'goatee', name: 'Goatee', price: 200 },
      { id: 'beard', name: 'Full beard', price: 300 },
    ],
  },
  {
    slot: 'eyes',
    label: 'Eyes',
    options: [
      { id: 'round', name: 'Round', price: 0 },
      { id: 'happy', name: 'Happy', price: 0 },
      { id: 'sleepy', name: 'Sleepy', price: 50 },
      { id: 'wink', name: 'Wink', price: 100 },
      { id: 'stars', name: 'Starry', price: 300 },
      { id: 'wide', name: 'Wide', price: 50 },
      { id: 'closed', name: 'Closed', price: 50 },
      { id: 'angry', name: 'Angry', price: 100 },
      { id: 'hearts', name: 'Lovestruck', price: 300 },
      { id: 'scowl', name: 'Scowl', price: 100 },
      { id: 'sad', name: 'Sad', price: 100 },
    ],
  },
  {
    slot: 'mouth',
    label: 'Mouth',
    options: [
      { id: 'smile', name: 'Smile', price: 0 },
      { id: 'neutral', name: 'Neutral', price: 0 },
      { id: 'grin', name: 'Grin', price: 50 },
      { id: 'open', name: 'Surprised', price: 50 },
      { id: 'tongue', name: 'Cheeky', price: 100 },
      { id: 'smirk', name: 'Smirk', price: 50 },
      { id: 'frown', name: 'Frown', price: 50 },
      { id: 'kiss', name: 'Kiss', price: 100 },
      { id: 'laugh', name: 'Laugh', price: 100 },
      { id: 'fangs', name: 'Fangs', price: 250 },
      { id: 'scowl', name: 'Scowl', price: 50 },
      { id: 'sad', name: 'Sad', price: 50 },
    ],
  },
  {
    slot: 'glasses',
    label: 'Glasses',
    options: [
      { id: 'none', name: 'None', price: 0 },
      { id: 'round', name: 'Round', price: 200 },
      { id: 'square', name: 'Square', price: 200 },
      { id: 'monocle', name: 'Monocle', price: 300 },
      { id: 'shades', name: 'Shades', price: 400 },
      { id: 'eyepatch', name: 'Eye patch', price: 200 },
      { id: 'heart', name: 'Heart-shaped', price: 250 },
      { id: 'goggles', name: 'Goggles', price: 300 },
    ],
  },
  {
    slot: 'top',
    label: 'Clothes',
    options: [
      { id: 'tee', name: 'T-shirt', price: 0 },
      { id: 'polo', name: 'Polo shirt', price: 100 },
      { id: 'hoodie', name: 'Hoodie', price: 200 },
      { id: 'stripes', name: 'Stripes', price: 200 },
      { id: 'suit', name: 'Suit', price: 400 },
      { id: 'armour', name: 'Armour', price: 600 },
      { id: 'tank', name: 'Vest top', price: 50 },
      { id: 'turtleneck', name: 'Polo neck', price: 150 },
      { id: 'jersey', name: 'Number 7 jersey', price: 200 },
      { id: 'scarf', name: 'Scarf', price: 200 },
      { id: 'overalls', name: 'Dungarees', price: 250 },
      { id: 'tuxedo', name: 'Dinner jacket', price: 500 },
      { id: 'cape', name: 'Cape', price: 700 },
    ],
  },
  {
    slot: 'topColour',
    label: 'Clothes colour',
    options: [
      { id: 'red', name: 'Red', price: 0, colour: '#c9473f' },
      { id: 'orange', name: 'Orange', price: 0, colour: '#e08a3c' },
      { id: 'yellow', name: 'Yellow', price: 0, colour: '#e2c13f' },
      { id: 'green', name: 'Green', price: 0, colour: '#4a9e5c' },
      { id: 'teal', name: 'Teal', price: 0, colour: '#2f9aa0' },
      { id: 'blue', name: 'Blue', price: 0, colour: '#3f6fc4' },
      { id: 'purple', name: 'Purple', price: 0, colour: '#7d52b8' },
      { id: 'pink', name: 'Pink', price: 0, colour: '#d8719c' },
      { id: 'white', name: 'White', price: 0, colour: '#eee9dc' },
      { id: 'black', name: 'Black', price: 0, colour: '#2b2b33' },
    ],
  },
  {
    slot: 'hat',
    label: 'Hat',
    options: [
      { id: 'none', name: 'None', price: 0 },
      { id: 'cap', name: 'Cap', price: 200 },
      { id: 'beanie', name: 'Beanie', price: 200 },
      { id: 'party', name: 'Party hat', price: 300 },
      { id: 'tophat', name: 'Top hat', price: 500 },
      { id: 'crown', name: 'Crown', price: 1500 },
      { id: 'bucket', name: 'Bucket hat', price: 250 },
      { id: 'santa', name: 'Santa hat', price: 300 },
      { id: 'headphones', name: 'Headphones', price: 350 },
      { id: 'cowboy', name: 'Cowboy hat', price: 400 },
      { id: 'wizard', name: 'Wizard hat', price: 600 },
      { id: 'knight', name: 'Knight helmet', price: 800 },
    ],
  },
  {
    slot: 'backdrop',
    label: 'Backdrop',
    options: [
      { id: 'slate', name: 'Slate', price: 0, colour: '#31424d' },
      { id: 'sky', name: 'Sky', price: 0, colour: '#5a8fb8' },
      { id: 'mint', name: 'Mint', price: 0, colour: '#5fae94' },
      { id: 'rose', name: 'Rose', price: 0, colour: '#b8667a' },
      { id: 'gold', name: 'Gold', price: 200, colour: '#c9a24a' },
      { id: 'night', name: 'Night', price: 200, colour: '#1b2340' },
      { id: 'sunset', name: 'Sunset', price: 300, colour: '#e0806a', gradient: ['#f0b45c', '#b84f7a'] },
      { id: 'ocean', name: 'Ocean', price: 300, colour: '#2f7fa0', gradient: ['#6cc4d8', '#24467a'] },
    ],
  },
];

const bySlot = new Map(AVATAR_SLOTS.map((s) => [s.slot, new Map(s.options.map((o) => [o.id, o]))]));

/** An avatar with the first (free) option of every slot. */
export const DEFAULT_AVATAR = Object.freeze(Object.fromEntries(AVATAR_SLOTS.map((s) => [s.slot, s.options[0].id])));

/** The shop item id of an option (items are listed by server/shop.js). */
export const avatarItemId = (slot, id) => `av:${slot}:${id}`;

/** The option with this id in this slot, or null. */
export const avatarOption = (slot, id) => (typeof id === 'string' ? bySlot.get(slot)?.get(id) ?? null : null);
export const isAvatarOption = (slot, id) => avatarOption(slot, id) !== null;

/** Every option as { id, slot, option, name, price } for the shop: the priced ones are bought, the free ones belong to everyone. */
export function avatarItems() {
  return AVATAR_SLOTS.flatMap((s) => s.options.map((o) => ({ id: avatarItemId(s.slot, o.id), slot: s.slot, option: o.id, name: `${s.label}: ${o.name}`, price: o.price })));
}

/** An avatar that is safe to draw: every slot has a known option (anything else becomes the default one). */
export function normaliseAvatar(input) {
  const out = {};
  for (const { slot } of AVATAR_SLOTS) out[slot] = isAvatarOption(slot, input?.[slot]) ? input[slot] : DEFAULT_AVATAR[slot];
  return out;
}
