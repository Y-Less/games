<script setup>
// The marker-colour picker of a lobby, for the games that give each player a colour (Tints and Hints, Wavelength,
// Trivium): the free palette, with the colours other players have taken greyed out, the player's own colour when it
// is one from outside the palette, and a free choice of any colour for a player who has unlocked that in the shop.
// The rules it asks are shared/markerRules.js (`chooseMarker`); a game sends what this emits as its `colour` event.
// Depends on: src/useGameText.js (its words are the site's, `marker.*`).
// Props: colours (the free palette, from the view), players (everybody in the room, each with `id` and `colour`),
//   you (this viewer's id), canCustom (this viewer may pick any colour).
// Emits: pick (the colour chosen, as '#rrggbb').  Slots: none.
// Side effects: none.
import { computed } from 'vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  colours: { type: Array, default: () => [] },
  players: { type: Array, default: () => [] },
  you: { type: [Number, String], default: null },
  canCustom: { type: Boolean, default: false },
});
defineEmits(['pick']);
const { t } = useGameText();

// This viewer's own colour (null for somebody watching who is not in the room).
const mine = computed(() => props.players.find((p) => p.id === props.you)?.colour ?? null);
// The colours somebody else has, which cannot be picked.
const taken = computed(() => new Set(props.players.filter((p) => p.id !== props.you).map((p) => p.colour)));
</script>

<template>
  <div class="stack">
    <span class="muted">{{ t('marker.yourColour') }}</span>
    <div class="row">
      <button
        v-for="c in colours"
        :key="c"
        type="button"
        class="swatch-pick"
        :class="{ chosen: mine === c }"
        :style="{ background: c }"
        :disabled="taken.has(c)"
        :aria-label="t('marker.choose', { colour: c })"
        :aria-pressed="mine === c"
        @click="$emit('pick', c)"
      />
      <span v-if="mine && !colours.includes(mine)" class="swatch-pick chosen" :style="{ background: mine }" :title="t('marker.own')" />
      <label v-if="canCustom" class="custom muted">
        {{ t('marker.any') }}
        <input type="color" class="picker" :value="mine" :aria-label="t('marker.chooseAny')" @change="$emit('pick', $event.target.value)" />
      </label>
    </div>
    <span v-if="!canCustom" class="muted">{{ t('marker.unlock') }}</span>
  </div>
</template>

<style scoped>
.swatch-pick {
  width: 2.4rem;
  height: 2.4rem;
  padding: 0;
  border-radius: 50%;
  border: 2px solid var(--line);
}
.swatch-pick.chosen {
  outline: 3px solid var(--amber);
  outline-offset: 2px;
}
.custom {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.picker {
  width: 2.8rem;
  height: 2.4rem;
  padding: 0.1rem;
}
</style>
