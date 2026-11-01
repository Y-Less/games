// The site's client-side state in one reactive object: who is signed in, the list of games and the preset looks.
// Reading and changing it is done by session.js (sign in and out), shopStore.js (the shop) and profileApi.js (the profile).
import { reactive } from 'vue';

export const session = reactive({
  ready: false, // true once we know whether anyone is signed in
  user: null,
  games: [],
  presets: {},
  cardBacks: {},
  shop: null, // { balance, items: [{ id, type, name, price, owned }] } once fetched: what is for sale and your coins
});
