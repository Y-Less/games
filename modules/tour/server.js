// The socket layer for a tour.  The rules live in game.js; the rooms, saving, views, joining and the lobby events are
// the shared room server (shared/roomServer.js).  What is particular to a tour is that it does not play anything
// itself: it decides by vote which *other* game is played next, opens that game's room through `ctx.games`, sends
// everybody to it, and waits to be told it has ended.
//
// Three site capabilities do the crossing, and nothing else in the site uses them (see MODULES.md):
//   ctx.games.list()         what else is playable, and for how many
//   ctx.games.open(id, ...)  a started room in another module, and its invite code
//   ctx.games.onFinished()   that a game somewhere has ended
//   ctx.tell(userId, ...)    reaches a person on the site's own socket, even while they are inside another game
//
// Timing can be changed through the environment (the tests make it fast):
//   TOUR_BOT_DELAY  "min-max" milliseconds a computer player waits before voting (default 600-1400)
import { rosterLayout } from '../../shared/layout.js';
import { THINKING, botWait, createRoomServer, readDelayRange } from '../../shared/roomServer.js';
import * as game from './game.js';

/**
 * Starts the tour's server half.
 *
 * Side effects: everything createRoomServer does, plus a subscription to every module's finished games.
 *
 * @param {object} ctx  the module context from the site
 * @returns {{ dispose: () => void }}
 */
