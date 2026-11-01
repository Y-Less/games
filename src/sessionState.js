// The site's client-side state in one reactive object: who is signed in, the list of games and the preset looks.
// Reading and changing it is done by session.js (sign in and out), shopStore.js (the shop) and profileApi.js (the profile).
// Depends on: vue (reactive) only.
import { reactive } from 'vue';

// The one shared reactive store; other modules mutate it directly. Kept in its own file so that session.js, shopStore.js
// and profileApi.js can all import it without importing each other (no cycles).

export const session = reactive({
  ready: false, // true once we know whether anyone is signed in
  user: null,
  games: [],
  presets: {},
  cardBacks: {},
  shop: null, // { balance, items: [{ id, type, name, price, owned }] } once fetched: what is for sale and your coins
});
