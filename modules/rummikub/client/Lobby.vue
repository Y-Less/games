<script setup>
import { computed } from 'vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import SeatLobby from '../../../src/components/SeatLobby.vue';
import { LIMITS, MIN_DEAL, startProblem } from '../rules.js';
import { TILE_COLOURS } from './colours.js';
import Tile from './Tile.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const isHost = computed(() => props.state.hostSeat === props.state.you);
const seats = computed(() =>
  props.state.seats.map((seat, i) => ({
    id: i,
    name: seat?.name ?? '',
    kind: !seat ? 'empty' : seat.bot ? 'bot' : 'human',
    isHost: i === props.state.hostSeat,
    isMe: i === props.state.you,
    away: Boolean(seat && !seat.bot && !seat.online),
  })),
);
const firstEmpty = () => props.state.seats.findIndex((s) => !s);
const seated = computed(() => props.state.seats.filter(Boolean).length);
const s = computed(() => props.state.settings);
const total = computed(() => props.state.deal.total);
const hand = computed(() => props.state.deal.hand);
const problem = computed(() => startProblem(s.value, props.state.size));
const timerChoices = [0, 30, 60, 90, 120, 180, 300];

const fields = [
  { key: 'numbers', label: 'Numbers per colour', hint: 'Tiles run from 1 up to this number.' },
  { key: 'colours', label: 'Colours', hint: 'Each colour has its own hue and shape.' },
  { key: 'wildcards', label: 'Wildcards', hint: 'Jokers that stand for any tile.' },
  { key: 'rounds', label: 'Rounds', hint: 'Scores add up over the rounds.' },
  { key: 'meld', label: 'First meld (points)', hint: 'Needed from your own tiles before you may use the table.' },
];

function change(key, event) {
  const value = event.target.valueAsNumber;
  if (Number.isFinite(value)) props.send('settings', { [key]: value });
  else event.target.value = s.value[key];
}
const bump = (key, by) => props.send('settings', { [key]: s.value[key] + by });
</script>

<template>
  <div class="stack lobby-wrap">
    <section class="panel stack">
      <p class="muted">Share this code, or the invite link, with your friends. Empty seats can be filled by computer players.</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <SeatLobby
      :seats="seats"
      :is-host="isHost"
      @add-bot="send('addBot', { seat: firstEmpty() })"
      @remove-bot="(id) => send('removeBot', { seat: id })"
      @fill-bots="send('fillBots')"
      @kick="(id) => send('kick', { seat: id })"
      @start="send('start')"
    >
      <template #settings>
        <h3>Rules for this game</h3>
        <fieldset class="group" :disabled="!isHost">
          <legend class="muted">Players (seats)</legend>
          <div class="row">
            <button
              v-for="n in state.limits.sizes"
              :key="n"
              :class="{ primary: state.size === n }"
              :aria-pressed="state.size === n"
              :disabled="seated > n"
              :title="seated > n ? 'Remove some players first' : ''"
              @click="send('size', { seats: n })"
            >
              {{ n }} players
            </button>
          </div>
        </fieldset>

        <div class="fields">
          <div v-for="f in fields" :key="f.key" class="field">
            <label :for="`opt-${f.key}`">{{ f.label }}</label>
            <div class="spin">
              <button class="quiet" :disabled="!isHost || s[f.key] <= LIMITS[f.key][0]" :aria-label="`Fewer ${f.label}`" @click="bump(f.key, -1)">-</button>
              <input :id="`opt-${f.key}`" type="number" :min="LIMITS[f.key][0]" :max="LIMITS[f.key][1]" :value="s[f.key]" :disabled="!isHost" @change="change(f.key, $event)" />
              <button class="quiet" :disabled="!isHost || s[f.key] >= LIMITS[f.key][1]" :aria-label="`More ${f.label}`" @click="bump(f.key, 1)">+</button>
            </div>
            <small class="muted">{{ f.hint }} ({{ LIMITS[f.key][0] }} to {{ LIMITS[f.key][1] }})</small>
          </div>
          <div class="field">
            <label for="opt-timer">Turn timer</label>
            <select id="opt-timer" :value="s.timer" :disabled="!isHost" @change="send('settings', { timer: Number($event.target.value) })">
              <option v-for="t in timerChoices" :key="t" :value="t">{{ t ? `${t} seconds` : 'Off' }}</option>
            </select>
            <small class="muted">When it runs out the player draws a tile.</small>
          </div>
          <div class="field">
            <label for="opt-playOnMeld">Play on after melding</label>
            <input id="opt-playOnMeld" type="checkbox" :checked="s.playOnMeld" :disabled="!isHost" @change="send('settings', { playOnMeld: $event.target.checked })" />
            <small class="muted">Once your first meld is laid you may rearrange the whole table in the same turn, not from your next.</small>
          </div>
        </div>

        <div class="colours" aria-label="The colours in play">
          <Tile v-for="(c, i) in TILE_COLOURS.slice(0, s.colours)" :key="c.name" :settings="s" :id="i * s.numbers + Math.min(s.numbers, 7) - 1" size="sm" :interactive="false" :title="c.name" />
          <span class="muted small">{{ s.colours }} colours, numbers 1 to {{ s.numbers }}</span>
        </div>
        <p class="muted small" role="status">
          {{ total }} tiles ({{ s.colours }} x {{ s.numbers }} x 2<template v-if="s.wildcards"> + {{ s.wildcards }} {{ s.wildcards === 1 ? 'wildcard' : 'wildcards' }}</template>).
          <template v-if="!problem">Each player gets {{ hand }}; {{ total - hand * state.size }} start in the pool.</template>
        </p>
        <p v-if="problem" class="problem" role="alert">{{ problem }} (A hand needs at least {{ MIN_DEAL }} tiles.)</p>
        <p v-if="!isHost" class="muted">Only the host can change these.</p>
      </template>
    </SeatLobby>
  </div>
</template>

<style scoped>
.group {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.group legend {
  padding: 0;
  margin-bottom: 0.4rem;
}
.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.8rem 1.2rem;
}
.field {
  display: grid;
  gap: 0.25rem;
  align-content: start;
}
.field label {
  font-weight: 600;
}
.spin {
  display: flex;
  gap: 0.3rem;
  align-items: center;
}
.spin input {
  width: 4.5rem;
  text-align: center;
}
.spin button {
  width: 2.2rem;
  padding: 0.3rem 0;
}
.colours {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.small {
  font-size: 0.85rem;
  margin: 0.3rem 0 0;
}
.problem {
  margin: 0;
  color: var(--danger);
}
.lobby-wrap {
  max-width: 820px;
  margin: 0 auto;
}
</style>
