// The play view's connection to a game module's socket namespace (/<id>), and what to do when it fails. (The module's
// own client uses useGameSocket.js on top of the socket this one makes.)
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { io } from 'socket.io-client';
import { session } from './session.js';

/**
 * Connects to a game's namespace while the component is mounted (call from a component's setup).
 * @param {() => string} game  returns the module id (read when needed, so a changed route is followed)
 * @param {{ available: () => boolean, onSignedOut: () => void }} options
 *   available: whether the game exists here (when not, `problem` says so and nothing connects);
 *   onSignedOut: called when the server refuses the connection because the user is not signed in
 * @returns {{ socket: import('vue').ShallowRef, connected: import('vue').Ref<boolean>, problem: import('vue').Ref<string> }}
 * Side effects: opens the socket on mount (clearing session.user when refused for not being signed in) and closes it on unmount.
 */
export function useModuleSocket(game, { available, onSignedOut }) {
  const socket = shallowRef(null);
  const connected = ref(false);
  const problem = ref('');

  onMounted(() => {
    if (!available()) {
      problem.value = 'That game is not available.';
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
        session.user = null;
        onSignedOut();
      } else {
        problem.value = 'Could not reach the game. Trying again…';
      }
    });
    socket.value = s;
  });
  onBeforeUnmount(() => socket.value?.close());

  return { socket, connected, problem };
}
