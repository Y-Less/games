<script setup>
// File: the player-details dialog opened from a score chip.  Depends on: ../profiles.js (profileOf), AvatarFigure.vue, BotIcon.vue,
//   StyledName.vue.
// Props: player ({ id, name, bot?, away?, isHost?, userId? }), canRemove (Boolean), error (String), anchor (Object|null, the chip element).
// Emits: remove (after the host confirms).  Slots: default (the game's own panel about this player).
// Side effects: reads layout (offsetParent, bounding rects) to position itself; resets its confirmation step on player or error change.
//
// A person's name in it also links to their statistics and their achievements.  Those links open in a tab of their
// own: the dialog is opened during a game, and a page that replaced the table would take the player out of it.
// The standard dialog opened from a player's chip in the score bar (see usePlayerPopup.js, which owns the opening and
// closing): a floating panel, centred at the top of the game's main area, over the table so that nothing moves.  It
// shows who the player is (name, a computer icon for computer players, whether they are away, a "host" badge) and,
// for the host, a "Remove player" button (or "Remove computer player") with an inline confirmation step.  The default
// slot is the game's own panel: whatever else is worth knowing about that player (their board, cards, tokens ...).
// Give it `player` ({ id, name, bot?, away?, isHost? }), `canRemove` (true for the host looking at someone else) and
// `error` (the reason the last removal was refused, if any).  It emits `remove` once the host has confirmed.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { profileOf } from '../profiles.js';
import { useGameText } from '../useGameText.js';
import AvatarFigure from './AvatarFigure.vue';
import BotIcon from './BotIcon.vue';
import StyledName from './StyledName.vue';

const props = defineProps({
  player: { type: Object, required: true },
  canRemove: { type: Boolean, default: false },
  // Anybody may ask the rest of the table to remove somebody; the host's own Remove above is outright.
  canVote: { type: Boolean, default: false },
  // The vote running about THIS player, or null: { yes, no, needed, answered, mine } (shared/voteKick.js).
  vote: { type: Object, default: null },
  error: { type: String, default: '' },
  // The chip it was opened from: the pop-up hangs under it, left edges aligned (kept inside the area it sits in).
  anchor: { type: Object, default: null },
});
const emit = defineEmits(['remove', 'vote', 'answer', 'drop']);

const root = ref(null);
const left = ref(null); // px from the left of the area the pop-up sits in, or null to centre it
/**
 * Aligns the pop-up's left edge with its chip, kept inside the area it sits in (centres it if there is no anchor).
 * @returns {void}
 * Side effects: sets `left`.
 */
function place() {
  const el = root.value;
  const chip = props.anchor;
  const area = el?.offsetParent;
  if (!el || !chip?.getBoundingClientRect || !area) return (left.value = null);
  const wanted = chip.getBoundingClientRect().left - area.getBoundingClientRect().left;
  left.value = Math.max(0, Math.min(wanted, area.clientWidth - el.offsetWidth));
}
onMounted(place);
watch(() => [props.anchor, props.player.id], () => nextTick(place));
// Inline style: a fixed left offset (and no centring transform) once anchored; none while centred.
const style = computed(() => (left.value === null ? undefined : { left: `${left.value}px`, transform: 'none' }));

const confirming = ref(false);
const asking = ref(false); // the same step before asking the others for a vote
// Another player's popup, or a different state of removal, starts again from the plain button.
watch(() => props.player.id, () => ((confirming.value = false), (asking.value = false)));
watch(() => props.error, (error) => error && ((confirming.value = false), (asking.value = false)));
watch(() => props.vote, () => (asking.value = false));

// A real player's avatar, once the site has told us what it is (computer players have the robot).
const avatar = computed(() => profileOf(props.player.userId ?? null)?.avatar ?? null);

const { t } = useGameText();
// Wording for the removal button and confirmation.
const noun = computed(() => (props.player.bot ? t('common.computerPlayer').toLocaleLowerCase() : t('common.player')));
/**
 * The host has confirmed the removal.
 * @returns {void}
 * Side effects: leaves the confirmation step and emits `remove`.
 */
function confirm() {
  confirming.value = false;
  emit('remove');
}

/**
 * Asks the rest of the table to remove this player.
 * @returns {void}
 * Side effects: leaves the asking step and emits `vote`.
 */
function ask() {
  asking.value = false;
  emit('vote');
}
</script>

