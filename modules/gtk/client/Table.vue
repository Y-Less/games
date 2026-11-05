<script setup>
// The GTK table, for every phase of a game: the score bar, this round's questions, the answers, and the controls for
// the moment, slim bars for the other players, and the two standard boxes along the bottom.  Everybody writes an
// answer to both of the round's questions; then the answers to each question in turn go up together and everybody but
// the subject picks the one they believe is the subject's own.
//
// Props: state (the server's view), send (function: (event, payload) -> Promise<{ ok, error }>), log (Recent moves, an
// array of messages kept by Gtk.vue, see moveLog.js).
// Emits: none.  Slots: none (it fills GameFrame's scorebar, main, others, log, and status slots).
// Side effects: sends 'answers', 'choose', 'ready', 'removeBot', and 'kick' requests; one watcher on the view empties
// the answer boxes when the round changes.
import { computed, ref, watch } from 'vue';
import GameFrame from '../../../src/components/GameFrame.vue';
import GameLog from '../../../src/components/GameLog.vue';
import GameStatus from '../../../src/components/GameStatus.vue';
import PlayerPopup from '../../../src/components/PlayerPopup.vue';
import ScoreBoard from '../../../src/components/ScoreBoard.vue';
import { keyFor } from '../../../src/messageText.js';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';
import { useTurnClock } from '../../../src/useTurnClock.js';
import { useGameText } from '../../../src/useGameText.js';

const props = defineProps({
  state: { type: Object, required: true },
  send: { type: Function, required: true },
  log: { type: Array, default: () => [] }, // Recent moves: messages, kept by the page (see moveLog.js)
});
const { t, text, list, game } = useGameText();

const drafts = ref([]); // what is typed in the answer boxes, one per question

const s = computed(() => props.state); // the view as a computed, so everything below recalculates when it changes
const phase = computed(() => s.value.phase);
const writing = computed(() => phase.value === 'writing');
const picking = computed(() => phase.value === 'picking');
const reveal = computed(() => phase.value === 'reveal');
const ended = computed(() => phase.value === 'finished' || phase.value === 'abandoned');
// This round is about you, so you answer honestly and do not pick.
const isSubject = computed(() => s.value.isSubject);
// Your own player entry.
const mine = computed(() => s.value.players.find((p) => p.id === s.value.you));
// Everyone but you, drawn as the slim bars.
const others = computed(() => s.value.players.filter((p) => p.id !== s.value.you));
// The answers you have already sent this round, or null.
const sent = computed(() => s.value.yourAnswers);
// You still have both answers to write.
const canWrite = computed(() => writing.value && !sent.value);
// Your made-up answer turned out to be the subject's own, so there is nothing for you to pick.
const matched = computed(() => s.value.yoursWasTrue);
// You still have an answer to pick this question.
const canPick = computed(() => picking.value && !isSubject.value && !matched.value && !mine.value?.picked);
// How many players have written both answers, and how many are being waited for.
const writtenCount = computed(() => s.value.players.filter((p) => p.written).length);
// The players who have to pick this question (everybody but the subject, and not those who wrote the true answer).
const pickers = computed(() => s.value.scoreboard.players.filter((p) => p.id !== s.value.subject));
// How many of them have picked.
const pickedCount = computed(() => s.value.players.filter((p) => p.picked).length);
// This is the last question of the last round.
const lastQuestion = computed(() => s.value.round >= s.value.roundsTotal && s.value.question >= s.value.questionsPerRound);
// Names of the players who have not yet closed the question's scores (reveal phase only).
const waitingFor = computed(() => (reveal.value ? s.value.players.filter((p) => !p.ready).map((p) => p.name) : []));
// A copy of the players ordered by score, highest first.
const standings = computed(() => [...s.value.players].sort((a, b) => b.score - a.score));
// The winners' names (empty until the game is over).
const winners = computed(() => standings.value.filter((p) => p.winner).map((p) => p.name));
// The question being asked now, as this player reads it ('' in the lobby or before one is drawn).
const prompt = computed(() => s.value.prompts[s.value.question - 1] ?? '');
// The full key of the reveal's "The true answer was {answer}" line, for <i18n-t>, which wraps the answer in its own element.
const truthWasKey = keyFor('reveal.truthWas', game);
// The seconds left to write or to pick, counted down against the local clock (null when nothing is timed).
const { secondsLeft } = useTurnClock(() => props.state);
// The clock is nearly up and you still have something to do: worth saying out loud, because the server will act for you.
const HURRY_AT = 10;
const hurrying = computed(() => secondsLeft.value !== null && secondsLeft.value <= HURRY_AT && (canWrite.value || canPick.value));

