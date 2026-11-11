// Putting somebody out by vote: anybody in a room may ask for a player to be removed, and the others answer.  The
// host can already remove anybody outright (shared/seats.js and shared/roster.js, `kick`); this is for the rest of
// the table, so that a host who has gone quiet is not the only way to deal with somebody spoiling the game.
//
// The rules here are pure and know nothing of sockets: shared/roomServer.js drives them for every game, and the
// removal itself is the games' own `removeHuman`, which puts a computer player in the place as it does for a leaver.
// Somebody put out this way is barred from the room (shared/seats.js, barFromRoom), so the invitation does not let
// them straight back in.
//
// One vote runs at a time and it is kept on the room as `room.vote`, so it survives a restart like everything else:
//   { target, by, yes: [ids], no: [ids], until }
// There is no timer anywhere.  A vote simply stops counting once `until` has passed, which is checked whenever the
// vote is read, so a vote nobody answers cannot block the next one for ever.
// Depends on: ./members.js (fail, ok) and, for the adapter at the foot of this file, ./layout.js's idea of a slot.
import { fail, ok } from './members.js';

/** How long a vote stands before it lapses (ms). */
export const VOTE_MS = 60_000;

/**
 * The vote that is running, or null: one that has lapsed is no vote at all.
 *
 * @param {{ vote?: object }} room  not changed
 * @param {number} now  the clock
 * @returns {object | null} the vote
 * Side effects: none.
 */
export const voteOn = (room, now) => (room.vote && now < room.vote.until ? room.vote : null);

/**
 * How many must agree: more than half of the people who are not the one being voted on.  With two people in the room
 * that is the other one alone, which is the same power the host already has.
 *
 * @param {number} voters  how many people may answer
 * @returns {number}
 * Side effects: none.
 */
export const needed = (voters) => Math.floor(voters / 2) + 1;

/**
 * Asks for somebody to be put out.  Whoever asks has said yes by asking.
 *
 * @param {object} room  the room to change
 * @param {number} byId  the account asking
 * @param {object[]} people  everybody in the room who is a person (the game's own list)
 * @param {number | string} targetId  who they want out, in the same ids as `people`
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: sets `room.vote`.
 */
export function askToRemove(room, byId, people, targetId, now) {
  if (voteOn(room, now)) return fail('voteAlreadyRunning');
  if (!people.some((p) => p.id === byId)) return fail('notInGame');
  if (byId === targetId) return fail('cannotVoteOnYourself');
  if (!people.some((p) => p.id === targetId)) return fail('playerNotInGame');
  if (people.length < 3) return fail('needThreeToVote');
  room.vote = { target: targetId, by: byId, yes: [byId], no: [], until: now + VOTE_MS };
  return ok();
}

/**
 * Answers the vote that is running.  Answering twice replaces the earlier answer.
 *
 * @param {object} room  the room to change
 * @param {number} voterId  the account answering
 * @param {boolean} agree  whether they want them out
 * @param {object[]} people  everybody in the room who is a person
 * @param {number} now  the clock
 * @returns {{ ok: boolean, passed?: boolean, settled?: boolean, error?: string }} `passed` says the target should now
 *   be removed; `settled` says the vote is over either way (and has been cleared)
 * Side effects: changes `room.vote`, and clears it once the vote is settled.
 */
export function answerRemoval(room, voterId, agree, people, now) {
  const vote = voteOn(room, now);
  if (!vote) return fail('noVoteRunning');
  if (!people.some((p) => p.id === voterId)) return fail('notInGame');
  if (voterId === vote.target) return fail('cannotVoteOnYourself');
  vote.yes = vote.yes.filter((id) => id !== voterId);
  vote.no = vote.no.filter((id) => id !== voterId);
  (agree ? vote.yes : vote.no).push(voterId);

  const voters = people.filter((p) => p.id !== vote.target).length;
  if (vote.yes.length >= needed(voters)) {
    room.vote = null;
    return ok({ passed: true, settled: true });
  }
  // Once enough have said no, the rest cannot carry it, so there is nothing left to wait for.
  if (vote.no.length > voters - needed(voters)) {
    room.vote = null;
    return ok({ passed: false, settled: true });
  }
  return ok({ passed: false, settled: false });
}

/**
 * The person who asked calls it off.
 *
 * @param {object} room  the room to change
 * @param {number} byId  the account calling it off
 * @param {number} now  the clock
 * @returns {{ ok: boolean, error?: string }}
 * Side effects: clears `room.vote`.
 */
