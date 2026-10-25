<script setup>
// A reusable card-table layout for trick-taking games. `seats` lists every player clockwise starting with the viewer;
// the opponents sit round an oval (or in a wrapped row on a phone), the trick being played is in the middle, and the
// viewer's own seat goes in the #me slot at the bottom. Slots: #seat (one opponent: { seat, index }), #me, #centre
// (replaces the trick, for messages). `plays` is [{ key, card }] in the order played.
import { computed } from 'vue';
import PlayingCard from '../../../src/components/PlayingCard.vue';

const props = defineProps({
  seats: { type: Array, required: true }, // [{ key, name }], viewer first
  plays: { type: Array, default: () => [] },
  turnKey: { type: [String, Number], default: null },
  winnerKey: { type: [String, Number], default: null },
  caption: { type: String, default: '' },
});

const opponents = computed(() =>
  props.seats.slice(1).map((seat, i) => {
    const angle = (2 * Math.PI * (i + 1)) / props.seats.length;
    return { seat, index: i + 1, x: 50 - 41 * Math.sin(angle), y: 46 + 40 * Math.cos(angle) };
  }),
);
const nameOf = (key) => props.seats.find((s) => s.key === key)?.name ?? '';
</script>

<template>
  <div class="table">
    <div class="ring" :style="{ '--rows': Math.ceil(opponents.length / 2) }">
      <div
        v-for="o in opponents"
        :key="o.seat.key"
        class="spot"
        :class="{ turn: o.seat.key === turnKey }"
        :style="{ '--x': `${o.x}%`, '--y': `${o.y}%` }"
      >
        <slot name="seat" :seat="o.seat" :index="o.index" />
      </div>
      <div class="centre" aria-live="polite">
        <slot name="centre">
          <ul v-if="plays.length" class="trick">
            <li v-for="p in plays" :key="p.key" class="played" :class="{ won: p.key === winnerKey }">
              <PlayingCard :card="p.card" size="sm" />
              <span class="who">{{ nameOf(p.key) }}</span>
            </li>
          </ul>
          <p v-else class="muted empty">{{ caption }}</p>
        </slot>
      </div>
    </div>
    <div class="me" :class="{ turn: seats[0].key === turnKey }"><slot name="me" /></div>
  </div>
</template>

<style scoped>
.table {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.ring {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.spot {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-sunken);
}
.spot.turn,
.me.turn {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--amber) 45%, transparent);
}
.centre {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 6.2rem;
  order: -1;
}
.trick {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}
.played {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  max-width: 4.2rem;
}
.played.won :deep(.playing-card) {
  box-shadow: 0 0 0 3px var(--amber), 0 4px 10px rgb(0 0 0 / 0.5);
}
.played.won .who {
  color: var(--amber);
}
.who {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
}
.empty {
  margin: 0;
  text-align: center;
}
.me {
  border-radius: 12px;
}

@media (max-width: 719px) {
  .ring {
    flex-direction: row;
    flex-wrap: wrap;
  }
  .spot {
    flex: 1 1 8.5rem;
  }
  .centre {
    order: 0;
    flex: 1 1 100%;
  }
}
@media (min-width: 720px) {
  .ring {
    display: block;
    height: 25rem;
  }
  .spot {
    position: absolute;
    left: var(--x);
    top: var(--y);
    transform: translate(-50%, -50%);
    width: 10.5rem;
  }
  .centre {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 46%;
    height: 40%;
    min-height: 0;
  }
}
</style>