// Typed answers belong to one round: they are emptied when it changes (and once at the start).
watch(
  () => `${s.value.round}`,
  () => {
    drafts.value = s.value.prompts.map(() => '');
  },
  { immediate: true },
);

// Every box has something in it, so the answers can be sent.
const ready = computed(() => s.value.prompts.length > 0 && s.value.prompts.every((_, n) => (drafts.value[n] ?? '').trim()));
// Sends both answers; returns the request's promise (the server rejects empty or over-long ones).
const sendAnswers = () => props.send('answers', { texts: s.value.prompts.map((_, n) => (drafts.value[n] ?? '').trim()) });

// ---- the words in the Status box ----
// The Status headline for the phase and your part in it, as one sentence ('' when there is nothing to say).
const headline = computed(() => {
  if (phase.value === 'abandoned') return t('status.abandoned');
  if (phase.value === 'finished') return t('status.wins', { names: list(winners.value), score: standings.value[0]?.score ?? 0, count: winners.value.length }, winners.value.length);
  if (reveal.value) {
    const truth = s.value.options.find((o) => o.truth);
    return truth ? t('status.revealTruth', { name: s.value.subjectName, answer: truth.text }) : '';
  }
  if (writing.value) {
    const count = s.value.questionsPerRound;
    if (canWrite.value) return isSubject.value ? t('status.writeSubject', { count }, count) : t('status.writeOther', { name: s.value.subjectName, count }, count);
    return t('status.writeSent', { written: writtenCount.value, total: s.value.players.length });
  }
  if (picking.value) {
    if (isSubject.value) return t('status.pickSubject');
    if (matched.value) return t('status.pickMatched');
    return canPick.value ? t('status.pickYours', { name: s.value.subjectName }) : t('status.pickWaiting', { picked: pickedCount.value, total: pickers.value.length });
  }
  return '';
});
// It is your move (highlights the Status box).
const mineNow = computed(() => canWrite.value || canPick.value);
// The further Status lines.  Most are { text, tone } where tone only picks the colour.
const lines = computed(() => {
  if (phase.value === 'abandoned') return [{ text: t('status.abandonedNote'), tone: 'muted' }, t('status.leaveToMenu')];
  if (phase.value === 'finished') return [{ text: t('status.finishedNote'), tone: 'muted' }];
  if (reveal.value) {
    return [
      mine.value?.ready
        ? { text: t(lastQuestion.value ? 'status.waitingReadyFinal' : 'status.waitingReadyNext', { names: list(waitingFor.value) }), tone: 'muted' }
        : { text: t('status.closeScores'), tone: 'mine' },
    ];
  }
  const scoring = { text: t('status.scoring', { correct: s.value.points.correct, fooled: s.value.points.fooled }), tone: 'muted' };
  const hurry = hurrying.value ? [{ text: t(canWrite.value ? 'status.hurry' : 'status.hurryPick'), tone: 'warn' }] : [];
  if (canPick.value) return [...hurry, scoring, { text: t('status.cannotPickOwn'), tone: 'muted' }];
  if (canWrite.value) return [...hurry, scoring];
  return [];
});

// Another player's details open from their chip in the score bar (the standard player pop-up, with the host's Remove
// button).  The scoreboard's ids are the accounts' ids.
const { openId, scoreProps, popupProps } = usePlayerPopup({
  players: () => s.value.scoreboard.players,
  hostId: () => s.value.hostId,
  isHost: () => s.value.you === s.value.hostId,
  remove: (id, player) => (player?.bot ? props.send('removeBot', { seat: id }) : props.send('kick', { userId: id })),
});
// The player whose chip was clicked in the score bar, or null when no pop-up is open.
const opened = computed(() => s.value.players.find((p) => p.id === openId.value) ?? null);
/**
 * What a player is doing now, for their pop-up.
 * @param {object} p  a player from the view
 * @returns {string} the phrase, or '' when there is nothing to say
 * Side effects: none.
 */