<template>
  <div ref="root" class="player-popup popup" :style="style" role="group" :aria-label="t('popup.details', { name: player.name })">
    <header class="head">
      <AvatarFigure v-if="player.bot" class="portrait" robot :seed="`${player.id}:${player.name}`" size="3.2rem" :label="t('common.computerPlayer')" />
      <AvatarFigure v-else-if="avatar" class="portrait" :avatar="avatar" size="3.2rem" />
      <strong class="who">
        <BotIcon v-if="player.bot" />
        <StyledName :name="player.name" :user-id="player.userId ?? null" />
      </strong>
      <span v-if="player.isMe" class="tag">{{ t('common.you') }}</span>
      <span v-if="player.isHost" class="tag host">{{ t('common.host') }}</span>
      <span class="tag state" :class="{ away: player.away }">{{ player.away ? t('common.away') : player.bot ? t('common.computer') : t('common.connected') }}</span>
    </header>
    <nav v-if="player.userId" class="pages">
      <a :href="`/stats/${player.userId}`" target="_blank" rel="noopener">{{ t('popup.theirStats') }}</a>
      <a :href="`/achievements/${player.userId}`" target="_blank" rel="noopener">{{ t('popup.theirAchievements') }}</a>
    </nav>
    <div v-if="$slots.default" class="panel"><slot /></div>
    <footer v-if="vote" class="foot vote" role="group" :aria-label="t('popup.voteTally', { yes: vote.yes, needed: vote.needed, name: player.name })">
      <p class="tally">{{ t('popup.voteTally', { yes: vote.yes, needed: vote.needed, name: player.name }) }}</p>
      <div class="row">
        <button type="button" class="danger" :class="{ chosen: vote.answered === true }" @click="emit('answer', true)">{{ t('popup.voteYes') }}</button>
        <button type="button" class="quiet" :class="{ chosen: vote.answered === false }" @click="emit('answer', false)">{{ t('popup.voteNo') }}</button>
        <button v-if="vote.mine" type="button" class="quiet" @click="emit('drop')">{{ t('popup.voteDrop') }}</button>
      </div>
      <p v-if="vote.answered !== null" class="muted" role="status">{{ t('popup.voteDone') }}</p>
      <p v-if="error" class="error" role="status">{{ error }}</p>
    </footer>
    <footer v-else-if="canRemove || canVote" class="foot">
      <div v-if="confirming" class="confirm" role="alert">
        <span>{{ t('popup.removeConfirm', { name: player.name }) }}</span>
        <button type="button" class="danger" data-confirm @click="confirm">{{ t('popup.yesRemove') }}</button>
        <button type="button" class="quiet" @click="confirming = false">{{ t('common.cancel') }}</button>
      </div>
      <div v-else-if="asking" class="confirm" role="alert">
        <span>{{ t('popup.voteConfirm', { name: player.name }) }}</span>
        <button type="button" class="danger" data-ask @click="ask">{{ t('popup.voteAsk') }}</button>
        <button type="button" class="quiet" @click="asking = false">{{ t('common.cancel') }}</button>
      </div>
      <template v-else>
        <button v-if="canRemove" type="button" class="danger" @click="confirming = true">{{ t('popup.removeButton', { noun }) }}</button>
        <button v-if="canVote" type="button" class="quiet vote-button" @click="asking = true">{{ t('popup.voteButton') }}</button>
      </template>
      <p v-if="error" class="error" role="status">{{ error }}</p>
    </footer>
  </div>
</template>

<style scoped>
.foot.vote .row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.foot.vote .tally {
  margin: 0;
  font-family: var(--display);
}
/* The answer you have given is the one that looks pressed. */
.foot .chosen {
  outline: 2px solid var(--amber);
  outline-offset: 2px;
}
.vote-button {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}
.pages {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem 0.9rem;
  font-size: 0.85rem;
}

.player-popup {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  box-sizing: border-box;
  min-width: 17rem;
  max-width: 96%;
  max-height: 100%;
  overflow: auto;
  padding: 0.6rem 0.9rem;
  border: 1px solid var(--amber);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-sunken) 96%, transparent);
  filter: drop-shadow(0 6px 18px rgb(0 0 0 / 0.55));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.head {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}
.who {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--display);
  font-size: 1.05rem;
}
.tag {
  font-size: 0.72rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.host {
  border-color: var(--amber);
  color: var(--amber);
}
.tag.state.away {
  color: var(--parchment, inherit);
  opacity: 0.85;
}
/* A plain list of facts for games to put in the panel: <dl class="facts"><dt>Score</dt><dd>12</dd> ...</dl> */
.panel :slotted(.facts) {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 1rem;
  margin: 0;
}
.panel :slotted(.facts dt) {
  color: var(--muted);
}
.panel :slotted(.facts dd) {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.foot {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  padding-top: 0.45rem;
  border-top: 1px solid var(--line);
}
.confirm {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.9rem;
}
.danger {
  color: var(--danger, #e07a6c);
  border-color: var(--danger, #e07a6c);
}
.error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--danger, #e07a6c);
}
</style>
