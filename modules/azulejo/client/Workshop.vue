<script setup>
// The factory displays (round plates) and the centre.  Click any tile to choose every tile of that colour on that plate
// (or in the centre).  Everything here is public.
//
// Props:
//   factories      {Array}          required.  One array of tile colours per display plate.
//   centre         {Array}          required.  Tile colours currently in the centre.
//   markerInCentre {boolean}        the first-player marker is still in the centre.
//   selected       {Object|null}    the chosen group { source: number | 'centre', colour }, for highlighting.
//   active         {boolean}        it is the viewer's turn, so tiles are clickable.
//   plate          {number}         base size in pixels for a plate (tiles and plate scale from it; default 40).
//   centreHeight   {number}         fixed pixel height for the centre box, or 0 to let the CSS decide.
// Emits: pick({ source, colour })  a tile was clicked: source is the plate index or 'centre'.
// Slots: none.
// Side effects: keeps local hover state only (to highlight the matching tiles); emits `pick` on click.
import { computed, ref } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
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
const { t } = useGameText();

// The name of a colour, for the tiles' labels.
const colourName = (c) => t(`colour.${c}`);
// Which group the pointer or keyboard focus is on; all matching tiles light up so the group is clear.
const hovered = ref(null); // { source, colour }
// The centre's tiles sorted by colour so equal tiles sit together.
const sortedCentre = computed(() => [...props.centre].sort((a, b) => a - b));
// Returns true if this group (source + colour) is the selected one.
const isSel = (source, colour) => props.selected?.source === source && props.selected.colour === colour;
// Returns true if this group is being pointed at while tiles can be chosen.
const isHover = (source, colour) => props.active && hovered.value?.source === source && hovered.value.colour === colour;
// Returns how many of `tiles` are of `colour`.
const count = (tiles, colour) => tiles.filter((c) => c === colour).length;
// Returns true if there are no tiles.
const empty = (tiles) => tiles.length === 0;
/**
 * Records which group is under the pointer or focus.
 * @param {number|string|null} source  Plate index or 'centre'; null clears the hover.
 * @param {number} [colour]  Tile colour index of the group.
 * @returns {void}
 * Side effects: sets the local `hovered` ref.
 */
function over(source, colour) {
  hovered.value = source === null ? null : { source, colour };
}
</script>

<template>
  <div class="workshop">
    <div class="plates" role="group" :aria-label="t('workshop.plates')">
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
            :aria-label="t('workshop.fromFactory', { count: count(tiles, c), colour: colourName(c), n: f + 1 })"
            :aria-pressed="isSel(f, c)"
            :title="t('tiles', { count: count(tiles, c), colour: colourName(c) })"
            @click="emit('pick', { source: f, colour: c })"
            @mouseenter="over(f, c)"
            @mouseleave="over(null)"
            @focus="over(f, c)"
            @blur="over(null)"
          >
            <Tile :colour="c" :size="plate * 0.46" />
          </button>
        </div>
        <span v-if="empty(tiles)" class="gone muted">{{ t('workshop.empty') }}</span>
      </div>
    </div>

    <div class="centre" role="group" :aria-label="t('workshop.centre')" :class="{ empty: !centre.length && !markerInCentre }" :style="centreHeight ? { height: `${centreHeight}px` } : null">
      <h3>{{ t('workshop.centre') }}</h3>
      <div class="centre-tiles">
        <span v-if="markerInCentre" class="marker" :title="t('workshop.markerTitle')">
          <Tile :colour="-1" :size="plate * 0.55" />
        </span>
        <button
          v-for="(c, i) in sortedCentre"
          :key="i"
          type="button"
          class="pick"
          :class="{ sel: isSel('centre', c), same: isHover('centre', c), dim: selected && !isSel('centre', c) }"
          :disabled="!active"
          :aria-label="t('workshop.fromCentre', { count: count(centre, c), colour: colourName(c) })"
          :aria-pressed="isSel('centre', c)"
          :title="t(markerInCentre ? 'workshop.withMarker' : 'tiles', { count: count(centre, c), colour: colourName(c) })"
          @click="emit('pick', { source: 'centre', colour: c })"
          @mouseenter="over('centre', c)"
          @mouseleave="over(null)"
          @focus="over('centre', c)"
          @blur="over(null)"
        >
          <Tile :colour="c" :size="plate * 0.55" />
        </button>
        <span v-if="!centre.length" class="muted small">{{ markerInCentre ? t('workshop.onlyMarker') : t('workshop.nothingHere') }}</span>
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