const stageOf = (p) => {
  if (ended.value) return '';
  if (p.id === s.value.subject) return t('popup.subject');
  if (writing.value) return p.written ? t('popup.written') : t('popup.toWrite');
  if (picking.value) return p.picked ? t('popup.picked') : t('popup.toPick');
  return '';
};
/**
 * The line under an answer card at the reveal: who wrote it, or that it was the subject's own.
 * @param {object} option  an option from the view
 * @returns {string}
 * Side effects: none.
 */
const wroteLine = (option) => (option.truth ? t('table.subjectAnswer', { name: s.value.subjectName }) : t('table.wroteBy', { names: list(option.authors.map((a) => a.name)) }));
/**
 * The line saying who picked an answer at the reveal.
 * @param {object} option  an option from the view
 * @returns {string}
 * Side effects: none.
 */
const choseLine = (option) => (option.pickedBy.length ? t('table.chose', { names: list(option.pickedBy.map((a) => a.name)) }) : t('table.nobodyChose'));
// How many frame columns each slim bar spans: wider bars when four or fewer players are shown (a number, 3 or 2).
const barStyle = computed(() => ({ gridColumn: `span ${others.value.length <= 4 ? 3 : 2}` }));
</script>

<template>
  <GameFrame class="table-view" :main-span="12" :log-span="5">
    <template #scorebar>
      <ScoreBoard
        :players="state.scoreboard.players"
        :rounds="state.scoreboard.rounds"
        :low-is-better="state.scoreboard.lowIsBetter"
        :finished="state.phase === 'finished'"
        :awaiting="reveal && !mine?.ready"
        :waiting="waitingFor"
        :sticky="false"
        v-bind="scoreProps"
        @continue="send('ready')"
      >
        <template #round>
          <section v-if="reveal || ended" class="reveal stack" :aria-label="t('reveal.label')">
            <p class="reveal-question">{{ prompt }}</p>
            <i18n-t v-if="state.truth" :keypath="truthWasKey" scope="global" tag="p" class="reveal-truth">
              <template #answer><strong>{{ state.truth }}</strong></template>
            </i18n-t>
            <ul class="entries">
              <li v-for="o in state.options" :key="o.n" class="entry" :class="{ true: o.truth }">
                <span class="answer-text">{{ o.text }}</span>
                <span class="muted">{{ wroteLine(o) }}</span>
                <span class="muted">{{ choseLine(o) }}</span>
              </li>
            </ul>
          </section>
        </template>
      </ScoreBoard>
    </template>

    <template #main>
      <PlayerPopup v-if="popupProps" v-bind="popupProps">
        <dl v-if="opened" class="facts">
          <template v-if="opened.ai">
            <dt>{{ t('popup.plays') }}</dt>
            <dd>{{ opened.ai.name }}</dd>
          </template>
          <dt>{{ t('popup.score') }}</dt>
          <dd>{{ opened.score }}</dd>
          <template v-if="stageOf(opened)">
            <dt>{{ t('popup.now') }}</dt>
            <dd>{{ stageOf(opened) }}</dd>
          </template>
        </dl>
      </PlayerPopup>

      <div class="arena">
        <section v-if="!writing" class="question-card" :aria-label="t('table.theQuestions')">
          <span class="caption muted">{{ t('table.questionNumber', { n: state.question, total: state.questionsPerRound }) }}</span>
          <strong class="question-now">{{ prompt }}</strong>
        </section>

        <section class="answers-box" :class="{ writing }" :aria-label="t('table.theAnswers')">
          <!-- Writing every answer: each question sits straight above its own box -->
          <form v-if="canWrite" class="write-form" @submit.prevent="sendAnswers">
            <label v-for="(line, n) in state.prompts" :key="n" class="field">
              <span class="question">{{ line }}</span>
              <input v-model="drafts[n]" :maxlength="state.limits.answer" :placeholder="t('table.answerPlaceholder')" autocomplete="off" />
            </label>
            <button type="submit" class="primary wide" :disabled="!ready">{{ t('table.sendAnswers', { count: state.questionsPerRound }, state.questionsPerRound) }}</button>
          </form>
          <ul v-else-if="writing && sent" class="mine-list" :aria-label="t('table.yourAnswers')">
            <li v-for="(answer, n) in sent" :key="n">
              <span class="muted">{{ t('table.questionNumber', { n: n + 1, total: state.questionsPerRound }) }}</span>
              <strong>{{ answer }}</strong>
            </li>
          </ul>
          <ul v-if="writing" class="who" :aria-label="t('table.whoWritten')">
            <li v-for="p in state.players" :key="p.id" :class="{ done: p.written }">{{ p.name }}<span v-if="p.written"> &#10003;</span></li>
          </ul>

          <!-- Picking the true answer -->
          <ul v-if="picking" class="cards" :aria-label="t('table.pickOne')">
            <li v-for="o in state.options" :key="o.n">
              <button v-if="canPick && o.canPick" type="button" class="card pick" @click="send('choose', { n: o.n })">{{ o.text }}</button>
              <span v-else class="card" :class="{ yours: o.yours }">
                <span class="answer-text">{{ o.text }}</span>
                <small v-if="o.yours" class="tag">{{ t('table.yourAnswerTag') }}</small>
              </span>
            </li>
          </ul>
          <ul v-if="picking" class="who" :aria-label="t('table.whoPicked')">
            <li v-for="p in pickers" :key="p.id" :class="{ done: state.players.find((q) => q.id === p.id)?.picked }">
              {{ p.name }}<span v-if="state.players.find((q) => q.id === p.id)?.picked"> &#10003;</span>
            </li>
          </ul>

          <!-- Everything open, once the question is scored -->
          <ul v-if="reveal || ended" class="cards" :aria-label="t('table.theAnswers')">
            <li v-for="o in state.options" :key="o.n">
              <span class="card" :class="{ true: o.truth, yours: o.yours }">
                <span class="answer-text">{{ o.text }}</span>
                <small class="writer">{{ wroteLine(o) }}</small>
                <small v-if="o.truth" class="tag true-tag">{{ t('table.trueTag') }}</small>
                <small v-else class="writer">{{ choseLine(o) }}</small>
              </span>
            </li>
          </ul>
        </section>

        <div class="action">
          <p v-if="picking && isSubject" class="muted">{{ t('table.waitingForPicks') }}</p>
        </div>
      </div>
    </template>

    <template #others>
      <ul v-if="others.length" class="bars" :aria-label="t('table.players')">
        <li v-for="p in others" :key="p.id" class="bar" :class="{ away: !p.online, subject: p.subject && !ended }" :style="barStyle">
          <strong class="who-name">{{ p.name }}</strong>
          <span v-if="p.subject && !ended" class="tag subject-tag">{{ t('table.subjectTag') }}</span>
          <span v-else-if="writing && p.written" class="tag done">{{ t('table.writtenTag') }}</span>
          <span v-else-if="picking && p.picked" class="tag done">{{ t('table.pickedTag') }}</span>
          <span v-if="!p.online" class="tag away">{{ t('common.away') }}</span>
          <span class="score">{{ p.score }}</span>
        </li>
      </ul>
    </template>

    <template #log>
      <GameLog :entries="log" newest-first :fresh="4" :empty="t('table.nothingYet')" v-slot="{ entry }">{{ text(entry) }}</GameLog>
    </template>

    <template #status>
      <GameStatus :headline="headline" :mine="mineNow" :turn="Boolean(isSubject && canWrite)" :lines="lines">
        <template #facts>
          <strong v-if="!ended">{{ t('facts.round', { n: state.round, total: state.roundsTotal }) }}</strong>
          <strong v-else>{{ t('facts.gameOver') }}</strong>
          <span v-if="!ended && !writing">{{ t('facts.question', { n: state.question, total: state.questionsPerRound }) }}</span>
          <span v-if="!ended">{{ t('facts.subject', { name: state.subjectName }) }}</span>
          <span v-if="secondsLeft !== null" class="clock" :class="{ low: secondsLeft <= 10 }">{{ t('facts.time', { count: secondsLeft }, secondsLeft) }}</span>
        </template>
      </GameStatus>
    </template>
  </GameFrame>