export default function (ctx) {
  const botDelay = readDelayRange('TOUR_BOT_DELAY', THINKING);
  // Randomness and the clock are made once here and handed to everything, so one seed replays a whole tour.
  const rng = Math.random;
  const now = Date.now;
  /** What else can be played, asked afresh every time: modules load in their own order and may be reloaded. */
  const catalogue = () => ctx.games.list();
  const nameOf = (id) => ctx.users.get(id)?.displayName;

  // Where each tour was when its people were last told, so that a join or a vote does not nudge everybody out of the
  // game they are in the middle of.  Only moving between phases, or to a different game, is worth interrupting for.
  const announced = new Map();

  /**
   * Tells everybody in a tour where it has got to, on the site's own socket, so that somebody sitting in another
   * game's room hears it.  The payload is only a nudge: the band asks the tour itself for the details.
   * @param {object} room  the tour
   * @returns {void}  Side effects: one emit per person, and only when something they would act on has changed.
   */
  function nudge(room) {
    const where = `${room.phase}:${room.current?.code ?? ''}`;
    if (announced.get(room.code) === where) return;
    announced.set(room.code, where);
    for (const player of game.humans(room)) {
      ctx.tell(player.id, 'tour', { code: room.code, phase: room.phase, game: room.current?.game ?? null, gameCode: room.current?.code ?? null });
    }
  }

  /**
   * Acts on a vote that has been settled: opens the winning game and sends everybody to it, or finishes the tour.
   * A game that will not open is said so and voted on again, rather than ending everybody's evening.
   * @param {object} room  the tour, already in 'opening'
   * @param {() => number} rng  random numbers
   * @param {number} now  the clock
   * @returns {void}  Side effects: may open a room in another module; always leaves the tour out of 'opening'.
   */
  function openChosen(room, at) {
    const chosen = room.chosen;
    if (chosen === game.END || !chosen) {
      game.finish(room);
      return;
    }
    const people = game.humans(room).map((player) => ({ id: player.id, name: nameOf(player.id) ?? player.name }));
    // The tour's own host hosts the game where they can, so "Remove computer player" there belongs to the same person.
    const host = people.find((person) => person.id === room.hostId) ?? people[0];
    if (!host) {
      game.openingFailed(room, 'needPerson', catalogue(), rng, at);
      return;
    }
    const opened = ctx.games.open(chosen, { hostId: host.id, hostName: host.name, people, size: room.players.length });
    if (!opened.ok) {
      ctx.log(`could not open ${chosen}:`, opened.error);
      game.openingFailed(room, opened.error, catalogue(), rng, at);
      return;
    }
    game.playing(room, chosen, opened.code, at);
  }

  const handle = createRoomServer(ctx, {
    game,
    pickSettings: () => ({}),
    members: (room) => room.players,
    layout: rosterLayout,
    rng,
    now,
    migrate: (room) => game.migrate(room, nameOf),
    viewOptions: () => ({ nameOf, catalogue: catalogue() }),
    // Every change is a chance that the tour has moved somewhere its people should follow; `nudge` decides whether it
    // actually has, so an ordinary join does not pull everybody out of the game they are playing.
    afterChange: (room) => nudge(room),
    // `start` needs to know what is playable, which the rules are deliberately not told at import time.
    startRule: (room, userId, rng, now) => game.start(room, userId, rng, now, catalogue()),
    /**
     * What the tour owes itself next: a computer player's vote, the end of a vote, opening the game that won, or
     * giving up on a game that has gone quiet for hours.
     *
     * @param {object} room  not changed here
     * @param {() => number} rng  random numbers
     * @param {() => number} now  the clock
     * @returns {{ key?: string, wait: number, run: () => void } | null} null while it waits for a person
     */
    nextAction(room, random, clock) {
      const round = room.played.length; // part of every key, so one vote's timers are never another's
      if (room.phase === 'opening') {
        // Only reached when the server stopped between the vote being settled and the game being opened.
        return { key: `open:${round}`, wait: 0, run: () => openChosen(room, clock()) };
      }
      if (room.phase === 'voting') {
        const waiting = room.players.find((player) => game.isBot(player) && room.votes[player.slot] === undefined);
        if (waiting) {
          // A computer player picks a game at random, and never votes to end the evening: when to stop is for the
          // people at the table to decide, and a tour of one person and three computers would otherwise end by lot.
          return { key: `vote:${round}:${waiting.slot}`, wait: botWait(botDelay, random), run: () => game.vote(room, waiting.id, room.choices[Math.floor(random() * room.choices.length)]) };
        }
        // Everybody has voted, or the clock has run out: settle it and act on it in one go, so the room is never left
        // sitting in 'opening' waiting for a second timer.
        return {
          // The count is in the key because the wait depends on it: the last vote in turns a minute's wait into none,
          // and a timer whose key had not changed would be left to run its full minute.
          key: `settle:${round}:${Object.keys(room.votes).length}`,
          wait: game.everybodyVoted(room) ? 0 : Math.max(0, room.until - clock()),
          run: () => {
            if (game.settle(room, random).ok) openChosen(room, clock());
          },
        };
      }
      if (room.phase === 'playing') {
        // The game should tell us it is over (see onFinished).  This is only the long stop for one that never does,
        // because everybody left it: the tour goes back to a vote rather than waiting for ever.
        return { key: `played:${round}`, wait: Math.max(0, room.until - clock()), run: () => game.gameOver(room, catalogue(), random, clock()) };
      }
      return null;
    },
    /**
     * The tour's own socket events: voting.
     * @param {object} helpers  from the shared room server
     * @returns {void}  Side effects: registers handlers; a vote mutates the room.
     */
    registerEvents({ act, on, userId }) {
      on('vote', ({ choice }) => act((room) => game.vote(room, userId, choice)));
    },
  });

  // A game this tour opened has ended: back to the vote, and everybody is told where to find it.  The handler sees
  // every finished game on the site, so it looks for the tour that is waiting for this one and ignores the rest.
  const stopWatching = ctx.games.onFinished((id, finished) => {
    for (const room of handle.rooms.values()) {
      if (room.phase !== 'playing' || room.current?.game !== id || room.current?.code !== finished.code) continue;
      // `changed` saves it, sends it and sets the next timer; `afterChange` nudges everybody from inside that.
      if (game.gameOver(room, catalogue(), rng, now()).ok) handle.changed(room);
    }
  });

  return {
    dispose() {
      stopWatching();
      handle.dispose();
    },
  };
}
