<script setup>
// The pop-up that shows another player's window (or yours) over the middle of the table when their name is clicked in the
// score bar. Before the windows are revealed it only says whether they have chosen.
// Props: popupProps (from usePlayerPopup, null when nothing is open), seat (the opened seat if it has a window, else null),
// player (the opened seat, yours too), isMe (Boolean), windows (Boolean, the windows phase), cell (px size of a space).
// Emits: none. Side effects: none (the pop-up closes itself through popupProps).
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import { useGameText } from '../../../src/useGameText.js';
import WindowGrid from './WindowGrid.vue';

const { t } = useGameText();
defineProps({
  popupProps: { type: Object, default: null },
  seat: { type: Object, default: null },
  player: { type: Object, default: null },
  isMe: { type: Boolean, default: false },
  windows: { type: Boolean, default: false },
  cell: { type: Number, required: true },
});
</script>

<template>
  <PlayerPopup v-if="popupProps" v-bind="popupProps">
    <section v-if="seat" class="popup-window">
      <div class="head">
        <span v-if="seat.skipping" class="tag">{{ t('popup.skipping') }}</span>
        <span class="muted wname">{{ t(`patterns.${seat.window.pid}`) }}</span>
      </div>
      <WindowGrid :rows="seat.window.rows" :grid="seat.window.grid" :cell="cell" :label="t('popup.window', { name: seat.name })" />
      <p class="muted small">{{ t('popup.summary', { tokens: seat.tokens, empty: seat.empty, score: seat.score }) }}</p>
    </section>
    <p v-else-if="player?.picked && windows" class="muted small">{{ t(isMe ? 'popup.chosenYou' : 'popup.chosenThem') }}</p>
    <p v-else class="muted small">{{ t(isMe ? 'popup.choosingYou' : 'popup.choosingThem') }}</p>
  </PlayerPopup>
</template>

<style scoped>
.tag {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--muted);
  color: var(--muted);
  white-space: nowrap;
}
.small {
  font-size: 0.85rem;
  margin: 0;
}
.wname {
  overflow: hidden;
  text-overflow: ellipsis;
}
.popup-window {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.head {
  flex: none;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  height: 1.5rem;
  white-space: nowrap;
  overflow: hidden;
}
</style>