</template>

<style scoped>
.arena {
  grid-column: 1 / -1;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.question-card {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  min-height: 5.4rem;
  padding: 0.6rem 1rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  text-align: center;
}
.caption {
  font-size: 0.85rem;
}
.question {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.question strong,
.question-now {
  font-family: var(--display);
  font-size: 1.4rem;
  line-height: 1.2;
  color: var(--amber);
  overflow-wrap: anywhere;
}
.question-now {
  font-size: 1.9rem;
}
.answers-box {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.8rem;
  background: color-mix(in srgb, var(--bg-raised) 85%, transparent);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
/* Writing: the questions and their boxes are given room to breathe, because this is the one screen a player reads
   carefully.  The whole form is centred and spaced evenly down the box however many questions a round has. */
.answers-box.writing {
  justify-content: center;
  padding: 1rem clamp(0.8rem, 4vw, 2.5rem);
}
.write-form {
  display: flex;
  flex-direction: column;
  gap: clamp(1rem, 3.5vh, 2.2rem);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.field .question {
  font-family: var(--display);
  font-size: clamp(1.1rem, 2.4vh, 1.5rem);
  line-height: 1.25;
  color: var(--amber);
  text-align: center;
  overflow-wrap: anywhere;
}
.field input {
  width: 100%;
  min-width: 0;
  padding: 0.7rem 0.9rem;
  font-size: 1.05rem;
}
.write-form .wide {
  width: 100%;
  margin-top: 0.4rem;
  padding: 0.7rem 1rem;
}
.mine-list,
.who,
.cards {
  list-style: none;
  margin: 0;
  padding: 0;
}
.mine-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.mine-list li {
  display: flex;
  flex-direction: column;
}
.who {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.who li {
  padding: 0.1rem 0.7rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
}
.who li.done {
  border-color: var(--moss);
  color: var(--moss);
}
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}
.card {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1rem;
  padding: 0.55rem 1rem;
  min-width: 7rem;
  max-width: 100%;
  border: 2px solid var(--parchment);
  border-radius: 12px;
  background: #f4efe3;
  color: #2a1c05;
  font-family: var(--display);
  font-size: 1.2rem;
  line-height: 1.25;
  text-align: center;
  overflow-wrap: anywhere;
}
button.card.pick {
  cursor: pointer;
}
button.card.pick:hover,
button.card.pick:focus-visible {
  border-color: var(--amber);
  box-shadow: 0 0 0 3px var(--amber);
}
.card.yours {
  opacity: 0.6;
}
.card.true {
  border-color: var(--amber);
  box-shadow: 0 0 0 3px var(--amber);
}
.writer {
  font-family: var(--body);
  font-size: 0.75rem;
  color: #5a4a30;
}
.action {
  flex: none;
  min-height: 2.2rem;
  display: flex;
  align-items: center;
}
.action > * {
  margin: 0;
}

/* The slim bars for the other players, on the frame's own columns. */
.bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
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
.bar.subject {
  border-color: var(--amber);
}
.bar.away {
  opacity: 0.75;
}
.who-name {
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
.tag.subject-tag,
.tag.true-tag {
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
}
.reveal-question {
  margin: 0;
  font-size: 1.05rem;
}
.reveal-truth {
  margin: 0;
  font-size: 1.1rem;
}
.reveal-truth strong {
  font-family: var(--display);
  color: var(--amber);
  font-size: 1.4rem;
}
.entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.entry {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: baseline;
}
.answer-text {
  font-weight: 700;
}
.clock {
  font-variant-numeric: tabular-nums;
}
.clock.low {
  color: var(--danger);
  font-weight: 700;
}
</style>
