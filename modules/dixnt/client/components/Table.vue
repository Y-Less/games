<script setup>
// The cards played this round, large, in the main area. Each card has a fixed caption under it (the player's name,
// then the vote button or the votes it got), so the table is the same size in every phase. While people are still
// choosing, a face-down card marks each one who has played and a dashed slot each who has not. Click a card to look
// closer (the viewer steps through the whole table).
import { computed } from 'vue';
import { useDixnt } from '../useDixnt.js';
import { CAPTION } from '../layout.js';
import CardImg from './CardImg.vue';

const props = defineProps({
  cardWidth: { type: Number, required: true },
  cardHeight: { type: Number, required: true },
  count: { type: Number, required: true }, // how many cards the table is sized for: everyone in the round
  columns: { type: Number, required: true }, // how many fit in a row
});

const { nameOf, send, store } = useDixnt();

const state = computed(() => store.state);
const voting = computed(() => state.value.phase === 'voting');
const results = computed(() => state.value.results);
const revealed = computed(() => voting.value || state.value.phase === 'results');
const played = computed(() => state.value.players.filter((p) => p.hasPlayed).length);
// The slots before the reveal: face-down cards for those who have played, then empty places.
const slots = computed(() => Array.from({ length: props.count }, (_, i) => ({ down: i < played.value })));

const votersFor = (playerId) =>
  Object.entries(results.value?.votes ?? {})
    .filter(([, target]) => target === playerId)
    .map(([voter]) => nameOf(voter));

function voteSummary(playerId) {
  if (results.value.judging === 'favourite') return '';
  const count = results.value.tally[playerId];
  const names = votersFor(playerId);
  return `${count} vote${count === 1 ? '' : 's'}${names.length ? `: ${names.join(', ')}` : ''}`;
}
const voteCount = (playerId) => (results.value.judging === 'favourite' ? '' : `${results.value.tally[playerId]} vote${results.value.tally[playerId] === 1 ? '' : 's'}`);

/** Votes in the 'everyone' style can be changed, but a chooser's decision ends the round, so ask first. */
function castVote(playerId) {
  if (state.value.judging !== 'everyone') {
    const question =
      state.value.judging === 'favourite'
        ? `Pick ${nameOf(playerId)}’s card as your favourite? This ends the round.`
        : `Decide that ${nameOf(playerId)} was in the dark? This ends the round.`;
    if (!window.confirm(question)) return;
  }
  send('vote', { targetId: playerId });
}

const canVoteFor = (playerId) => voting.value && state.value.voteTargets.includes(playerId);
const voteLabel = (playerId) => (state.value.me.myVote === playerId ? 'Your pick' : state.value.judging === 'favourite' ? 'Pick this one' : 'Vote');

function actionsFor(cardId) {
  const entry = state.value.table.find((e) => e.cardId === cardId);
  if (!entry || !canVoteFor(entry.playerId)) return [];
  const picked = state.value.me.myVote === entry.playerId;
  return [{ label: picked ? 'Your pick' : state.value.judging === 'favourite' ? 'Pick this one' : `Vote for ${nameOf(entry.playerId)}`, primary: true, run: () => !picked && castVote(entry.playerId) }];
}

function zoom(cardId) {
  store.zoom = { cardId, cards: state.value.table.map((entry) => entry.cardId), actionsFor };
}
</script>

<template>
  <div class="table" :style="{ '--card-w': `${cardWidth}px`, '--card-h': `${cardHeight}px`, '--caption': `${CAPTION}px`, '--cols': columns }">
    <template v-if="revealed">
      <figure
        v-for="entry in state.table"
        :key="entry.playerId"
        class="played"
        :class="{
          mine: entry.playerId === state.me.id,
          chosen: voting && state.me.myVote === entry.playerId,
          imposter: results && results.imposterId === entry.playerId,
          winner: results && results.winnerId === entry.playerId,
        }"
      >
        <button class="art" :aria-label="`Look closer at ${nameOf(entry.playerId)}'s card`" @click="zoom(entry.cardId)">
          <CardImg :card-id="entry.cardId" />
          <span v-if="results && results.imposterId === entry.playerId" class="stamp">Imposter</span>
          <span v-else-if="results && results.winnerId === entry.playerId" class="stamp favourite">Favourite</span>
        </button>
        <figcaption>
          <strong class="who">{{ nameOf(entry.playerId) }}<span v-if="entry.playerId === state.me.id" class="muted"> (you)</span></strong>
          <button v-if="canVoteFor(entry.playerId)" class="vote" :class="{ primary: state.me.myVote === entry.playerId }" @click="castVote(entry.playerId)">
            {{ voteLabel(entry.playerId) }}
          </button>
          <span v-else-if="results" class="muted votes" :title="voteSummary(entry.playerId)">{{ voteCount(entry.playerId) }}</span>
        </figcaption>
      </figure>
    </template>
    <template v-else>
      <figure v-for="(slot, i) in slots" :key="i" class="played">
        <div class="art slot" :class="{ down: slot.down, empty: !slot.down }" :aria-label="slot.down ? 'A card played face down' : 'A card still to be played'">
          <span v-if="slot.down" class="card-back back" />
        </div>
        <figcaption />
      </figure>
    </template>
  </div>
</template>

<style scoped>
.table {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;
  gap: 12px;
  width: 100%;
  max-width: calc(var(--cols) * (var(--card-w) + 12px));
  height: 100%;
  margin: 0 auto;
}
.played {
  margin: 0;
  width: var(--card-w);
  flex: none;
  display: flex;
  flex-direction: column;
}
.art {
  position: relative;
  display: block;
  width: var(--card-w);
  height: var(--card-h);
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: none;
  box-shadow: 0 0 0 3px transparent;
  transition: box-shadow 0.15s;
}
.art :deep(.card-img) {
  height: 100%;
}
.art:hover:not(:disabled) {
  background: none;
  box-shadow: 0 0 0 3px var(--line);
}
.chosen .art {
  box-shadow: 0 0 0 3px var(--amber);
}
.imposter .art {
  box-shadow: 0 0 0 3px var(--rust);
}
.winner .art {
  box-shadow: 0 0 0 3px var(--moss);
}
.art.slot {
  cursor: default;
}
.art.empty {
  border: 2px dashed var(--line);
  background: color-mix(in srgb, var(--bg-raised) 40%, transparent);
}
.back {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 10px;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.4);
}
.stamp.favourite {
  background: var(--moss);
  color: #10200f;
}
.stamp {
  position: absolute;
  top: 10px;
  right: -6px;
  transform: rotate(6deg);
  background: var(--rust);
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  padding: 0.15rem 0.7rem;
  border-radius: 6px;
  box-shadow: 0 3px 8px rgb(0 0 0 / 0.5);
}
figcaption {
  height: var(--caption);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  padding-top: 0.2rem;
  min-width: 0;
}
.who {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  line-height: 1.2;
}
.vote {
  flex: none;
  padding: 0.1rem 0.7rem;
  font-size: 0.85rem;
}
.votes {
  flex: none;
  font-size: 0.8rem;
  white-space: nowrap;
}
</style>
