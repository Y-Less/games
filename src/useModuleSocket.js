// The play view's connection to a game module's socket namespace (/<id>), and what to do when it fails.  (The module's
// own client uses useGameSocket.js on top of the socket this one makes.)
// Depends on: vue, socket.io-client and session.js (so a refused connection can sign the user out locally, through setUser).
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { io } from 'socket.io-client';
import { setUser } from './session.js';
import { i18n } from './i18n.js';

/**
 * Connects to a game's namespace while the component is mounted (call from a component's setup).
 * @param {() => string} game  returns the module id (read once, on mount; the play view remounts when the route changes)
 * @param {{ available: () => boolean, onSignedOut: () => void }} options
 *   available: whether the game exists here (when not, `problem` says so and nothing connects);
 *   onSignedOut: called when the server refuses the connection because the user is not signed in
 * @returns {{ socket: import('vue').ShallowRef, connected: import('vue').Ref<boolean>, problem: import('vue').Ref<string> }}
 * Side effects: opens the socket on mount (signing the user out locally with setUser when refused for not being signed in,
 *   which also clears their shop and look) and closes it on unmount.
 */
export function useModuleSocket(game, { available, onSignedOut }) {
  const socket = shallowRef(null);
  const connected = ref(false);
  const problem = ref('');

  onMounted(() => {
    if (!available()) {
      problem.value = i18n.global.t('play.unavailable');
      return;
    }
    const s = io(`/${game()}`);
    s.on('connect', () => {
      connected.value = true;
      problem.value = '';
    });
    s.on('disconnect', () => (connected.value = false));
    s.on('connect_error', (error) => {
      if (/sign in/i.test(error.message)) {
        setUser(null); // not `session.user = null`: the shop balance and the CSS look must go too
        onSignedOut();
      } else {
        problem.value = i18n.global.t('play.unreachable');
      }
    });
    socket.value = s;
  });
  onBeforeUnmount(() => socket.value?.close());

  return { socket, connected, problem };
}
