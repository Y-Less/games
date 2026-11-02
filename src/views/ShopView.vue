<script setup>
// The shop: spend the gold you win (100, 50 and 20 for coming 1st, 2nd, and 3rd in a game) on name styles,
// backgrounds, card backs, and avatar parts.  Anything you own can be put on straight from here.  Each tab has its own
// address (/shop/avatar ...), so Back and Forward move between them and a tab can be linked to.
// Props: none (the tab comes from the route).  Emits: none.  Slots: none.
// Depends on: shopStore.js (listing, buy), profileApi.js (use an item), session.js, appearance.js, catalogueText.js (item
// and avatar part names a language may translate), shared/avatar.js and the preview components.
// Side effects: refreshes the shop on mount; buying spends coins; using an item saves the profile.
import { computed, onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { AVATAR_SLOTS, normaliseAvatar } from '../../shared/avatar.js';
import AvatarFigure from '../components/AvatarFigure.vue';
import BackgroundFx from '../components/BackgroundFx.vue';
import StyledName from '../components/StyledName.vue';
import { animationsPlaying, backgroundCss, cardBackCss } from '../appearance.js';
import { catalogue } from '../catalogueText.js';
import { updateProfile } from '../profileApi.js';
import { session } from '../session.js';
import { buy, refreshShop } from '../shopStore.js';

// The shop's tabs: the URL slug, the key of the label, and the kinds of item listed under each, with the key of each
// section's title (an avatar section is titled by its slot, which the catalogue names).
const TABS = [
  {
    slug: 'names',
    label: 'shop.tabs.names',
    sections: [{ type: 'name-style', title: 'shop.sections.styles' }, { type: 'name-animation', title: 'shop.sections.animations' }],
  },
  {
    slug: 'backgrounds',
    label: 'shop.tabs.backgrounds',
    sections: [{ type: 'background', title: 'shop.sections.pictures' }, { type: 'background-animation', title: 'shop.sections.animations' }],
  },
  {
    slug: 'themes',
    label: 'shop.tabs.themes',
    sections: [{ type: 'site-theme', title: 'shop.sections.colours' }, { type: 'site-font', title: 'shop.sections.fonts' }],
  },
  { slug: 'card-backs', label: 'shop.tabs.cardBacks', sections: [{ type: 'card-back' }] },
  { slug: 'avatar', label: 'shop.tabs.avatar', sections: AVATAR_SLOTS.map((slot) => ({ type: 'avatar', slot: slot.slot, slotDefinition: slot })) },
  { slug: 'unlocks', label: 'shop.tabs.unlocks', sections: [{ type: 'unlock' }] },
];
const route = useRoute();
// The tab named in the address (the first one for /shop on its own).
const current = computed(() => TABS.find((t) => t.slug === route.params.tab) ?? TABS[0]);
// The current tab's slug.
const tab = computed(() => current.value.slug);
const problem = ref(''); // the last error message
const busy = ref(''); // the id of the item being bought or put on, or ''

onMounted(refreshShop);

// Your coins (0 until the listing arrives).
const balance = computed(() => session.shop?.balance ?? 0);
// The tab's items, one list for each kind of thing it sells (avatar parts have a list for each slot: hair, eyes, hats ...).
const sections = computed(() => current.value.sections.map((s) => ({ ...s, items: (session.shop?.items ?? []).filter((item) => item.type === s.type && (!s.slot || item.slot === s.slot)) })));

// Returns the item's id without its type prefix (the id the profile settings use).
const key = (item) => item.id.slice(item.id.indexOf(':') + 1);
/**
 * Whether you are currently using this item.
 * @param {object} item  a shop listing entry ({ id, type, slot?, option? ... })
 * @returns {boolean}
 * Side effects: none.
 */
function equipped(item) {
  const u = session.user;
  if (item.type === 'name-style') return u.nameStyle?.style === key(item);
  if (item.type === 'name-animation') return (u.nameStyle?.animation ?? 'none') === key(item);
  if (item.type === 'background-animation') return (u.backgroundAnimation ?? 'none') === key(item);
  if (item.type === 'avatar') return normaliseAvatar(u.avatar)[item.slot] === item.option;
  if (item.type === 'background') return u.background?.type === 'preset' && u.background.value === key(item);
  if (item.type === 'card-back') return u.cardBack?.type === 'preset' && u.cardBack.value === key(item);
  if (item.type === 'site-theme') return u.siteTheme === key(item);
  if (item.type === 'site-font') return u.siteFont === key(item);
  return false;
}

/**
 * Runs a shop action while marking the item busy.
 * @param {string} id  the item id (shown as busy)
 * @param {() => Promise<*>} task  the action
 * @returns {Promise<void>}
 * Side effects: sets busy and problem; runs the task.
 */
async function attempt(id, task) {
  problem.value = '';
  busy.value = id;
  try {
    await task();
  } catch (e) {
    problem.value = e.message;
  } finally {
    busy.value = '';
  }
}
// Buys `item` (returns the promise of the attempt).
const purchase = (item) => attempt(item.id, () => buy(item.id));
// Returns a nameStyle setting with the animation only when there is a real one.
const nameStyleWith = (style, animation) => (animation && animation !== 'none' ? { style, animation } : { style });
/**
 * Puts an owned item on (saves it to the profile).
 * @param {object} item  a shop listing entry
 * @returns {Promise<void>}
 * Side effects: saves the profile through updateProfile, which replaces the session's user.
 */
function use(item) {
  const avatar = { ...normaliseAvatar(session.user.avatar), [item.slot]: item.option };
  const change = {
    avatar: { avatar },
    'name-style': { nameStyle: nameStyleWith(key(item), session.user.nameStyle?.animation) },
    'name-animation': { nameStyle: nameStyleWith(session.user.nameStyle?.style ?? 'plain', key(item)) },
    'background-animation': { backgroundAnimation: key(item) }, background: { background: { type: 'preset', value: key(item) } }, 'card-back': { cardBack: { type: 'preset', value: key(item) } }, 'site-theme': { siteTheme: key(item) }, 'site-font': { siteFont: key(item) } }[item.type];
  return attempt(item.id, () => updateProfile(change));
}
</script>

<template>
  <section class="stack shop">
    <header class="top">
      <h1>{{ $t('shop.title') }}</h1>
      <p class="coins" aria-live="polite">
        <span class="coin" aria-hidden="true" />
        <i18n-t keypath="shop.goldBalance" tag="span"><template #n><strong>{{ balance }}</strong></template></i18n-t>
      </p>
    </header>
    <i18n-t v-if="!animationsPlaying() && current.sections.length > 1" keypath="shop.paused" tag="p" class="muted motion" role="status">
      <template #option>{{ $t('profile.alwaysPlay') }}</template>
      <template #profile><RouterLink to="/profile">{{ $t('shop.profileLink') }}</RouterLink></template>
    </i18n-t>
    <p v-if="problem" class="bad" role="alert">{{ problem }}</p>

    <div class="tabs" role="tablist" :aria-label="$t('shop.browse')">
      <RouterLink v-for="t in TABS" :key="t.slug" :to="`/shop/${t.slug}`" role="tab" class="tab" :class="{ on: tab === t.slug }" :aria-selected="tab === t.slug">{{ $t(t.label) }}</RouterLink>
    </div>

    <p v-if="!session.shop" class="panel">{{ $t('common.loading') }}</p>
    <template v-else>
      <section v-for="section in sections" :key="section.slot ?? section.type" class="group">
        <h2 v-if="current.sections.length > 1" class="group-title">{{ section.title ? $t(section.title) : catalogue.avatarSlotLabel(section.slotDefinition) }}</h2>
        <ul class="items">
          <li v-for="item in section.items" :key="item.id" class="item panel" :class="{ on: equipped(item) }" :data-item="item.id">
        <div class="preview">
          <StyledName v-if="item.type === 'name-style'" :name="session.user.displayName" :style-id="key(item)" :animation-id="session.user.nameStyle?.animation ?? 'none'" />
          <StyledName v-else-if="item.type === 'name-animation'" :name="session.user.displayName" :style-id="session.user.nameStyle?.style ?? 'plain'" :animation-id="key(item)" />
          <span v-else-if="item.type === 'background-animation'" class="swatch fx-box" :style="{ backgroundImage: backgroundCss(session.user.background) }"><BackgroundFx :effect="key(item)" :background="session.user.background" demo /></span>
          <AvatarFigure v-else-if="item.type === 'avatar'" :avatar="{ ...normaliseAvatar(session.user.avatar), [item.slot]: item.option }" size="4rem" />
          <span v-else-if="item.type === 'background'" class="swatch fx-box" :style="{ backgroundImage: backgroundCss({ type: 'preset', value: key(item) }) }"><BackgroundFx :effect="session.user.backgroundAnimation === 'gradient' ? 'none' : session.user.backgroundAnimation" demo /></span>
          <span v-else-if="item.type === 'card-back'" class="back" :style="{ background: cardBackCss({ type: 'preset', value: key(item) }) }" />
          <span v-else-if="item.type === 'site-theme'" class="theme" :style="{ background: item.colours.bg, borderColor: item.colours.line }"><i :style="{ background: item.colours.raised, borderColor: item.colours.line }"><b :style="{ background: item.colours.amber }" /><u :style="{ background: item.colours.muted }" /></i></span>
          <span v-else-if="item.type === 'site-font'" class="font-sample" :style="{ fontFamily: item.display }">Aa</span>
          <span v-else class="unlock" aria-hidden="true">★</span>
        </div>
        <strong class="name">{{ catalogue.shopItemName(item) }}</strong>
        <span v-if="item.type === 'name-animation' && item.part !== 'none'" class="kind">{{ item.part === 'border' ? $t('shop.movesBorder') : $t('shop.movesBackground') }}</span>
        <span v-else-if="item.type === 'background-animation' && key(item) === 'gradient'" class="kind">{{ $t('shop.slidesGradient') }}</span>
        <span v-if="item.owned && equipped(item)" class="state">{{ $t('shop.inUse') }}</span>
        <button v-else-if="item.owned && item.type !== 'unlock'" :disabled="busy === item.id" @click="use(item)">{{ $t('shop.use') }}</button>
        <span v-else-if="item.owned" class="state">{{ $t('shop.unlocked') }}</span>
        <button v-else class="primary" :disabled="busy === item.id || balance < item.price" :title="balance < item.price ? $t('shop.short', { n: item.price - balance }) : undefined" @click="purchase(item)">
          {{ $t('shop.buyFor', { price: item.price }) }}
        </button>
          </li>
        </ul>
      </section>
    </template>
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
.coins {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 1.15rem;
  padding: 0.25rem 0.8rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
  border: 1px solid var(--amber);
}
.coin {
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ffe08a, #c79a3b 70%);
  box-shadow: inset 0 0 0 2px #9c7425;
}
.bad {
  margin: 0;
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
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
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
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
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
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
.theme {
  display: block;
  width: 5.5rem;
  height: 3.4rem;
  padding: 0.5rem;
  border-radius: 10px;
  border: 2px solid;
}
.theme i {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  height: 100%;
  padding: 0 0.4rem;
  border-radius: 6px;
  border: 1px solid;
}
.theme b {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
}
.theme u {
  flex: 1;
  height: 0.3rem;
  border-radius: 2px;
}
.font-sample {
  font-size: 2.2rem;
  line-height: 1;
}
.unlock {
  font-size: 2rem;
  color: var(--amber);
}
.motion {
  margin: 0;
  padding: 0.4rem 0.8rem;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-sunken) 88%, transparent);
}
.preview :deep(.styled-name.styled) {
  padding: 0.1em 0.8em;
  font-size: 1.05rem;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-bottom: 0.4rem;
}
.group-title {
  font-size: 1.1rem;
  color: var(--amber);
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
}
.kind {
  margin-top: -0.35rem;
  color: var(--muted);
  font-size: 0.8rem;
}
.fx-box {
  position: relative;
  overflow: hidden;
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
