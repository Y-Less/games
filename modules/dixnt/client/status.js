// The words of the Status box: what is happening and what you should do next, worked out from the game's state.
// Nothing in here is a sentence: the headline and every line's text is a message (`{ key, params }`, see
// shared/messages.js) under the game's `status.*` keys, which the root component puts into the player's language with
// `text()`.  Returns { headline, mine, lines } for GameStatus.  All instruction and turn text of the game lives here.
import { msg } from '../../../shared/messages.js';

/**
 * Works out what the Status box should say for the current state: the headline, whether it is the viewer's move, and
 * the extra lines, which depend on the phase (word, picking, voting, results, finished) and the judging style.
 * @param {object} state  The viewer's personalised game state.
 * @param {{isHost?: boolean}} [options]  isHost adds the host's instruction at the end of the game.
 * @returns {{headline: object | string, mine: boolean, lines: Array<object | {text: object, tone: string}>}} Content
 *   for GameStatus, with every piece of text a message.
 * Side effects: none.
 */
export function statusFor(state, { isHost = false } = {}) {
  const players = state.players;
  const chooser = players.find((p) => p.isChooser);
  const chooserName = chooser?.name ?? msg('status.theChooser');
  // Who the turn is still waiting on for a card: whoever plays one this turn, which with no chooser is everybody.
  const waitingOnCards = players.filter((p) => p.plays && !p.hasPlayed).map((p) => p.name);
  const waitingOnVotes = players.filter((p) => !p.hasVoted).map((p) => p.name);
  // Returns the name of a player id ('?' if unknown).  A table keyed by a player id has text keys, while a person's
  // id is their account number, so the two are matched as text.
  const nameOf = (id) => players.find((p) => String(p.id) === String(id))?.name ?? '?';
  // Is the viewer one of the players?  Somebody looking in from outside has no place in the turn at all.
  const inGame = players.some((p) => String(p.id) === String(state.you));
  // Returns a Status line in the muted tone.
  const muted = (text) => ({ text, tone: 'muted' });

  if (state.phase === 'word') {
    if (state.isChooser) {
      return {
        headline: msg('status.chooseWord'),
        mine: true,
        lines: [muted(state.hasImposter ? msg('status.chooseWordImposter', { hidden: msg('table.hiddenWord') }) : msg('status.chooseWordFavourite'))],
      };
    }
    return { headline: msg('status.choosing', { name: chooserName }), mine: false, lines: [muted(msg('status.lookAtHand'))] };
  }

  if (state.phase === 'picking') {
    const waiting = waitingOnCards.length ? msg('status.waitingFor', { names: waitingOnCards }) : null;
    // The chooser is the one person who sits a turn's cards out, and only where there is one: with no chooser even
    // the player whose turn it is plays, so it is whether you play a card that decides what you are told, not who you
    // are.  Somebody who is not in the room plays no card either, and is told what the table is doing, not what to do.
    if (inGame && !state.playsCard) return { headline: waiting ?? msg('status.everyonePlayed'), mine: false, lines: [muted(msg('status.yourWord'))] };
    if (state.myPick !== null) return { headline: msg('status.cardPlayed'), mine: false, lines: [muted(msg('status.canSwap')), ...(waiting ? [waiting] : [])] };
    if (state.wordHidden) return { headline: msg('status.playInTheDark'), mine: true, lines: [muted(msg('status.clickToPlay')), ...(waiting ? [waiting] : [])] };
    // What becomes of the cards: somebody is bluffing among them, the chooser will pick one, or the table will vote.
    const whatFollows = state.hasImposter ? msg('status.oneInTheDark') : msg(state.groupVotes ? 'status.tableVotesBest' : 'status.chooserPicks');
    return {
      headline: msg('status.playCard'),
      mine: true,
      lines: [muted(whatFollows), muted(msg('status.clickToPlay')), ...(waiting ? [waiting] : [])],
    };
  }

  if (state.phase === 'voting') {
    if (!state.groupVotes) {
      // One player decides, and that player is the word-chooser: either picking the card they like best, or saying
      // who they think was bluffing.
      const fav = !state.hasImposter;
      if (state.isChooser) {
        return {
          headline: state.myVote === null ? msg(fav ? 'status.pickFavourite' : 'status.decide') : msg(fav ? 'status.picked' : 'status.decided'),
          mine: state.myVote === null,
          lines: [
            muted(
              fav
                ? msg('status.listenFavourite', { points: state.pointsFavourite })
                : msg('status.guessRight', { correct: state.pointsChooserCorrect, fooled: state.pointsFooledChooser }),
            ),
          ],
        };
      }
      return {
        headline: msg(fav ? 'status.willPickFavourite' : 'status.willDecide', { name: chooserName }),
        mine: false,
        lines: [
          muted(
            fav
              ? msg('status.explainFavourite', { name: chooserName, points: state.pointsFavourite })
              : msg('status.explainDecide', { name: chooserName, points: state.pointsFooledChooser }),
          ),
        ],
      };
    }
    // The whole table votes: for who was bluffing, or, where nobody was, for the card they like best.
    const stillToVote = waitingOnVotes.length ? [msg('status.stillToVote', { names: waitingOnVotes })] : [];
    if (!state.hasImposter) {
      return {
        headline: msg(state.myVote === null ? 'status.pickBest' : 'status.bestIn'),
        mine: state.myVote === null,
        lines: [...stillToVote, muted(msg('status.explainBest', { perBest: state.pointsPerBest }))],
      };
    }
    return {
      headline: msg(state.myVote === null ? 'status.vote' : 'status.voteIn'),
      mine: state.myVote === null,
      lines: [...stillToVote, muted(msg('status.explainVote'))],
    };
  }

  if (state.phase === 'results' && state.results) {
    const r = state.results;
    // Returns the points a player gained this turn (0 if none recorded).
    const gained = (id) => r.deltas?.[id] ?? 0;
    const further = [];
    if (r.judging === 'favourite') {
      return {
        headline: msg('status.favouritePicked', { chooser: nameOf(state.chooserId), winner: nameOf(r.winnerId) }),
        mine: false,
        lines: [msg('status.scores', { name: nameOf(r.winnerId), points: state.pointsFavourite }), muted(msg('status.discardAndDraw', { handSize: state.handSize }))],
      };
    }
    if (r.judging === 'best') {
      // Nobody was bluffing, so the turn is read off the table: who the table settled on, then what each card earned.
      const scored = players.filter((p) => gained(p.id) > 0);
      return {
        headline: r.winnerId === null || r.winnerId === undefined ? msg('status.bestTie') : msg('status.bestPicked', { name: nameOf(r.winnerId) }),
        mine: false,
        lines: [
          ...scored.map((p) => msg('status.scoresVotes', { name: p.name, points: gained(p.id), count: r.tally?.[p.id] ?? 0 })),
          muted(msg('status.discardAndDraw', { handSize: state.handSize })),
        ],
      };
    }
    if (r.judging === 'chooser') {
      further.push(
        r.groupCorrect
          ? msg('status.chooserRight', { name: nameOf(state.chooserId), points: state.pointsChooserCorrect })
          : msg('status.chooserFooled', { chooser: nameOf(state.chooserId), imposter: nameOf(r.imposterId), points: state.pointsFooledChooser }),
      );
    } else {
      further.push(
        r.groupCorrect
          ? msg('status.groupFound', { points: state.pointsPerVote })
          : msg('status.groupFooled', { name: nameOf(r.imposterId), points: gained(r.imposterId), each: state.pointsPerVote }),
      );
    }
    if (r.judging === 'everyone') {
      // One line per player who was voted for, so no sentence is built out of pieces.
      for (const p of players.filter((q) => (r.tally?.[q.id] ?? 0) > 0)) {
        const voters = Object.entries(r.votes ?? {}).filter(([, target]) => target === p.id).map(([voter]) => nameOf(voter));
        further.push(muted(msg('status.votesFor', { name: p.name, voters })));
      }
    }
    return { headline: msg('status.wasImposter', { name: nameOf(r.imposterId) }), mine: false, lines: further };
  }

  if (state.phase === 'finished') {
    const winners = players.filter((p) => p.winner).map((p) => p.name);
    return {
      headline: winners.length > 1 ? msg('status.tie', { names: winners }) : msg('scoreboard.wins', { name: winners[0] ?? msg('status.nobody') }),
      mine: false,
      lines: [
        muted(msg('status.gameOverAfter', { count: state.completedTurns })),
        muted(msg(isHost ? 'status.hostAgain' : 'status.waitingHost')),
      ],
    };
  }
  return { headline: '', mine: false, lines: [] };
}

/**
 * Names a judging style for the Status facts, as a message (an unknown style comes back as it is).
 * @param {string} judging  'everyone', 'chooser', or 'favourite'.
 * @returns {object | string} The message to show, or the raw style if it is not one of the three.
 * Side effects: none.
 */
export const styleName = (judging) => (['everyone', 'chooser', 'favourite'].includes(judging) ? msg(`judging.${judging}.short`) : judging);
