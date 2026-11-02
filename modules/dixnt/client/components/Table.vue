<script setup>
// The cards played this round, large, in the main area.  Each card has a fixed caption under it (the player's name,
// then the vote button or the votes it got), so the table is the same size in every phase.  While people are still
// choosing, a face-down card marks each one who has played and a dashed slot each who has not.  Click a card to look
// closer (the viewer steps through the whole table).
//
// Props:
//   cardWidth   {number}  required.  Card width in pixels.
//   cardHeight  {number}  required.  Card height in pixels.
//   count       {number}  required.  How many cards the table is sized for: everyone in the round.
//   columns     {number}  required.  How many cards fit in a row.
// Emits: none.  Slots: none.
// Side effects: sets store.zoom to open the card viewer; sends `vote` requests (after a confirm dialog when a single
// decision ends the round).
import { computed } from 'vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';
import { CAPTION } from '../layout.js';
import CardImg from './CardImg.vue';

const props = defineProps({
  cardWidth: { type: Number, required: true },
  cardHeight: { type: Number, required: true },
  count: { type: Number, required: true }, // how many cards the table is sized for: everyone in the round
  columns: { type: Number, required: true }, // how many fit in a row
});

const { t, list } = useGameText();
const { nameOf, send, store } = useDixnt();

// The current state.
const state = computed(() => store.state);
// True during the voting phase.
const voting = computed(() => state.value.phase === 'voting');
// The round's results (null until there are some).
const results = computed(() => state.value.results);
// True once the played cards are face up (voting and results).
const revealed = computed(() => voting.value || state.value.phase === 'results');
// How many players have played a card so far.
const played = computed(() => state.value.players.filter((p) => p.hasPlayed).length);
// The slots before the reveal: face-down cards for those who have played, then empty places.
const slots = computed(() => Array.from({ length: props.count }, (_, i) => ({ down: i < played.value })));

// Returns the names of those who voted for a player in the results.
const votersFor = (playerId) =>
  Object.entries(results.value?.votes ?? {})
    .filter(([, target]) => target === playerId)
    .map(([voter]) => nameOf(voter));

/**
 * Builds the tooltip for a card's vote count: the number of votes and who cast them.
 * @param {string} playerId  The player whose card it is.
 * @returns {string} For example '2 votes: Ann and Bo'; '' in the favourite style, which has no vote counts.
 * Side effects: none.
 */
function voteSummary(playerId) {
  if (results.value.judging === 'favourite') return '';
  const count = results.value.tally[playerId];
  const names = votersFor(playerId);
  return names.length ? t('table.votesBy', { count, names: list(names) }, count) : t('table.votes', { count }, count);
}
// Returns the short vote count under a card ('1 vote', '3 votes'; '' in the favourite style).
const voteCount = (playerId) => (results.value.judging === 'favourite' ? '' : t('table.votes', { count: results.value.tally[playerId] }, results.value.tally[playerId]));

/**
 * Casts a vote (or the chooser's decision) for a player.  Votes in the 'everyone' style can be changed, but a chooser's
 * decision ends the round, so that asks first.
 * @param {string} playerId  The player voted for.
 * @returns {void}
 * Side effects: may show a confirm dialog; sends a `vote` request.
 */
function castVote(playerId) {
  if (state.value.judging !== 'everyone') {
    const question = t(state.value.judging === 'favourite' ? 'table.confirmFavourite' : 'table.confirmDecide', { name: nameOf(playerId) });
    if (!window.confirm(question)) return;
  }
  send('vote', { targetId: playerId });
}

// Returns true if the viewer can currently vote for this player's card.
const canVoteFor = (playerId) => voting.value && state.value.voteTargets.includes(playerId);
// Returns the label of the vote button under a card, depending on the style and whether it is your pick.
const voteLabel = (playerId) => t(state.value.me.myVote === playerId ? 'table.yourPick' : state.value.judging === 'favourite' ? 'table.pickThis' : 'table.vote');

/**
 * Builds the buttons the card viewer shows for a card on the table: a vote button if you can vote for its owner.
 * @param {number} cardId  The card showing in the viewer.
 * @returns {Array<{label: string, primary: boolean, run: () => any}>} The actions (empty if you cannot vote for it).
 * Side effects: none (the `run` callback casts the vote unless it is already your pick).
 */
function actionsFor(cardId) {
  const entry = state.value.table.find((e) => e.cardId === cardId);
  if (!entry || !canVoteFor(entry.playerId)) return [];
  const picked = state.value.me.myVote === entry.playerId;
  const label = picked ? t('table.yourPick') : state.value.judging === 'favourite' ? t('table.pickThis') : t('table.voteFor', { name: nameOf(entry.playerId) });
  return [{ label, primary: true, run: () => !picked && castVote(entry.playerId) }];
}

/**
 * Opens the card viewer on a table card, with the whole table to step through.
 * @param {number} cardId  The card clicked.
 * @returns {void}
 * Side effects: sets store.zoom.
 */
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
        <button class="art" :aria-label="t('table.lookCloser', { name: nameOf(entry.playerId) })" @click="zoom(entry.cardId)">
          <CardImg :card-id="entry.cardId" />
          <span v-if="results && results.imposterId === entry.playerId" class="stamp">{{ t('table.imposter') }}</span>
          <span v-else-if="results && results.winnerId === entry.playerId" class="stamp favourite">{{ t('table.favourite') }}</span>
        </button>
        <figcaption>
          <strong class="who">{{ nameOf(entry.playerId) }}<span v-if="entry.playerId === state.me.id" class="muted"> {{ $t('common.youBracketed') }}</span></strong>
          <button v-if="canVoteFor(entry.playerId)" class="vote" :class="{ primary: state.me.myVote === entry.playerId }" @click="castVote(entry.playerId)">
            {{ voteLabel(entry.playerId) }}
          </button>
          <span v-else-if="results" class="muted votes" :title="voteSummary(entry.playerId)">{{ voteCount(entry.playerId) }}</span>
        </figcaption>
      </figure>
    </template>
    <template v-else>
      <figure v-for="(slot, i) in slots" :key="i" class="played">
        <div class="art slot" :class="{ down: slot.down, empty: !slot.down }" :aria-label="t(slot.down ? 'table.faceDown' : 'table.toPlay')">
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
