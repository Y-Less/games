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

/**
 * Holds which player's pop-up is open, and the hover, click, Esc and click-outside rules for opening and closing it.
 * Call from a game client's setup.
 * @param {object} options
 * @param {() => Array<object>} options.players  the scoreboard players ({ id, name, bot?, away?, isMe? ... })
 * @param {() => ?(string|number)} [options.hostId]  the host's id, in the same id space as the players' ids
 * @param {() => boolean} [options.isHost]  whether this person may remove others
 * @param {?((id: *, player: object) => (Promise<{ ok: boolean, error?: string }>|void))} [options.remove]  removes a
 *   player (the game's own event); null means nobody can be removed
 * @returns {{ openId, selected, scoreProps, popupProps, open, close, hover, unhover, click, error }}  refs and
 *   computed props to bind on ScoreBoard and PlayerPopup, and the open/close handlers; error is a removal failure text
 * Side effects: while mounted, listens for document clicks and window keydown (removed on unmount); hover leave starts a
 * 300 ms timer; remove is called when the host removes the selected player.
 */
export function usePlayerPopup({ players, hostId = () => null, isHost = () => false, remove = null }) {
  const openId = ref(null);
  const error = ref('');
  const anchor = shallowRef(null); // the chip the pop-up hangs under
  let pinned = false; // opened by a click, so moving the pointer away does not close it
  let timer = null;
  const LEAVE_DELAY = 300; // ms the pointer may spend between the chip and the pop-up
  // Stops a pending close-after-leave. Returns nothing.
  const cancelClose = () => {
    clearTimeout(timer);
    timer = null;
  };

  // The scoreboard player with this id, or undefined (also for null).
  const find = (id) => (id === null ? undefined : players().find((p) => p.id === id));
  // Whether a pop-up can be shown for this id (true for every listed player).
  const hasDetails = (id) => Boolean(find(id)); // everyone has a summary, including you
  // The open player, with isHost added, or null when nothing is open or that player has gone.
  const selected = computed(() => {
    const p = find(openId.value);
    return p ? { ...p, isHost: hostId() !== null && p.id === hostId() } : null;
  });

  // Opens the pop-up for `id` (null or unknown closes it). Side effects: clears error; closing also unpins and cancels the timer.
  function open(id) {
    error.value = '';
    openId.value = id === null || !hasDetails(id) ? null : id;
    if (openId.value === null) {
      pinned = false;
      cancelClose();
    }
  }
  // Closes the pop-up. Returns nothing.
  const close = () => open(null);

  // Hovering a chip shows its pop-up; leaving the chip or the pop-up closes it after a moment unless it was pinned.
  // Pointer enters a chip (or the pop-up, with id = the open one). `chip` is the element to anchor under. Side effects: may open.
  function hover(id, chip = null) {
    cancelClose();
    if (chip) anchor.value = chip;
    if (openId.value !== id) open(id);
  }
  // Pointer leaves: closes after LEAVE_DELAY unless pinned. Side effects: schedules a timer.
  function unhover() {
    cancelClose();
    if (pinned || openId.value === null) return;
    timer = setTimeout(() => {
      timer = null;
      if (!pinned) close();
    }, LEAVE_DELAY);
  }
  // A click on a chip: the first pins its pop-up open, the next one closes it.
  // `id` null means a click on the pop-up's own chip area: toggle pin. Side effects: may open, pin or close.
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

  // Asks the game to remove the open player (host only, never yourself). Side effects: calls `remove`; sets error on refusal, else closes.
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
  // Returns true when the event came from a chip or the pop-up.
  const inside = (event) => (event.composedPath?.() ?? [event.target]).some((el) => el?.matches?.(POPUP_INSIDE));
  // Document click handler: closes when the click was outside. Returns nothing.
  const onOutside = (event) => {
    if (openId.value !== null && !inside(event)) close();
  };
  // Window keydown handler: Esc closes. Returns nothing.
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
