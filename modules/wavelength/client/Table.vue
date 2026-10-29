<script setup>
// The Wavelength table, for every phase of a game: the score bar, the dial (big), the clue and guess controls beside
// it, slim bars for the other players, and the two standard boxes along the bottom. The psychic sees the hidden target
// and gives a clue, everyone else turns the dial to where they think it is, then the target is revealed.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import Dial from './Dial.vue';
import { dialWidth, dialSpan, barSpan } from './layout.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] },
});

const picked = ref(null); // where this person has turned the dial, before locking it in
const clueText = ref('');

const s = computed(() => props.state);
const team = computed(() => s.value.mode === 'team'); // the guessers share one marker, move it together and lock it in
const phase = computed(() => s.value.phase);
const isPsychic = computed(() => s.value.psychic === s.value.you);
const clueTime = computed(() => phase.value === 'clue');
const guessing = computed(() => phase.value === 'guessing');
const playing = computed(() => clueTime.value || guessing.value);
const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
const reveal = computed(() => phase.value === 'reveal');
const psychicName = computed(() => s.value.players.find((p) => p.id === s.value.psychic)?.name ?? 'The psychic');
const guessers = computed(() => s.value.players.filter((p) => p.id !== s.value.psychic));
const guessedCount = computed(() => guessers.value.filter((p) => p.guessed).length);
const mine = computed(() => s.value.players.find((p) => p.id === s.value.you));
const others = computed(() => s.value.players.filter((p) => p.id !== s.value.you));
const lastTurn = computed(() => s.value.turn >= s.value.turnsTotal);
const waitingFor = computed(() => (reveal.value ? s.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
const canGuess = computed(() => guessing.value && !isPsychic.value && (team.value || !mine.value?.guessed));
const standings = computed(() => [...s.value.players].sort((a, b) => b.score - a.score));
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
const myGuess = computed(() => s.value.guesses.find((g) => g.id === s.value.you)?.position ?? null);
const TEAM_MARKER = '#ffd400';
// Solo: your own needle. Team: the shared marker, which the psychic does not see until the reveal.
const needle = computed(() => {
  if (!team.value) return canGuess.value ? picked.value : guessing.value ? myGuess.value : null; // at the reveal your guess is a marker on the rim instead
  return canGuess.value ? picked.value ?? s.value.marker : null;
});
const teamPin = () => (s.value.marker === null ? [] : [{ id: 'team', position: s.value.marker, colour: TEAM_MARKER, name: 'Your team' }]);
const markers = computed(() =>
  team.value ? (reveal.value || ended.value ? teamPin() : []) : reveal.value || ended.value
    ? s.value.guesses.map((g) => ({ id: g.id, position: g.position, colour: colourOf(g.id), name: s.value.players.find((p) => p.id === g.id)?.name ?? 'Someone' }))
    : [],
);
const nameOf = (id) => s.value.players.find((p) => p.id === id)?.name ?? 'Someone';
const colourOf = (id) => s.value.players.find((p) => p.id === id)?.colour ?? '#fff';
const popupMarkers = computed(() => (team.value ? teamPin() : (s.value.result?.entries ?? [])).map((e) => ({ id: e.id, position: e.position, name: e.name, colour: colourOf(e.id) })));

watch(
  () => `${s.value.turn}-${phase.value}`,
  () => {
    picked.value = null;
    clueText.value = '';
  },
  { immediate: true },
);

async function lockIn() {
  if (team.value) {
    flush();
    await props.send('lock');
    return;
  }
  if (picked.value === null) return;
  const reply = await props.send('guess', { position: picked.value });
  if (reply.ok) picked.value = null;
}

// Team: every move of the marker goes to the server (at most about 15 a second) and comes back to the whole team.
// Your own position shows at once while you are turning it, then the server's takes over.
const SEND_EVERY = 60;
let pending = null;
let lastSent = 0;
let sendTimer = null;
let settleTimer = null;
function flush() {
  clearTimeout(sendTimer);
  sendTimer = null;
  if (pending === null) return;
  lastSent = Date.now();
  const position = pending;
  pending = null;
  props.send('marker', { position });
}
function turnTeamMarker(position) {
  picked.value = position;
  pending = position;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => (picked.value = null), 700);
  const wait = SEND_EVERY - (Date.now() - lastSent);
  if (wait <= 0) flush();
  else sendTimer ??= setTimeout(flush, wait);
}
const turn = (position) => (team.value ? turnTeamMarker(position) : (picked.value = position));
onBeforeUnmount(() => {
  clearTimeout(sendTimer);
  clearTimeout(settleTimer);
});
const sendClue = () => props.send('clue', { text: clueText.value });

// ---- the words in the Status box ----
const headline = computed(() => {
  if (phase.value === 'abandoned') return 'The game was abandoned.';
  if (phase.value === 'finished' && team.value) return `Your team scored ${standings.value[0].score} of ${s.value.turnsTotal * 4} points.`;
  if (phase.value === 'finished') return `${winners.value.join(' and ')} ${winners.value.length > 1 ? 'win' : 'wins'} with ${standings.value[0].score} points.`;
  if (reveal.value && team.value) return `Your team scores ${s.value.result?.psychicPoints ?? 0} for this turn.`;
  if (reveal.value) return `${s.value.result?.psychicName ?? psychicName.value} scores ${s.value.result?.psychicPoints ?? 0} for the clue.`;
  if (clueTime.value) {
    return isPsychic.value
      ? 'You are the psychic: the target is shown on your dial. Type a clue that points to it, without numbers or the words on the dial.'
      : `Waiting for ${psychicName.value}'s clue.`;
  }
  if (isPsychic.value && team.value) return 'Your clue is in. Your team is moving the marker together. You cannot see it until the reveal.';
  if (team.value) return 'Move the marker together until you all agree, then anyone can lock it in.';
  if (isPsychic.value) return `Your clue is in. Waiting for everyone to guess (${guessedCount.value} of ${guessers.value.length}).`;
  if (mine.value?.guessed) return `Guess locked in. Waiting for the others (${guessedCount.value} of ${guessers.value.length}).`;
  return 'Your turn: read the clue and turn the dial to where you think the target is.';
});
const mineNow = computed(() => (clueTime.value && isPsychic.value) || (canGuess.value));
const lines = computed(() => {
  if (phase.value === 'abandoned') return [{ text: 'Too many players left, so this game does not count towards the statistics.', tone: 'muted' }, 'Use Leave game (top right) to go back to the menu.'];
  if (phase.value === 'finished') return [{ text: 'Use Leave game (top right) to go back to the menu, or "All rounds" in the score bar to see every turn again.', tone: 'muted' }];
  if (reveal.value) {
    return [
      'Every guess is on the dial.',
      mine.value?.ready
        ? { text: `Waiting for ${waitingFor.value.join(', ')} to be ready${lastTurn.value ? ' for the final scores' : ' for the next turn'}.`, tone: 'muted' }
        : { text: 'Close the scores when you are ready to carry on.', tone: 'mine' },
    ];
  }
  if (guessing.value && team.value) return [{ text: isPsychic.value ? 'Wait for your team to lock in.' : 'Drag on the dial, or use the slider. Everyone sees the marker move.', tone: 'muted' }];
  if (guessing.value && isPsychic.value) return [`${guessedCount.value} of ${guessers.value.length} have guessed.`];
  if (canGuess.value) return [{ text: picked.value === null ? 'Drag on the dial, or use the slider under it.' : 'Lock it in when you are ready.', tone: 'muted' }];
  return [];
});

// ---- fitting the room: the dial is sized from the area the frame gives the table ----
function layout(area) {
  const span = dialSpan(area);
  const unit = (area.width - area.gap * (area.columns - 1)) / area.columns;
  const colWidth = Math.round(unit * span + area.gap * (span - 1));
  return { span, width: dialWidth(colWidth, area.height, span === area.columns) };
}

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button). The scoreboard's ids are the accounts' ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostId,
  isHost: () => s.value.you === s.value.hostId,
  remove: (id, player) => (player?.bot ? props.send('removeBot', { seat: id }) : props.send('kick', { userId: id })),
});
const opened = computed(() => s.value.players.find((p) => p.id === openId.value) ?? null);
const stageOf = (p) => {
  if (ended.value) return '';
  if (p.id === s.value.psychic) return 'the psychic this turn';
  if (guessing.value) return p.guessed ? 'has guessed' : 'still to guess';
  return '';
};
const barStyle = computed(() => ({ gridColumn: `span ${barSpan(others.value.length)}` }));
</script>

