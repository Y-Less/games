<script setup>
// The shop: spend the coins you win (500, 200 and 100 for coming 1st, 2nd and 3rd in a game) on name styles,
// backgrounds, card backs and avatar parts. Anything you own can be put on straight from here. Each tab has its own
// address (/shop/avatar ...), so Back and Forward move between them and a tab can be linked to.
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { normaliseAvatar } from '../../shared/avatar.js';
import AvatarFigure from '../components/AvatarFigure.vue';
import StyledName from '../components/StyledName.vue';
import { backgroundCss, buy, cardBackCss, refreshShop, session, updateProfile } from '../session.js';

const TABS = [
  { type: 'name-style', slug: 'names', label: 'Name styles', blurb: 'A border and background around your name, wherever other players see it.' },
  { type: 'background', slug: 'backgrounds', label: 'Backgrounds', blurb: 'The picture behind the site and the game tables.' },
  { type: 'card-back', slug: 'card-backs', label: 'Card backs', blurb: 'What the face-down cards look like to you in every card game.' },
  { type: 'avatar', slug: 'avatar', label: 'Avatar', blurb: 'Hair, clothes, hats and more for your avatar, shown in your details pop-up in games. Each part is shown on you.' },
  { type: 'unlock', slug: 'unlocks', label: 'Unlocks', blurb: 'Choose your own colour, gradient or picture on the Profile page.' },
];
const route = useRoute();
// The tab named in the address (the first one for /shop on its own).
const current = computed(() => TABS.find((t) => t.slug === route.params.tab) ?? TABS[0]);
const tab = computed(() => current.value.type);
const message = ref('');
const problem = ref('');
const busy = ref('');

onMounted(refreshShop);

const balance = computed(() => session.shop?.balance ?? 0);
const items = computed(() => (session.shop?.items ?? []).filter((item) => item.type === tab.value));

const key = (item) => item.id.slice(item.id.indexOf(':') + 1);
function equipped(item) {
  const u = session.user;
  if (item.type === 'name-style') return u.nameStyle?.style === key(item);
  if (item.type === 'avatar') return normaliseAvatar(u.avatar)[item.slot] === item.option;
  if (item.type === 'background') return u.background?.type === 'preset' && u.background.value === key(item);
  if (item.type === 'card-back') return u.cardBack?.type === 'preset' && u.cardBack.value === key(item);
  return false;
}

async function attempt(id, task, done) {
  message.value = problem.value = '';
  busy.value = id;
  try {
    await task();
    message.value = done;
  } catch (e) {
    problem.value = e.message;
  } finally {
    busy.value = '';
  }
}
const purchase = (item) => attempt(item.id, () => buy(item.id), `You bought ${item.name}.`);
function use(item) {
  const avatar = { ...normaliseAvatar(session.user.avatar), [item.slot]: item.option };
  const change = { avatar: { avatar }, 'name-style': { nameStyle: { style: key(item) } }, background: { background: { type: 'preset', value: key(item) } }, 'card-back': { cardBack: { type: 'preset', value: key(item) } } }[item.type];
  return attempt(item.id, () => updateProfile(change), `${item.name} is on.`);
}
</script>

<template>
  <section class="stack shop">
    <header class="top">
      <h1>Shop</h1>
      <p class="coins" aria-live="polite"><span class="coin" aria-hidden="true" /> <strong>{{ balance }}</strong> coins</p>
    </header>
    <p class="muted intro">Coins are won, never bought: 500 for coming 1st in a game, 200 for 2nd and 100 for 3rd.</p>
    <p v-if="message" class="ok" role="status">{{ message }}</p>
    <p v-if="problem" class="bad" role="alert">{{ problem }}</p>

    <div class="tabs" role="tablist" aria-label="What to browse">
      <RouterLink v-for="t in TABS" :key="t.type" :to="`/shop/${t.slug}`" role="tab" class="tab" :class="{ on: tab === t.type }" :aria-selected="tab === t.type">{{ t.label }}</RouterLink>
    </div>
    <p class="muted blurb">{{ current.blurb }}</p>

    <p v-if="!session.shop" class="panel">Loading…</p>
    <ul v-else class="items">
      <li v-for="item in items" :key="item.id" class="item panel" :class="{ on: equipped(item) }" :data-item="item.id">
        <div class="preview">
          <StyledName v-if="item.type === 'name-style'" :name="session.user.displayName" :style-id="key(item)" />
          <AvatarFigure v-else-if="item.type === 'avatar'" :avatar="{ ...normaliseAvatar(session.user.avatar), [item.slot]: item.option }" size="4rem" />
          <span v-else-if="item.type === 'background'" class="swatch" :style="{ backgroundImage: backgroundCss({ type: 'preset', value: key(item) }) }" />
          <span v-else-if="item.type === 'card-back'" class="back" :style="{ background: cardBackCss({ type: 'preset', value: key(item) }) }" />
          <span v-else class="unlock" aria-hidden="true">★</span>
        </div>
        <strong class="name">{{ item.name }}</strong>
        <span v-if="item.owned && equipped(item)" class="state">In use</span>
        <button v-else-if="item.owned && item.type !== 'unlock'" :disabled="busy === item.id" @click="use(item)">Use</button>
        <span v-else-if="item.owned" class="state">Unlocked</span>
        <button v-else class="primary" :disabled="busy === item.id || balance < item.price" :title="balance < item.price ? `You need ${item.price - balance} more coins` : undefined" @click="purchase(item)">
          Buy for {{ item.price }}
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.shop {
  max-width: 820px;
  margin: 0 auto;
}
.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
h1 {
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.intro,
.blurb {
  margin: 0;
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.coins {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1.15rem;
  padding: 0.25rem 0.8rem;
  border-radius: 999px;
  background: rgb(14 26 32 / 0.88);
  border: 1px solid var(--amber);
}
.coin {
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ffe08a, #c79a3b 70%);
  box-shadow: inset 0 0 0 2px #9c7425;
}
.ok,
.bad {
  margin: 0;
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  background: rgb(14 26 32 / 0.88);
}
.ok {
  color: var(--moss);
}
.bad {
  color: var(--danger);
}
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tab {
  border-radius: 999px;
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--line);
  background: rgb(14 26 32 / 0.88);
  color: inherit;
  text-decoration: none;
}
.tab.on {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
}
.items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.8rem;
}
.item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
  background: rgb(14 26 32 / 0.88);
}
.item.on {
  border-color: var(--amber);
  box-shadow: 0 0 0 1px var(--amber);
}
.preview {
  height: 4.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
}
.swatch {
  display: block;
  width: 5.5rem;
  height: 3.4rem;
  border-radius: 10px;
  background-size: cover;
  border: 2px solid var(--line);
}
.back {
  display: block;
  width: 2.8rem;
  height: 3.9rem;
  border-radius: 6px;
  border: 3px solid #f4efe3;
}
.unlock {
  font-size: 2rem;
  color: var(--amber);
}
.state {
  color: var(--muted);
  font-size: 0.9rem;
  padding: 0.35rem 0;
}
.item button {
  width: 100%;
}
</style>
