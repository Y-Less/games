<script setup>
// The standard dialog opened from a player's chip in the score bar (see usePlayerPopup.js, which owns the opening and
// closing): a floating panel, centred at the top of the game's main area, over the table so that nothing moves. It
// shows who the player is (name, a computer icon for computer players, whether they are away, a "host" badge) and,
// for the host, a "Remove player" button (or "Remove computer player") with an inline confirmation step. The default
// slot is the game's own panel: whatever else is worth knowing about that player (their board, cards, tokens ...).
// Give it `player` ({ id, name, bot?, away?, isHost? }), `canRemove` (true for the host looking at someone else) and
// `error` (the reason the last removal was refused, if any). It emits `remove` once the host has confirmed.
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { profileOf } from '../profiles.js';
import AvatarFigure from './AvatarFigure.vue';
import BotIcon from './BotIcon.vue';
import StyledName from './StyledName.vue';

const props = defineProps({
  player: { type: Object, required: true },
  canRemove: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // The chip it was opened from: the pop-up hangs under it, left edges aligned (kept inside the area it sits in).
  anchor: { type: Object, default: null },
});
const emit = defineEmits(['remove']);

const root = ref(null);
const left = ref(null); // px from the left of the area the pop-up sits in, or null to centre it
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
const style = computed(() => (left.value === null ? undefined : { left: `${left.value}px`, transform: 'none' }));

const confirming = ref(false);
// Another player's popup, or a different state of removal, starts again from the plain button.
watch(() => props.player.id, () => (confirming.value = false));
watch(() => props.error, (error) => error && (confirming.value = false));

// A real player's avatar, once the site has told us what it is (nothing for computer players).
const avatar = computed(() => profileOf(props.player.userId ?? null)?.avatar ?? null);

const noun = computed(() => (props.player.bot ? 'computer player' : 'player'));
function confirm() {
  confirming.value = false;
  emit('remove');
}
</script>

<template>
  <div ref="root" class="player-popup popup" :style="style" role="group" :aria-label="`${player.name}'s details`">
    <header class="head">
      <AvatarFigure v-if="avatar" class="portrait" :avatar="avatar" size="3.2rem" />
      <strong class="who">
        <BotIcon v-if="player.bot" />
        <StyledName :name="player.name" :user-id="player.userId ?? null" />
      </strong>
      <span v-if="player.isMe" class="tag">you</span>
      <span v-if="player.isHost" class="tag host">host</span>
      <span class="tag state" :class="{ away: player.away }">{{ player.away ? 'away' : player.bot ? 'computer' : 'connected' }}</span>
    </header>
    <div v-if="$slots.default" class="panel"><slot /></div>
    <footer v-if="canRemove" class="foot">
      <template v-if="!confirming">
        <button type="button" class="danger" @click="confirming = true">Remove {{ noun }}</button>
      </template>
      <div v-else class="confirm" role="alert">
        <span>Remove {{ player.name }} from the game?</span>
        <button type="button" class="danger" data-confirm @click="confirm">Yes, remove</button>
        <button type="button" class="quiet" @click="confirming = false">Cancel</button>
      </div>
      <p v-if="error" class="error" role="status">{{ error }}</p>
    </footer>
  </div>
</template>

<style scoped>
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