<template>
  <GameFrame class="table-view" :main-span="8" :log-span="5">
    <template #scorebar>
      <ScoreBoard :players="state.scoreboard.players" :rounds="state.scoreboard.rounds" :low-is-better="state.scoreboard.lowIsBetter" :finished="state.phase === 'finished'" :awaiting="reveal && !mine?.ready" :waiting="waitingFor" :sticky="false" v-bind="scoreProps" @continue="send('ready')">
        <template #round>
          <section v-if="state.result && state.spectrum" class="reveal stack" aria-label="This turn">
            <Dial :left="state.spectrum.left" :right="state.spectrum.right" :target="state.result.target" :bands="state.bands" :guesses="popupMarkers" :width="320" :reserve-slider="false" />
            <p class="muted clue-line">{{ state.result.psychicName }}'s clue: <strong>&ldquo;{{ state.clue }}&rdquo;</strong> &middot; {{ state.result.psychicName }} scores {{ state.result.psychicPoints }}.</p>
            <p v-if="state.result.team" class="muted clue-line">
              {{ nameOf(state.result.lockedBy) }} locked it in for the team: <strong>+{{ state.result.psychicPoints }} for everyone</strong>.
            </p>
            <ul v-else class="entries">
              <li v-for="e in state.result.entries" :key="e.id" class="row">
                <span class="dot" :style="{ background: colourOf(e.id) }" />
                <span class="name">{{ e.name }}</span>
                <span :class="e.bullseye ? 'exact' : e.points ? 'close' : 'miss'">{{ e.bullseye ? 'Bullseye' : e.points ? 'In the target' : 'Missed' }}</span>
                <strong>+{{ e.points }}</strong>
              </li>
            </ul>
          </section>
        </template>
      </ScoreBoard>
    </template>

    <template #main="area">
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <template v-if="opened.ai">
            <dt>Plays</dt>
            <dd>{{ opened.ai.name }}</dd>
          </template>
          <dt>Score</dt>
          <dd>{{ opened.score }}</dd>
          <dt>Colour</dt>
          <dd><span class="dot" :style="{ background: opened.colour }" /></dd>
          <template v-if="stageOf(opened)">
            <dt>Now</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>
      <div class="arena" :class="{ stacked: layout(area).span === area.columns }">
        <div class="dial-col" :style="{ gridColumn: `span ${layout(area).span}` }">
          <Dial
            v-if="state.spectrum"
            :left="state.spectrum.left"
            :right="state.spectrum.right"
            :target="state.target"
            :bands="state.bands"
            :guesses="markers"
            :selected="needle"
            :colour="team ? TEAM_MARKER : (mine?.colour ?? TEAM_MARKER)"
            :interactive="canGuess"
            :width="layout(area).width"
            @pick="turn"
          />
        </div>

        <aside class="side" :style="{ gridColumn: `span ${area.columns - (layout(area).span === area.columns ? 0 : layout(area).span)}` }" aria-label="Clue and guess">
          <!-- The same blocks in every phase and for every role, so nothing moves: a block with nothing to show is empty. -->
          <div class="block clue-block">
            <span class="muted caption">
              <template v-if="state.clue">{{ psychicName }}'s clue</template>
              <template v-else-if="isPsychic && playing">Only you can see the target.</template>
              <template v-else-if="playing">The clue will appear here.</template>
            </span>
            <p class="clue" :class="{ hidden: !state.clue }">&ldquo;{{ state.clue || '...' }}&rdquo;</p>
          </div>

          <div class="block action">
            <form v-if="isPsychic && clueTime" class="clue-form row" @submit.prevent="sendClue">
              <input v-model="clueText" maxlength="80" placeholder="Type your clue" aria-label="Clue" />
              <button type="submit" class="primary" :disabled="!clueText.trim()">Send clue</button>
            </form>
            <button v-else-if="canGuess" class="primary wide" :disabled="team ? needle === null : picked === null" @click="lockIn">{{ team ? 'Lock in' : 'Lock in guess' }}</button>
          </div>

          <ol v-if="state.phase === 'finished'" class="standings" aria-label="Final scores">
            <li v-for="p in standings" :key="p.id" :class="{ top: p.winner }">
              <span class="place">{{ p.placement }}</span>
              <span class="who">{{ p.name }}</span>
              <span class="points">{{ p.score }}</span>
            </li>
          </ol>
          <p class="legend muted">
            <template v-if="team">One marker for the whole team. </template>The target has three bands: 4, 3 and 2 points.
            <span v-if="mine" class="mark"><span class="dot" :style="{ background: mine.colour }" />your colour</span>
          </p>
        </aside>
      </div>
    </template>

    <template #others>
      <ul v-if="others.length" class="bars" aria-label="Players">
        <li v-for="p in others" :key="p.id" class="bar" :class="{ away: !p.online, psychic: p.id === state.psychic && !ended }" :style="barStyle">
          <span class="dot" :style="{ background: p.colour }" />
          <strong class="who">{{ p.name }}</strong>
          <span v-if="p.id === state.psychic && !ended" class="tag psychic-tag">psychic</span>
          <span v-else-if="guessing && !team && p.guessed" class="tag done">guessed</span>
          <span v-if="!p.online" class="tag away">away</span>
          <span class="score">{{ p.score }}</span>
        </li>
      </ul>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" empty="Nothing has happened yet." v-slot="{ entry }">{{ entry }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :lines="lines">
        <template #facts>
          <strong v-if="!ended">Turn {{ state.turn }} of {{ state.turnsTotal }}</strong>
          <strong v-else>Game over</strong>
          <span v-if="!ended">Psychic: {{ psychicName }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  height: 100%;
  display: grid;
  grid-template-columns: subgrid;
  min-height: 0;
  align-content: start;
  gap: 0.6rem 0;
}
.dial-col {
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}
.side {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.7rem 0.8rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}
.block {
  flex: none;
}
.clue-block {
  height: 6.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  overflow: hidden;
}
.caption {
  font-size: 0.9rem;
  min-height: 1.2rem;
}
.clue {
  font-family: var(--display);
  font-size: 1.35rem;
  line-height: 1.25;
  margin: 0;
  color: var(--amber);
  overflow: hidden;
}
.clue.hidden {
  visibility: hidden;
}
.action {
  height: 2.6rem;
  display: flex;
  align-items: stretch;
}
.action > * {
  flex: 1;
}
.wide {
  width: 100%;
}
.clue-form {
  flex-wrap: nowrap;
  gap: 0.4rem;
}
.clue-form input {
  flex: 1;
  min-width: 0;
}
.standings {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: 0;
  overflow-y: auto;
}
.standings li {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}
.standings li.top .who {
  color: var(--amber);
}
.place {
  width: 1.2rem;
  color: var(--muted);
}
.standings .who {
  flex: 1;
}
.points {
  font-family: var(--display);
  color: var(--amber);
}
.legend {
  margin: auto 0 0;
  font-size: 0.85rem;
}
.mark {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.5rem;
}
.dot {
  display: inline-block;
  vertical-align: middle;
  width: 0.9rem;
  height: 0.9rem;
  border-radius: 50%;
  border: 2px solid var(--line);
  flex: none;
}

/* The slim bars for the other players, on the frame's own columns. */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr)); /* the frame's own 12 columns and gutter */
  gap: 0.4rem var(--gap, 12px);
}
.bar {
  height: 2.3rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-width: 0;
  padding: 0 0.8rem;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
}
.bar.psychic {
  border-color: var(--amber);
}
.bar.away {
  opacity: 0.75;
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--display);
}
.tag {
  flex: none;
  font-size: 0.72rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}
.tag.psychic-tag {
  background: var(--amber);
  border-color: var(--amber);
  color: var(--amber-ink);
}
.tag.done {
  background: var(--moss);
  border-color: var(--moss);
  color: #10200f;
}
.tag.away {
  color: var(--danger);
  border-color: var(--danger);
}
.score {
  margin-left: auto;
  flex: none;
  font-family: var(--display);
  font-size: 1.3rem;
  line-height: 1;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}

.reveal {
  margin-bottom: 0.8rem;
  align-items: center;
}
.clue-line {
  margin: 0;
  text-align: center;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  width: 100%;
}
.name {
  font-weight: 600;
}
.exact {
  color: var(--moss);
}
.close {
  color: var(--amber);
}
.miss {
  color: var(--muted);
}
</style>
