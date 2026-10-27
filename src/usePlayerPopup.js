// The score-bar chips open the standard player pop-up (src/components/PlayerPopup.vue). This composable holds which
// player's pop-up is open and does the opening and closing, so every game behaves alike:
//   - hovering a player's chip (yours too: your own summary) opens their pop-up, one at a time, and it closes shortly after the pointer leaves
//     both the chip and the pop-up (so the pointer can cross to the pop-up, to press Remove);
//   - a click on the chip (a tap on a touch screen) pins it open: it then stays until the chip is clicked again, Esc is
//     pressed or anything outside the pop-up is clicked;
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
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

// What counts as "inside": the chips that open pop-ups, and the pop-up itself.
export const POPUP_INSIDE = '.score-bar .chip-button, .player-popup';

export function usePlayerPopup({ players, hostId = () => null, isHost = () => false, remove = null }) {
  const openId = ref(null);
  const error = ref('');
  const anchor = shallowRef(null); // the chip the pop-up hangs under
  let pinned = false; // opened by a click, so moving the pointer away does not close it
  let timer = null;
  const LEAVE_DELAY = 300; // ms the pointer may spend between the chip and the pop-up
  const cancelClose = () => {
    clearTimeout(timer);
    timer = null;
  };

  const find = (id) => (id === null ? undefined : players().find((p) => p.id === id));
  const hasDetails = (id) => Boolean(find(id)); // everyone has a summary, including you
  const selected = computed(() => {
    const p = find(openId.value);
    return p ? { ...p, isHost: hostId() !== null && p.id === hostId() } : null;
  });

  function open(id) {
    error.value = '';
    openId.value = id === null || !hasDetails(id) ? null : id;
    if (openId.value === null) {
      pinned = false;
      cancelClose();
    }
  }
  const close = () => open(null);

  // Hovering a chip shows its pop-up; leaving the chip or the pop-up closes it after a moment unless it was pinned.
  function hover(id, chip = null) {
    cancelClose();
    if (chip) anchor.value = chip;
    if (openId.value !== id) open(id);
  }
  function unhover() {
    cancelClose();
    if (pinned || openId.value === null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!pinned) close();
    }, LEAVE_DELAY);
  }
  // A click on a chip: the first pins its pop-up open, the next one closes it.
  function click(id, chip = null) {
    cancelClose();
    if (chip) anchor.value = chip;
    if (id === null) {
      if (pinned) close();
      else pinned = true;
    } else {
      open(id);
      pinned = openId.value !== null;
    }
  }

  // The pop-up goes when its player does.
  watch(selected, (now) => {
    if (!now && openId.value !== null) close();
  });

  async function removeSelected() {
    const target = selected.value;
    if (!target || target.isMe || !isHost() || !remove) return;
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
    cancelClose();
  });

  // Spread on <ScoreBoard v-bind="scoreProps">.
  const scoreProps = computed(() => ({ hasDetails, openDetails: openId.value, onDetails: click, onHover: hover, onUnhover: unhover }));
  // Spread on <PlayerPopup v-if="popupProps" v-bind="popupProps">; null while nothing is open.
  const popupProps = computed(() =>
    selected.value ? { player: selected.value, canRemove: Boolean(isHost() && remove && !selected.value.isMe), error: error.value, anchor: anchor.value, onRemove: removeSelected, onPointerenter: cancelClose, onPointerleave: unhover } : null,
  );

  return { openId, selected, scoreProps, popupProps, open, close, hover, unhover, click, error };
}
