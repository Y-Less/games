<script setup>
import { computed } from 'vue';
import { useDixnt } from '../useDixnt.js';
import ChooserWord from './ChooserWord.vue';
import Table from './Table.vue';
import WordBanner from './WordBanner.vue';

const { chooser, players, store } = useDixnt();

const state = computed(() => store.state);

const inRound = computed(() => players.value.filter((p) => !p.waiting));
const waitingOnCards = computed(() => inRound.value.filter((p) => !p.isChooser && !p.hasPlayed));
const waitingNames = computed(() => waitingOnCards.value.map((p) => p.name).join(', '));
const pickingNote = computed(() => {
  const me = state.value.me;
  if (me.waiting) return 'You’ve joined mid-round, so you’ll be dealt in next round.';
  if (me.isChooser) return `Waiting for ${waitingNames.value}…`;
  if (me.myPick !== null) return `Card played. You can swap it until everyone has played.${waitingOnCards.value.length ? ` Waiting for ${waitingNames.value}…` : ''}`;
  return '';
});
const waitingOnVotes = computed(() => inRound.value.filter((p) => !p.hasVoted));
</script>

<template>
  <!-- 1. The chooser types a word -->
  <template v-if="state.phase === 'word'">
    <ChooserWord v-if="state.me.isChooser" />
    <section v-else class="panel waiting">
      <h2>{{ chooser?.name }} is choosing a word…</h2>
      <p class="muted">While you wait, have a look at your hand.</p>
    </section>
  </template>

  <!-- 2. Everyone plays a card -->
  <template v-else-if="state.phase === 'picking'">
    <WordBanner />
    <!-- Always one line of the same height, whatever it says, so playing a card does not move the hand below it. -->
    <p class="muted center note-line" :title="pickingNote">{{ pickingNote }}</p>
  </template>

  <!-- 3. Cards revealed: talk it through and vote whenever you like -->
  <template v-else-if="state.phase === 'voting'">
    <WordBanner />
    <section v-if="state.judging === 'favourite'" class="panel stack">
      <h2>{{ state.me.isChooser ? 'Which card do you like best?' : `${chooser?.name} will pick their favourite` }}</h2>
      <p v-if="state.me.isChooser" class="muted">
        Listen to everyone explain why their card fits the word, then pick the one you like best. That player scores
        {{ state.pointsFavourite }}.
      </p>
      <p v-else class="muted">
        Explain why your card fits the word. If {{ chooser?.name }} picks yours you score {{ state.pointsFavourite }}.
      </p>
      <p class="status">
        <template v-if="state.me.isChooser && state.me.myVote === null">You haven’t picked yet.</template>
        <template v-else-if="state.me.isChooser">You’ve picked.</template>
        <template v-else>Waiting for {{ chooser?.name }} to choose…</template>
      </p>
    </section>
    <section v-else-if="state.judging === 'chooser'" class="panel stack">
      <h2>{{ state.me.isChooser ? 'Who was in the dark?' : `${chooser?.name} will decide who was in the dark` }}</h2>
      <p v-if="state.me.isChooser" class="muted">
        Listen to everyone explain their card, then pick the player you think didn’t see the word. Guess right and you
        score {{ state.pointsChooserCorrect }}. If you’re fooled, the imposter scores {{ state.pointsFooledChooser }}.
      </p>
      <p v-else class="muted">
        Explain why your card fits the word. If {{ chooser?.name }} guesses the imposter they score
        {{ state.pointsChooserCorrect }}; if they’re fooled, the imposter scores {{ state.pointsFooledChooser }}.
      </p>
      <p class="status">
        <template v-if="state.me.isChooser && state.me.myVote === null">You haven’t decided yet.</template>
        <template v-else-if="state.me.isChooser">You’ve decided.</template>
        <template v-else>Waiting for {{ chooser?.name }} to decide…</template>
      </p>
    </section>
    <section v-else class="panel stack">
      <h2>Who was in the dark?</h2>
      <p class="muted">
        Explain why you chose your card and listen to the others. You can vote at any time, and change your vote
        until everyone has voted. The round ends when the last vote is in.
      </p>
      <p class="status long">
        <template v-if="state.me.waiting">You’ll join in next round.</template>
        <template v-else-if="state.me.myVote === null">You haven’t voted yet. Pick the player you think didn’t see the word.</template>
        <template v-else>Your vote is in. You can still change it.</template>
        <span v-if="waitingOnVotes.length" class="muted"> Still to vote: {{ waitingOnVotes.map((p) => p.name).join(', ') }}.</span>
      </p>
    </section>
    <Table />
  </template>
</template>

<style scoped>
.center {
  text-align: center;
}
.waiting {
  text-align: center;
}
.status {
  margin: 0;
  min-height: 1.5em;
}
.status.long {
  min-height: 3em; /* the longest wording and the list of who has still to vote take two lines */
}
.note-line {
  height: 1.5em;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
