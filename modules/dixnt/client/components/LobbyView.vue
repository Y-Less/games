<script setup>
// Dixnt lobby: the invite code, the players (the host can remove people and add computer players), and the host's
// settings: play style, card categories, hand size, and number of rounds.  Everyone else sees them read-only.
// Every word comes from a locale file (the game's own first, then the site's); a category's label may be a message
// the server sent, so it is drawn with text().
//
// Props: none.  Emits: none.  Slots: none.
// Side effects: sends addBot, fillBots, removeBot, removePlayer, setJudging, setCategories, setHandSize, setRounds and
// start requests (through the store).
import { computed } from 'vue';
import InviteCode from '../../../../src/components/InviteCode.vue';
import { useGameText } from '../../../../src/useGameText.js';
import { useDixnt } from '../useDixnt.js';

const { t, text } = useGameText();
const { isHost, players, send, store } = useDixnt();
// The current state.
const state = computed(() => store.state);
// True when no more players can join.
const full = computed(() => players.value.length >= state.value.maxPlayers);
// How many more players are needed before the game can start (0 when enough).
const missingPlayers = computed(() => Math.max(0, state.value.minPlayers - players.value.length));
// Cards needed to deal everyone a full hand.
const cardsNeeded = computed(() => players.value.length * state.value.handSize);
// True when the chosen categories hold enough cards for that deal.
const enoughCards = computed(() => state.value.availableCards >= cardsNeeded.value);
// The categories currently in the deck.
const selected = computed(() => state.value.categories.filter((c) => c.selected));
// The names of the chosen categories, as the language joins a list.
const selectedNames = computed(() => selected.value.map((c) => text(c.label)).join(', '));

// The three play styles with their titles and rule text (which quotes the current point values).
const judgingOptions = computed(() => [
  { mode: 'everyone', title: t('judging.everyone.title'), text: t('judging.everyone.text', { perVote: state.value.pointsPerVote }) },
  { mode: 'chooser', title: t('judging.chooser.title'), text: t('judging.chooser.text', { correct: state.value.pointsChooserCorrect, fooled: state.value.pointsFooledChooser }) },
  { mode: 'favourite', title: t('judging.favourite.title'), text: t('judging.favourite.text', { points: state.value.pointsFavourite }) },
]);
// The option for the style in use (shown to non-hosts).
const currentJudging = computed(() => judgingOptions.value.find((o) => o.mode === state.value.judging));

/**
 * Adds a category to the deck, or removes it if it is already in, by sending the whole new selection.
 * @param {string} key  The category's key.
 * @returns {void}
 * Side effects: sends a `setCategories` request.
 */
function toggleCategory(key) {
  const keys = state.value.categories.filter((c) => (c.key === key ? !c.selected : c.selected)).map((c) => c.key);
  send('setCategories', { keys });
}
</script>

