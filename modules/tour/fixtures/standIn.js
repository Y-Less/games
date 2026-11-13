// A game for the tour's tests to open.
//
// A tour does nothing by itself: everything interesting about it is that it opens a room in *another* module and hears
// when that game ends.  So its tests need a second module, and a real one would make them slow and would tie them to
// how that game happens to deal.  This is the smallest module that satisfies the room server: it starts the moment it
// is opened and finishes when a player says so.
//
// It is source rather than a module because the tests write it into a temporary modules folder and let the real site
// load it, which is the only way `ctx.games` is wired up at all.
// Depends on: nothing (the string below depends on shared/, as any module does).
import fs from 'node:fs';
import path from 'node:path';

/** The stand-in's `server.js`: rules and sockets in one file, since there are hardly any of either. */
export const STAND_IN = `import { rosterLayout } from '../../shared/layout.js';
import { createRoomServer } from '../../shared/roomServer.js';
import { createRosterRules, hasPlayer, isBot, isHuman, seatOf, withSlot } from '../../shared/roster.js';

const isLive = (room) => room.phase !== 'finished';
const makePlayer = (room, base) => ({ ...base });
const roster = createRosterRules({ isLive, minPlayers: 2, maxPlayers: 8, makePlayer });

const game = {
  ...roster,
  isLive,
  isHuman,
  isBot,
  hasPlayer,
  seatOf,
  createRoom({ code, hostId, hostName, now }) {
    const room = { code, hostId, phase: 'lobby', players: [], size: 8, nextIdx: 0, nextBot: 1, recorded: false, createdAt: now, updatedAt: now };
    room.players.push(withSlot(room, makePlayer(room, { kind: 'human', id: hostId, name: hostName })));
    return room;
  },
  setSettings: () => ({ ok: false, error: 'noSettings' }),
  start(room) {
    room.phase = 'playing';
    return { ok: true };
  },
  playAgain(room) {
    room.phase = 'lobby';
    return { ok: true };
  },
  statsPlayers: () => [],
  viewFor: (room) => ({ phase: room.phase, players: room.players.map((p) => ({ slot: p.slot, id: p.id, name: p.name, bot: isBot(p) })) }),
};

export default function (ctx) {
  return createRoomServer(ctx, {
    game,
    pickSettings: () => ({}),
    members: (room) => room.players,
    layout: rosterLayout,
    nextAction: () => null,
    registerEvents({ on, act }) {
      on('endIt', () => act((room) => {
        room.phase = 'finished';
        return { ok: true };
      }));
    },
  });
}
`;

/**
 * Builds a modules folder holding the tour and however many stand-ins, plus the shared code both import, and returns
 * its path.  More than one stand-in lets a vote have something to choose between.
 *
 * @param {string} root  a temporary folder to build in
 * @param {string} tourDir  where the real tour module is
 * @param {string[]} [names]  the stand-ins' module ids, which are also what the vote shows
 * @returns {string} the modules folder
 * Side effects: writes files under `root`.
 */
export function modulesWithStandIns(root, tourDir, names = ['mini']) {
  const dir = path.join(root, 'modules');
  const platform = path.join(tourDir, '..', '..');
  fs.cpSync(tourDir, path.join(dir, 'tour'), { recursive: true, filter: (source) => !/\.test\.js$/.test(source) && !['client', 'fixtures'].includes(path.basename(source)) });
  fs.cpSync(path.join(platform, 'shared'), path.join(root, 'shared'), { recursive: true, filter: (source) => !/\.test\.js$/.test(source) });
  for (const name of names) {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'module.json'), JSON.stringify({ id: name, name: name[0].toUpperCase() + name.slice(1), description: 'A stand-in.', minPlayers: 2, maxPlayers: 8, category: 'other' }));
    fs.writeFileSync(path.join(dir, name, 'server.js'), STAND_IN);
  }
  return dir;
}