export function dropVote(room, byId, now) {
  const vote = voteOn(room, now);
  if (!vote) return fail('noVoteRunning');
  if (vote.by !== byId) return fail('onlyTheAskerDrops');
  room.vote = null;
  return ok();
}

/**
 * Forgets a vote that no longer makes sense: the person it is about has gone, or there are too few people left to
 * carry it.  Called after anything that changes who is in the room.
 *
 * @param {object} room  the room to change
 * @param {object[]} people  everybody in the room who is a person
 * @param {number} now  the clock
 * @returns {void}
 * Side effects: may clear `room.vote`.
 */
export function tidyVote(room, people, now) {
  const vote = voteOn(room, now);
  if (!vote) {
    room.vote = null;
    return;
  }
  if (!people.some((p) => p.id === vote.target) || people.length < 3) room.vote = null;
}

/**
 * What the people in the room are shown about the vote: who it is about, who asked, the count so far, how many are
 * needed, and whether this person has answered.  Null when no vote is running.
 *
 * @param {object} room  not changed
 * @param {number | string} forId  the person being shown it
 * @param {object[]} people  everybody in the room who is a person
 * @param {number} now  the clock
 * @returns {?{ target: *, by: *, yes: number, no: number, needed: number, answered: ?boolean, mine: boolean }}
 * Side effects: none.
 */
export function voteView(room, forId, people, now) {
  const vote = voteOn(room, now);
  if (!vote) return null;
  const voters = people.filter((p) => p.id !== vote.target).length;
  const answered = vote.yes.includes(forId) ? true : vote.no.includes(forId) ? false : null;
  return { target: vote.target, by: vote.by, yes: vote.yes.length, no: vote.no.length, needed: needed(voters), answered, mine: vote.by === forId };
}

/**
 * The rules above in the terms a room is actually spoken about in.
 *
 * Everybody is named from outside by their slot — "s0", "s1" — whichever family the game belongs to, so that a vote
 * about somebody says the same thing in every game and a client never has to know which kind of game it is drawing.
 * The votes themselves are kept in account ids, because that is what the rules remove by, so something has to stand
 * between the two; this is that something, and it is the only place either naming is translated.
 *
 * @param {object} options
 * @param {object} options.game  the rules (isHuman)
 * @param {(room: object) => object[]} options.members  everybody in the room, the way this family keeps them
 * @param {object} options.layout  how this family addresses a place (shared/layout.js)
 * @param {() => number} options.now  the clock
 * @returns {object} peopleIn, accountNamed, viewFor, ask, answer, drop, tidy
 * Side effects: none here; `ask`, `answer`, `drop` and `tidy` change `room.vote` as the rules above do.
 */
export function createVoteKick({ game, members, layout, now }) {
  /** Everybody in the room who is a person. */
  const peopleIn = (room) => (members(room) ?? []).filter((member) => game.isHuman?.(member));
  /** The account in that slot, or null when nobody is. */
  const accountNamed = (room, slot) => {
    const member = layout.at(room, slot);
    return game.isHuman?.(member) ? member.id : null;
  };
  /** The other way round: the slot that account is sitting in, or null. */
  const nameFor = (room, account) => {
    const list = members(room) ?? [];
    const index = list.findIndex((m) => game.isHuman?.(m) && m.id === account);
    return index === -1 ? null : layout.slotOf(list[index], index);
  };

  return {
    peopleIn,
    accountNamed,
    /** The vote running in a room as one person is shown it, or null; the players named the way the game names them. */
    viewFor(room, forId) {
      const view = voteView(room, forId, peopleIn(room), now());
      return view && { ...view, target: nameFor(room, view.target), by: nameFor(room, view.by) };
    },
    /** Asks for whoever is in a slot to be put out. */
    ask(room, byId, slot) {
      const target = accountNamed(room, slot);
      if (target === null) return fail('playerNotInGame');
      return askToRemove(room, byId, peopleIn(room), target, now());
    },
    /**
     * Answers the vote that is running, and says who is to go if that answer carried it.  The target is read before
     * the answer, because a vote that passes is over and no longer there to be asked.
     * @returns {{ ok: boolean, error?: string, passed?: boolean, target?: * }} `target` is null unless it passed
     */
    answer(room, byId, agree) {
      const target = room.vote?.target ?? null;
      const answered = answerRemoval(room, byId, agree, peopleIn(room), now());
      return answered.ok ? { ...answered, target: answered.passed ? target : null } : answered;
    },
    /** Gives up a vote you asked for. */
    drop: (room, byId) => dropVote(room, byId, now()),
    /** Forgets a vote about somebody who has gone, or one too few people are left to decide. */
    tidy: (room) => tidyVote(room, peopleIn(room), now()),
  };
}
