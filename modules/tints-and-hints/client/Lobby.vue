<script setup>
import { computed } from 'vue';
import BotIcon from '../../../src/components/BotIcon.vue';
import InviteCode from '../../../src/components/InviteCode.vue';
import { cellColour } from '../grid.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const isHost = computed(() => props.state.hostId === props.state.you);
const taken = computed(() => new Set(props.state.players.map((p) => p.colour)));
const mine = computed(() => props.state.players.find((p) => p.id === props.state.you));
const turns = computed(() => props.state.limits.turns);
const total = computed(() => props.state.turnsEach * props.state.players.length);
const canStart = computed(() => props.state.players.length >= props.state.limits.min);
const full = computed(() => props.state.players.length >= props.state.limits.max);
const missing = computed(() => Math.max(0, props.state.limits.min - props.state.players.length));
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <h2>Waiting for players</h2>
      <p class="muted">Share this code, or the invite link, with your friends.</p>
      <div class="row"><InviteCode :code="state.code" /></div>
    </section>

    <section class="panel stack">
      <h3>Players ({{ state.players.length }} of {{ state.limits.max }})</h3>
      <ul class="players">
        <li v-for="p in state.players" :key="p.id" class="row">
          <span class="chip" :style="{ background: p.colour }" />
          <span class="name">{{ p.name }}<span v-if="p.id === state.you" class="muted"> (you)</span></span>
          <span v-if="p.bot" class="muted bot-tag"><BotIcon :size="16" /> computer</span>
          <span v-if="p.id === state.hostId" class="muted">host</span>
          <span v-if="!p.online" class="muted">away</span>
          <button v-if="isHost && p.bot" class="quiet" @click="send('removeBot', { seat: p.id })">Remove</button>
          <button v-else-if="isHost && p.id !== state.you" class="quiet" @click="send('kick', { userId: p.id })">Remove</button>
        </li>
      </ul>
      <div v-if="isHost" class="row bots">
        <button :disabled="full" @click="send('addBot')">Add a computer player</button>
        <button v-if="missing > 0" @click="send('fillBots', { count: state.limits.min })">Fill up to {{ state.limits.min }} players with computer players</button>
        <span v-if="full" class="muted">The table is full ({{ state.limits.max }} players).</span>
      </div>
      <div class="stack">
        <span class="muted">Your marker colour</span>
        <div class="row">
          <button
            v-for="c in state.colours"
            :key="c"
            class="swatch-pick"
            :class="{ chosen: mine?.colour === c }"
            :style="{ background: c }"
            :disabled="taken.has(c) && mine?.colour !== c"
            :aria-label="`Choose marker colour ${c}`"
            @click="send('colour', { colour: c })"
          />
        </div>
      </div>
    </section>

    <section class="panel stack">
      <h3>Length of the game</h3>
      <div class="row">
        <button :disabled="!isHost || state.turnsEach <= turns.min" aria-label="Fewer turns" @click="send('settings', { turnsEach: state.turnsEach - 1 })">-</button>
        <strong>{{ state.turnsEach }} {{ state.turnsEach === 1 ? 'turn' : 'turns' }} each</strong>
        <button :disabled="!isHost || state.turnsEach >= turns.max" aria-label="More turns" @click="send('settings', { turnsEach: state.turnsEach + 1 })">+</button>
      </div>
      <p class="muted">{{ total }} turns in all with {{ state.players.length }} players. Everyone takes turns giving the hints.</p>
      <div class="row">
        <button v-if="isHost" class="primary" :disabled="!canStart" @click="send('start')">Start the game</button>
        <span v-if="isHost && !canStart" class="muted">You need at least {{ state.limits.min }} players.</span>
        <span v-if="!isHost" class="muted">Waiting for the host to start.</span>
      </div>
    </section>
    <div class="row" aria-hidden="true">
      <span v-for="c in ['A9', 'K9', 'U9', 'AE9', 'AO9']" :key="c" class="strip" :style="{ background: cellColour(c) }" />
    </div>
  </div>
</template>

<style scoped>
.bots {
  flex-wrap: wrap;
}
.bot-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.players {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.chip {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}
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
.strip {
  flex: 1;
  height: 0.5rem;
  border-radius: 99px;
}
</style>
