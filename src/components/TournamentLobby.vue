<script setup>
// File: the waiting room of a tournament, which stands in for the game's own lobby while tournament mode is on.
// Depends on: Vue, InviteCode.vue.
//
// It is the site's screen rather than any game's, for the reason given in shared/tournamentRoom.js: the people here
// are not at a table of this game — they are waiting to be dealt into tables of it — and the room holds more of them
// than the game has seats for, which a game's own lobby is entitled to assume cannot happen.
//
// Props: tournament (the `tournament` block of the state), code (the invite code), isHost (Boolean), busy (Boolean).
// Emits: change({ on?, humans?, bots? }), kick(slot), start.  The parent sends them.
// Side effects: none itself; only emits.
import { computed } from 'vue';
import InviteCode from './InviteCode.vue';
import { useGameText } from '../useGameText.js';

const props = defineProps({
  tournament: { type: Object, required: true },
  code: { type: String, required: true },
  isHost: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});
const { t } = useGameText();
const emit = defineEmits(['change', 'kick', 'start']);

const limits = computed(() => props.tournament.limits);
/** The most people one table may hold: the rest of it has to be a computer player, and a table has to fit the game. */
const mostPeople = computed(() => Math.min(limits.value.max, limits.value.maxEntrants));
/** How many computer players would still fit beside the people at a table. */
const mostBots = computed(() => limits.value.max - props.tournament.humans);
/** The fewest computer players this table can have and still be a game. */
const fewestBots = computed(() => Math.max(0, limits.value.min - props.tournament.humans));
/** Enough people have come for a tournament to be worth playing. */
const ready = computed(() => props.tournament.entrants.length >= 2);
</script>

<template>
  <section class="panel stack">
    <h2>{{ t('tournament.title') }}</h2>
    <p class="muted">{{ t('tournament.share') }}</p>
    <div class="row"><InviteCode :code="props.code" /></div>
  </section>

  <section class="panel stack">
    <h3>{{ t('tournament.whoIsHere', { count: props.tournament.entrants.length }, props.tournament.entrants.length) }}</h3>
    <ul class="entrants">
      <li v-for="person in props.tournament.entrants" :key="person.id" class="entrant" :class="{ me: person.isMe }">
        <span class="who">
          {{ person.name }}
          <span v-if="person.isMe" class="tag">{{ t('common.you') }}</span>
          <span v-if="person.isHost" class="tag">{{ t('common.host') }}</span>
        </span>
        <button v-if="props.isHost && !person.isMe" class="quiet" @click="emit('kick', person.slot)">{{ t('common.remove') }}</button>
      </li>
    </ul>
  </section>

  <section class="panel stack">
    <h3>{{ t('tournament.table') }}</h3>
    <fieldset class="group" :disabled="!props.isHost">
      <legend class="muted">{{ t('tournament.peopleAtATable') }}</legend>
      <div class="row">
        <button :disabled="props.tournament.humans <= 1" :aria-label="t('tournament.fewerPeople')" @click="emit('change', { humans: props.tournament.humans - 1 })">-</button>
        <strong>{{ t('tournament.people', { count: props.tournament.humans }, props.tournament.humans) }}</strong>
        <button :disabled="props.tournament.humans >= mostPeople" :aria-label="t('tournament.morePeople')" @click="emit('change', { humans: props.tournament.humans + 1 })">+</button>
      </div>
    </fieldset>
    <fieldset class="group" :disabled="!props.isHost">
      <legend class="muted">{{ t('tournament.botsAtATable') }}</legend>
      <div class="row">
        <button :disabled="props.tournament.bots <= fewestBots" :aria-label="t('tournament.fewerBots')" @click="emit('change', { bots: props.tournament.bots - 1 })">-</button>
        <strong>{{ t('tournament.bots', { count: props.tournament.bots }, props.tournament.bots) }}</strong>
        <button :disabled="props.tournament.bots >= mostBots" :aria-label="t('tournament.moreBots')" @click="emit('change', { bots: props.tournament.bots + 1 })">+</button>
      </div>
    </fieldset>
    <p class="muted">{{ t('tournament.everyCombination', { size: props.tournament.size, count: props.tournament.tablesInAll }, props.tournament.tablesInAll) }}</p>
    <p class="muted">{{ t('tournament.settingsFirst') }}</p>
  </section>

  <section class="panel stack">
    <div class="row">
      <button v-if="props.isHost" class="primary" :disabled="!ready || props.busy" @click="emit('start')">{{ t('tournament.start') }}</button>
      <span v-else class="muted">{{ t('lobby.waitingForHost') }}</span>
      <span v-if="props.isHost && !ready" class="muted">{{ t('tournament.needPeople', { min: 2 }) }}</span>
    </div>
    <label v-if="props.isHost" class="check">
      <input type="checkbox" checked @change="emit('change', { on: false })" />
      <span>{{ t('tournament.toggle') }}</span>
    </label>
  </section>
</template>

<style scoped>
.entrants {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.entrant {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.5rem 0.8rem;
  border-radius: 10px;
  background: var(--bg-sunken);
  border: 1px solid var(--line);
}
.entrant.me {
  border-color: var(--amber);
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
.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.check input {
  width: auto;
}
</style>