<template>
  <section class="panel stack">
    <h2>{{ $t('lobby.title') }}</h2>
    <p class="muted">{{ t('lobby.share', { min: state.minPlayers }) }}</p>
    <div class="row"><InviteCode :code="state.code" /></div>
  </section>

  <section class="panel stack">
    <h2>{{ t('lobby.players') }}</h2>
    <ul class="seats" :aria-label="t('lobby.playersLabel')">
      <li v-for="p in players" :key="p.id" class="seat" :class="{ bot: p.bot, me: p.id === state.me.id, away: !p.connected }">
        <span class="who">
          {{ p.name }}
          <span v-if="p.id === state.me.id" class="tag">{{ $t('common.you') }}</span>
          <span v-if="p.id === state.hostId" class="tag">{{ $t('common.host') }}</span>
          <span v-if="p.bot" class="tag bot">{{ $t('common.computer') }}</span>
          <span v-if="!p.bot && !p.connected" class="tag away">{{ $t('common.away') }}</span>
        </span>
        <button v-if="isHost && p.bot" class="quiet" @click="send('removeBot', { targetId: p.id })">{{ $t('common.remove') }}</button>
        <button v-else-if="isHost && p.id !== state.me.id" class="quiet" @click="send('removePlayer', { targetId: p.id })">{{ $t('common.remove') }}</button>
      </li>
    </ul>
    <div v-if="isHost" class="row">
      <button :disabled="full" @click="send('addBot')">{{ $t('lobby.addBot') }}</button>
      <button v-if="missingPlayers > 0" @click="send('fillBots', { count: state.minPlayers })">
        {{ t('lobby.fillUpTo', { count: state.minPlayers }, state.minPlayers) }}
      </button>
      <span v-if="full" class="muted">{{ t('lobby.tableFull', { count: state.maxPlayers }, state.maxPlayers) }}</span>
    </div>
  </section>

  <section class="panel stack">
    <h2>{{ t('lobby.playStyle') }}</h2>
    <template v-if="isHost">
      <div class="options" role="radiogroup" :aria-label="t('lobby.playStyle')">
        <label v-for="option in judgingOptions" :key="option.mode" class="option" :class="{ on: state.judging === option.mode }">
          <input
            type="radio"
            name="judging"
            :value="option.mode"
            :checked="state.judging === option.mode"
            @change="send('setJudging', { mode: option.mode })"
          />
          <span>
            <strong>{{ option.title }}</strong>
            <span class="muted">{{ option.text }}</span>
          </span>
        </label>
      </div>
    </template>
    <p v-else>
      <strong>{{ currentJudging.title }}.</strong> <span class="muted">{{ currentJudging.text }}</span>
    </p>
  </section>

  <section class="panel stack">
    <h2>{{ t('lobby.categories') }}</h2>
    <template v-if="isHost">
      <p class="muted">{{ t('lobby.pickCategories') }}</p>
      <div class="categories">
        <label v-for="c in state.categories" :key="c.key" class="category" :class="{ on: c.selected }">
          <input type="checkbox" :checked="c.selected" @change="toggleCategory(c.key)" />
          <span>
            <strong>{{ text(c.label) }}</strong>
            <span class="muted">{{ c.description }}</span>
            <span class="count">{{ t('lobby.cardCount', { count: c.count }, c.count) }}</span>
          </span>
        </label>
      </div>
    </template>
    <p v-else class="muted">
      <template v-if="selected.length">{{ selectedNames }}</template>
      <template v-else>{{ t('lobby.noCategories') }}</template>
    </p>
    <p class="muted">
      {{ t('lobby.deckSize', { count: state.availableCards }, state.availableCards) }}
      <span v-if="!enoughCards" class="warn">
        {{ t('lobby.notEnoughCards', { players: players.length, handSize: state.handSize, needed: cardsNeeded }) }}
      </span>
    </p>
  </section>

  <section class="panel stack">
    <template v-if="isHost">
      <label class="row">
        {{ t('lobby.handSize') }}
        <input
          type="number"
          class="num"
          min="3"
          max="12"
          :value="state.handSize"
          @change="send('setHandSize', { size: $event.target.value })"
        />
      </label>
      <label class="row">
        {{ t('lobby.roundsEach') }}
        <input
          type="number"
          class="num"
          min="1"
          max="10"
          :value="state.roundsEach"
          @change="send('setRounds', { count: $event.target.value })"
        />
      </label>
      <p class="muted">
        {{
          t('lobby.gameLength', {
            times: t('lobby.times', { count: state.roundsEach }, state.roundsEach),
            rounds: t('lobby.rounds', { count: players.length * state.roundsEach }, players.length * state.roundsEach),
            players: t('lobby.playerCount', { count: players.length }, players.length),
          })
        }}
      </p>
      <button class="primary" :disabled="missingPlayers > 0 || !enoughCards" @click="send('start')">
        <template v-if="missingPlayers > 0">{{ t('lobby.needMore', { count: missingPlayers }, missingPlayers) }}</template>
        <template v-else-if="!enoughCards">{{ t('lobby.chooseMoreCategories') }}</template>
        <template v-else>{{ $t('lobby.start') }}</template>
      </button>
    </template>
    <p v-else class="muted">
      {{ t('lobby.waitingToStart', { handSize: state.handSize, times: t('lobby.times', { count: state.roundsEach }, state.roundsEach) }) }}
    </p>
  </section>

  <section class="panel rules">
    <h3>{{ t('lobby.howItWorks') }}</h3>
    <ol>
      <li>{{ t('lobby.rule.word') }}</li>
      <li v-if="state.judging === 'favourite'">{{ t('lobby.rule.everyoneSees') }}</li>
      <li v-else>{{ t('lobby.rule.oneInTheDark', { hidden: t('table.hiddenWord') }) }}</li>
      <li v-if="state.judging !== 'favourite'">{{ t('lobby.rule.bluff') }}</li>
      <li>{{ t('lobby.rule.reveal') }}</li>
      <li v-if="state.judging === 'favourite'">{{ t('lobby.rule.favourite', { points: state.pointsFavourite }) }}</li>
      <li v-else>{{ t(state.judging === 'chooser' ? 'lobby.rule.chooserDecides' : 'lobby.rule.everyoneVotes') }}</li>
    </ol>
  </section>
</template>

<style scoped>
.seats {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.seat {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  border-radius: 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
.seat.me {
  border-color: var(--amber);
}
.seat.away {
  opacity: 0.65;
}
.who {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.tag {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--amber);
  color: var(--amber);
}
.tag.bot {
  border-color: var(--muted);
  color: var(--muted);
}
.tag.away {
  border-color: var(--danger);
  color: var(--danger);
}
.num {
  width: 5rem;
}
.options,
.categories {
  display: grid;
  gap: 0.6rem;
}
.categories {
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
.option,
.category {
  display: flex;
  gap: 0.7rem;
  align-items: flex-start;
  padding: 0.7rem 0.9rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
  cursor: pointer;
}
.option.on,
.category.on {
  border-color: var(--amber);
  background: color-mix(in srgb, var(--amber) 10%, var(--bg-sunken));
}
.option input,
.category input {
  width: auto;
  margin-top: 0.25rem;
  accent-color: var(--amber);
}
.option > span,
.category > span {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.count {
  font-size: 0.8rem;
  color: var(--amber);
}
.warn {
  color: var(--danger);
}
.rules ol {
  margin: 0.6rem 0 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.35rem;
  color: var(--muted);
}
</style>
