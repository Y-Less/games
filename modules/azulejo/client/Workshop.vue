<script setup>
// The factory displays (round plates) and the centre. Click any tile to choose every tile of that colour on that plate
// (or in the centre). Everything here is public.
import { computed, ref } from 'vue';
import { COLOUR_NAMES } from '../rules.js';
import Tile from './Tile.vue';

const props = defineProps({
  factories: { type: Array, required: true },
  centre: { type: Array, required: true },
  markerInCentre: { type: Boolean, default: false },
  selected: { type: Object, default: null }, // { source: number | 'centre', colour }
  active: { type: Boolean, default: false }, // it is your turn: tiles can be chosen
  plate: { type: Number, default: 40 },
  centreHeight: { type: Number, default: 0 }, // a fixed height for the centre box (pixels); 0 lets the CSS decide
});
const emit = defineEmits(['pick']);

const hovered = ref(null); // { source, colour }
const sortedCentre = computed(() => [...props.centre].sort((a, b) => a - b));
const isSel = (source, colour) => props.selected?.source === source && props.selected.colour === colour;
const isHover = (source, colour) => props.active && hovered.value?.source === source && hovered.value.colour === colour;
const count = (tiles, colour) => tiles.filter((c) => c === colour).length;
const empty = (tiles) => tiles.length === 0;
function over(source, colour) {
  hovered.value = source === null ? null : { source, colour };
}
</script>

<template>
  <div class="workshop">
    <div class="plates" role="group" aria-label="Factory displays">
      <div v-for="(tiles, f) in factories" :key="f" class="plate" :class="{ empty: empty(tiles) }" :style="{ '--p': `${plate}px` }">
        <span class="num" aria-hidden="true">{{ f + 1 }}</span>
        <div class="plate-tiles">
          <button
            v-for="(c, i) in tiles"
            :key="i"
            type="button"
            class="pick"
            :class="{ sel: isSel(f, c), same: isHover(f, c), dim: selected && !isSel(f, c) }"
            :disabled="!active"
            :aria-label="`${count(tiles, c)} ${COLOUR_NAMES[c]} from factory ${f + 1}`"
            :aria-pressed="isSel(f, c)"
            :title="`${count(tiles, c)} ${COLOUR_NAMES[c]}`"
            @click="emit('pick', { source: f, colour: c })"
            @mouseenter="over(f, c)"
            @mouseleave="over(null)"
            @focus="over(f, c)"
            @blur="over(null)"
          >
            <Tile :colour="c" :size="plate * 0.46" />
          </button>
        </div>
        <span v-if="empty(tiles)" class="gone muted">empty</span>
      </div>
    </div>

    <div class="centre" role="group" aria-label="The centre" :class="{ empty: !centre.length && !markerInCentre }" :style="centreHeight ? { height: `${centreHeight}px` } : null">
      <h3>The centre</h3>
      <div class="centre-tiles">
        <span v-if="markerInCentre" class="marker" title="The first player to take from the centre takes this marker (it costs a floor slot) and starts the next round.">
          <Tile :colour="-1" :size="plate * 0.55" />
        </span>
        <button
          v-for="(c, i) in sortedCentre"
          :key="i"
          type="button"
          class="pick"
          :class="{ sel: isSel('centre', c), same: isHover('centre', c), dim: selected && !isSel('centre', c) }"
          :disabled="!active"
          :aria-label="`${count(centre, c)} ${COLOUR_NAMES[c]} from the centre`"
          :aria-pressed="isSel('centre', c)"
          :title="`${count(centre, c)} ${COLOUR_NAMES[c]}${markerInCentre ? ' (and the first-player marker)' : ''}`"
          @click="emit('pick', { source: 'centre', colour: c })"
          @mouseenter="over('centre', c)"
          @mouseleave="over(null)"
          @focus="over('centre', c)"
          @blur="over(null)"
        >
          <Tile :colour="c" :size="plate * 0.55" />
        </button>
        <span v-if="!centre.length" class="muted small">{{ markerInCentre ? 'Only the marker.' : 'Nothing here.' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.workshop {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}
.plates {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  gap: 10px;
  justify-content: center;
}
.plate {
  --p: 40px;
  position: relative;
  width: calc(var(--p) * 2.35);
  height: calc(var(--p) * 2.35);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #34505c, #1c313b 75%);
  border: 2px solid #4d7080;
  box-shadow: inset 0 0 0 5px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.4);
  display: grid;
  place-items: center;
}
.plate.empty {
  opacity: 0.45;
  box-shadow: none;
}
.num {
  position: absolute;
  top: 3px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.65rem;
  color: var(--muted);
}
.plate-tiles {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 3px;
}
.gone {
  position: absolute;
  font-size: 0.75rem;
}
.pick {
  padding: 2px;
  border-radius: 8px;
  border: 2px solid transparent;
  background: none;
  line-height: 0;
  transition: none;
}
.pick:hover:not(:disabled) {
  background: none;
  border-color: transparent;
}
.pick:disabled {
  opacity: 1;
  cursor: default;
}
.pick.same {
  border-color: var(--parchment);
  background: rgb(255 255 255 / 0.12);
}
.pick.sel {
  border-color: var(--amber);
  background: rgb(224 168 74 / 0.3);
  box-shadow: 0 0 8px rgb(224 168 74 / 0.6);
}
.pick.dim {
  opacity: 0.55;
}
.centre {
  border: 1px dashed var(--line);
  border-radius: var(--radius);
  padding: 0.4rem 0.7rem 0.5rem;
  flex: none;
  height: 7rem;
  background: rgb(0 0 0 / 0.3);
  /* The box is a fixed size, whatever is in the centre: a big pile scrolls instead of growing the page. */
  contain: size;
  overflow-y: auto;
}
.centre h3 {
  font-size: 0.95rem;
  color: var(--muted);
  margin-bottom: 0.3rem;
}
.centre-tiles {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  align-items: center;
}
.marker {
  line-height: 0;
  margin-right: 0.3rem;
}
.small {
  font-size: 0.85rem;
}
</style>
