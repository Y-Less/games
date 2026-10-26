// The score-bar chips open the standard player pop-up (src/components/PlayerPopup.vue). This composable holds which
// player's pop-up is open and does the opening and closing, so every game behaves alike:
//   - a click on another player's chip opens their pop-up, one at a time; clicking the chip again, pressing Esc or
//     clicking anywhere outside the pop-up closes it;
//   - it closes by itself when that player leaves, and after the host has removed them.
//
//   const { scoreProps, popupProps, openId, close } = usePlayerPopup({
//     players: () => state.scoreboard.players,      // the scoreboard players: { id, name, bot?, away?, isMe? ... }
//     hostId: () => hostPlayerId,                   // the host's id, in the same id space as the players' ids
//     isHost: () => iAmTheHost,                     // whether this person may remove others
//     remove: (id, player) => send(player.bot ? 'removeBot' : 'kick', { seat: id }), // the game's own event(s); may return the server's reply
//   });
//   <ScoreBoard v-bind="scoreProps" ... />
//   <PlayerPopup v-if="popupProps" v-bind="popupProps"> ...the game's panel for openId... </PlayerPopup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// What counts as "inside": the chips that open pop-ups, and the pop-up itself.
export const POPUP_INSIDE = '.score-bar .chip-button, .player-popup';

export function usePlayerPopup({ players, hostId = () => null, isHost = () => false, remove = null }) {
  const openId = ref(null);
  const error = ref('');

  const find = (id) => (id === null ? undefined : players().find((p) => p.id === id));
  const hasDetails = (id) => {
    const p = find(id);
    return Boolean(p) && !p.isMe;
  };
  const selected = computed(() => {
    const p = find(openId.value);
    return p && !p.isMe ? { ...p, isHost: hostId() !== null && p.id === hostId() } : null;
  });

  function open(id) {
    error.value = '';
    openId.value = id === null || !hasDetails(id) ? null : id;
  }
  const close = () => open(null);

  // The pop-up goes when its player does (or when it is the viewer's own seat, which has none).
  watch(selected, (now) => {
    if (!now && openId.value !== null) close();
  });

  async function removeSelected() {
    const target = selected.value;
    if (!target || !isHost() || !remove) return;
    error.value = '';
    let reply;
    try {
      reply = await remove(target.id, target);
    } catch {
      reply = { ok: false, error: 'Could not remove that player.' };
    }
    if (reply && reply.ok === false) error.value = reply.error || 'Could not remove that player.';
    else close();
  }

  // The path is read from the event, not the target's ancestors: the button that was clicked may already have been
  // swapped out of the page (the Remove button turning into its confirmation) by the time this runs.
  const inside = (event) => (event.composedPath?.() ?? [event.target]).some((el) => el?.matches?.(POPUP_INSIDE));
  const onOutside = (event) => {
    if (openId.value !== null && !inside(event)) close();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && openId.value !== null) close();
  };
  onMounted(() => {
    document.addEventListener('click', onOutside);
    window.addEventListener('keydown', onKey);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('click', onOutside);
    window.removeEventListener('keydown', onKey);
  });

  // Spread on <ScoreBoard v-bind="scoreProps">.
  const scoreProps = computed(() => ({ hasDetails, openDetails: openId.value, onDetails: open }));
  // Spread on <PlayerPopup v-if="popupProps" v-bind="popupProps">; null while nothing is open.
  const popupProps = computed(() =>
    selected.value ? { player: selected.value, canRemove: Boolean(isHost() && remove), error: error.value, onRemove: removeSelected } : null,
  );

  return { openId, selected, scoreProps, popupProps, open, close, error };
}
