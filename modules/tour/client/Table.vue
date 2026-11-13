<script setup>
// Everything a tour shows once it has started.  It is never a game: it is a vote, a note that a game is being played
// somewhere else, or the end of the evening.
// Props: state (the server's view), send (function: (event, payload) -> Promise<{ ok, error }>).  Emits: none.  Slots: none.
// Side effects: the choices send 'vote'; the host's button sends 'again'.  The link to the game is an ordinary route.
import { computed, onBeforeUnmount, ref } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import { END } from '../end.js';

const props = defineProps({ state: { type: Object, required: true }, send: { type: Function, required: true } });
const { t, list } = useGameText();

// A second hand for the vote's countdown: the server sends when the vote closes, and this redraws until it does.
const now = ref(Date.now());
const ticking = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(ticking));

const voting = computed(() => props.state.phase === 'voting');
const playing = computed(() => props.state.phase === 'playing');
const finished = computed(() => props.state.phase === 'finished');
// Seconds left in the vote, or null when no vote is running or it has no clock yet.
const left = computed(() => (voting.value && props.state.until ? Math.max(0, Math.ceil((props.state.until - now.value) / 1000)) : null));
// The names of the people the vote is still waiting for (computer players vote by themselves).
const waitingFor = computed(() => props.state.players.filter((p) => !p.voted && !p.bot).map((p) => p.name));
// The address of the game being played, as an invite link: /play/<game>?<code>.
const gameLink = computed(() => (props.state.current ? `/play/${props.state.current.game}?${props.state.current.code}` : ''));

/** Votes for a choice, or changes your mind.  @param {string} choice  a game id, or END.  @returns {void} */
const pick = (choice) => props.send('vote', { choice });
</script>

<template>
  <div class="tour-table stack">
    <!-- The vote -->
    <section v-if="voting" class="panel stack" :aria-label="t('vote.title')">
      <h2>{{ t('vote.title') }}</h2>
      <p class="muted">{{ t('vote.pick') }}</p>
      <p v-if="state.trouble" class="warn" role="alert">{{ t('vote.trouble') }}</p>

      <ul class="choices">
        <li v-for="choice in state.choices" :key="choice.id">
          <button type="button" class="choice" :class="{ mine: state.yourVote === choice.id }" :aria-pressed="state.yourVote === choice.id" @click="pick(choice.id)">
            <strong class="choice-name">{{ choice.name }}</strong>
            <span class="muted">{{ t('vote.votes', { n: choice.votes }, choice.votes) }}</span>
          </button>
        </li>
        <li>
          <button type="button" class="choice end" :class="{ mine: state.yourVote === END }" :aria-pressed="state.yourVote === END" @click="pick(END)">
            <strong class="choice-name">{{ t('vote.end') }}</strong>
            <span class="muted">{{ t('vote.votes', { n: state.endVotes }, state.endVotes) }}</span>
          </button>
        </li>
      </ul>

      <p v-if="left !== null" class="muted">{{ t('vote.closes', { seconds: left }) }}</p>
      <p v-if="waitingFor.length" class="muted">{{ t('vote.waiting', { names: list(waitingFor) }) }}</p>
    </section>

    <!-- A game is being played elsewhere -->
    <section v-else-if="playing" class="panel stack" :aria-label="t('playing.now', { name: state.current.name })">
      <h2>{{ t('playing.now', { name: state.current.name }) }}</h2>
      <p class="muted">{{ t('playing.note') }}</p>
      <div class="row"><RouterLink class="button primary" :to="gameLink">{{ t('playing.go') }}</RouterLink></div>
    </section>

    <!-- Between the vote closing and the game opening: a moment, but it has to say something -->
    <section v-else-if="state.phase === 'opening'" class="panel stack">
      <p class="muted">{{ t('status.opening') }}</p>
    </section>

    <!-- The end -->
    <section v-else-if="finished" class="panel stack">
      <h2>{{ t('finished.title') }}</h2>
      <p v-if="state.played.length" class="muted">{{ t('finished.played', { count: state.played.length }, state.played.length) }}</p>
      <p v-else class="muted">{{ t('finished.nothing') }}</p>
      <ol v-if="state.played.length" class="played">
        <li v-for="(entry, n) in state.played" :key="n">{{ entry.name }}</li>
      </ol>
      <div v-if="state.isHost" class="row"><button type="button" class="primary" @click="send('again')">{{ t('finished.again') }}</button></div>
    </section>

    <!-- What this tour has played so far, under whatever is going on now -->
    <section v-if="!finished && state.played.length" class="panel stack">
      <h3>{{ t('played.title') }}</h3>
      <ol class="played">
        <li v-for="(entry, n) in state.played" :key="n">{{ entry.name }}</li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
.choices {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.choice {
  width: 100%;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  text-align: left;
}
.choice.mine {
  outline: 2px solid var(--amber, currentColor);
}
.choice-name {
  overflow-wrap: anywhere;
}
.played {
  margin: 0;
  padding-left: 1.25rem;
}
.warn {
  color: var(--warn, inherit);
}
</style>
