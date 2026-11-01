// Other players' windows: hidden until you click their name in the score bar, one at a time, over the main area (nothing moves).
import { computed } from 'vue';
import { usePlayerPopup } from '../../../src/usePlayerPopup.js';

/**
 * Wraps the platform's player pop-up for the Gaudi table.
 * @param {import('vue').ComputedRef<object>} s  the view sent by the server
 * @param {Function} send  sends a request to the server (used to kick or remove a computer player)
 * @returns {object} scoreProps and popupProps (bind them to the score board and PlayerPopup), closePopup(),
 *   openedPlayer (the seat clicked, yours too), openedSeat (that seat if it has a window to show), openedIsMe
 * Side effects: the pop-up's remove action sends 'kick' or 'removeBot'.
 */
export function useOpenedPlayer(s, send) {
  const { openId, scoreProps, popupProps, close: closePopup } = usePlayerPopup({
    players: () => s.value.scoreboard.players,
    hostId: () => s.value.hostSeat,
    isHost: () => s.value.hostSeat === s.value.you,
    remove: (seat, player) => send(player.bot ? 'removeBot' : 'kick', { seat }),
  });
  const openedPlayer = computed(() => s.value.seats.find((o) => o && o.seat === openId.value) ?? null); // yours too
  const openedSeat = computed(() => (openedPlayer.value?.window ? openedPlayer.value : null));
  const openedIsMe = computed(() => openedPlayer.value !== null && openedPlayer.value.seat === s.value.you);
  return { scoreProps, popupProps, closePopup, openedPlayer, openedSeat, openedIsMe };
}
