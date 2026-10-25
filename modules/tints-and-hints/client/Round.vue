<script setup>
// One turn: the hinter sees the secret tint and describes it, everyone else guesses twice, then the tint is revealed.
import { computed, ref, watch } from 'vue';
import { cellColour } from '../grid.js';
import Board from './Board.vue';
import Players from './Players.vue';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });

const picked = ref(null);
const hintText = ref('');
const hintSaved = ref(false);

const isHinter = computed(() => props.state.hinter === props.state.you);
const phase = computed(() => props.state.phase);
const guessing = computed(() => phase.value === 'guessing1' || phase.value === 'guessing2');
const round = computed(() => (phase.value === 'guessing2' ? 2 : 1));
const hinterName = computed(() => props.state.players.find((p) => p.id === props.state.hinter)?.name ?? 'The hinter');
const guessers = computed(() => props.state.players.filter((p) => p.id !== props.state.hinter));
const guessedCount = computed(() => guessers.value.filter((p) => p.guessed).length);
const allGuessed = computed(() => guessedCount.value === guessers.value.length);
const mine = computed(() => props.state.players.find((p) => p.id === props.state.you));
const hint = computed(() => (round.value === 2 && props.state.hints.second ? props.state.hints.second : props.state.hints.first));
const lastTurn = computed(() => props.state.turn >= props.state.turnsTotal);
const canContinue = computed(() => props.state.you === props.state.hinter || props.state.you === props.state.hostId);
const target = computed(() => props.state.tint);

watch(
  () => `${props.state.turn}-${phase.value}`,
  () => {
    picked.value = null;
    hintText.value = isHinter.value && guessing.value ? (round.value === 2 ? props.state.hints.second : props.state.hints.first) : '';
    hintSaved.value = false;
  },
  { immediate: true },
);

function pick(cell) {
  if (guessing.value && !isHinter.value && !mine.value?.guessed) picked.value = cell;
}
async function lockIn() {
  if (!picked.value) return;
  const reply = await props.send('guess', { cell: picked.value });
  if (reply.ok) picked.value = null;
}
async function saveHint() {
  const reply = await props.send('hint', { text: hintText.value });
  hintSaved.value = reply.ok;
}
function leave() {
  if (window.confirm('Leave this game? You will not be able to come back.')) props.send('leave');
}
</script>

<template>
  <div class="stack">
    <section class="panel stack">
      <div class="row head">
        <h2>Turn {{ state.turn }} of {{ state.turnsTotal }}</h2>
        <span v-if="guessing" class="muted">Round {{ round }} of 2</span>
        <span class="muted code">{{ state.code }}</span>
      </div>

      <template v-if="isHinter && guessing">
        <p>You are the hinter. Describe your tint without naming the square.</p>
        <div class="row">
          <span class="swatch" :style="{ background: cellColour(target) }" role="img" :aria-label="`Your tint is ${target}`">{{ target }}</span>
          <form class="hint row" @submit.prevent="saveHint">
            <input v-model="hintText" maxlength="80" :placeholder="round === 1 ? 'Optional: type your hint' : 'Optional: a second hint'" aria-label="Hint" @input="hintSaved = false" />
            <button type="submit">{{ hintSaved ? 'Sent' : 'Send hint' }}</button>
          </form>
        </div>
        <div class="row">
          <button class="primary" :disabled="!allGuessed" @click="send('advance')">
            {{ round === 1 ? 'Continue to the second round' : 'Reveal the tint' }}
          </button>
          <span class="muted">{{ guessedCount }} of {{ guessers.length }} have guessed</span>
        </div>
      </template>

      <template v-else-if="guessing">
        <p>
          <strong>{{ hinterName }}</strong> is the hinter. {{ round === 1 ? 'Listen to the hint and guess the tint.' : 'Here is a second hint. Where would you guess now?' }}
        </p>
        <p v-if="hint" class="hint-text">&ldquo;{{ hint }}&rdquo;</p>
        <div class="row">
          <span class="swatch unknown" :style="picked ? { background: cellColour(picked) } : null">{{ picked ?? '??' }}</span>
          <template v-if="!mine?.guessed">
            <button class="primary" :disabled="!picked" @click="lockIn">Lock in guess</button>
            <span v-if="!picked" class="muted">Tap a square on the grid.</span>
          </template>
          <span v-else class="muted">Guess locked in. Waiting for the others ({{ guessedCount }} of {{ guessers.length }}).</span>
        </div>
      </template>

      <template v-else>
        <div class="row">
          <span class="swatch" :style="{ background: cellColour(state.tint) }" role="img" :aria-label="`The tint was ${state.tint}`">{{ state.tint }}</span>
          <div class="stack">
            <strong>The tint was {{ state.tint }}.</strong>
            <span class="muted">{{ state.result.hinterName }} scores {{ state.result.hinterPoints }} for the hints. Every guess is on the grid below.</span>
          </div>
        </div>
        <div class="row">
          <button v-if="canContinue" class="primary" @click="send('advance')">{{ lastTurn ? 'Finish the game' : 'Next turn' }}</button>
          <span v-else class="muted">Waiting for {{ hinterName }} to continue.</span>
        </div>
      </template>
    </section>

    <section class="panel stack">
      <Board
        :guesses="state.guesses"
        :players="state.players"
        :target="target"
        :selected="picked"
        :disabled="!guessing || isHinter || mine?.guessed"
        @pick="pick"
      />
      <p class="muted legend">Dotted rings are first guesses, solid rings are second guesses.</p>
    </section>

    <section class="panel stack">
      <h3>Players</h3>
      <Players :players="state.players" :you="state.you" :hinter="state.hinter" :host-id="state.hostId" show-guessed @kick="(id) => send('kick', { userId: id })" />
      <div><button class="quiet" @click="leave">Leave game</button></div>
    </section>
  </div>
</template>

<style scoped>
.head {
  justify-content: space-between;
}
.code {
  font-size: 0.85rem;
}
.swatch {
  display: grid;
  place-items: center;
  width: 5rem;
  height: 5rem;
  flex: none;
  border-radius: 12px;
  border: 2px solid var(--parchment);
  font-weight: 700;
  font-size: 1.2rem;
  color: #fff;
  text-shadow: 0 0 4px #000, 0 0 4px #000;
}
.swatch.unknown {
  background: #fff;
  color: #000;
  text-shadow: none;
}
.hint {
  flex: 1;
  min-width: 12rem;
  flex-wrap: nowrap;
}
.hint-text {
  font-family: var(--display);
  font-size: 1.2rem;
  margin: 0;
  color: var(--amber);
}
.legend {
  margin: 0;
  font-size: 0.85rem;
}
</style>
