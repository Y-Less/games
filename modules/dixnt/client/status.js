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
  const me = state.me;
  const players = state.players;
  const chooser = players.find((p) => p.isChooser);
  const chooserName = chooser?.name ?? msg('status.theChooser');
  const inRound = players.filter((p) => !p.waiting);
  const waitingOnCards = inRound.filter((p) => !p.isChooser && !p.hasPlayed).map((p) => p.name);
  const waitingOnVotes = inRound.filter((p) => !p.hasVoted).map((p) => p.name);
  // Returns the name of a player id ('?' if unknown).
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '?';
  // Returns a Status line in the muted tone.
  const muted = (text) => ({ text, tone: 'muted' });

  if (state.phase === 'word') {
    if (me.isChooser) {
      return {
        headline: msg('status.chooseWord'),
        mine: true,
        lines: [muted(state.judging === 'favourite' ? msg('status.chooseWordFavourite') : msg('status.chooseWordImposter', { hidden: msg('table.hiddenWord') }))],
      };
    }
    return { headline: msg('status.choosing', { name: chooserName }), mine: false, lines: [muted(msg('status.lookAtHand'))] };
  }

  if (state.phase === 'picking') {
    const waiting = waitingOnCards.length ? msg('status.waitingFor', { names: waitingOnCards }) : null;
    if (me.waiting) return { headline: msg('status.joinedMidRound'), mine: false, lines: [] };
    if (me.isChooser) return { headline: waiting ?? msg('status.everyonePlayed'), mine: false, lines: [muted(msg('status.yourWord'))] };
    if (me.myPick !== null) return { headline: msg('status.cardPlayed'), mine: false, lines: [muted(msg('status.canSwap')), ...(waiting ? [waiting] : [])] };
    if (state.wordHidden) return { headline: msg('status.playInTheDark'), mine: true, lines: [muted(msg('status.clickToPlay')), ...(waiting ? [waiting] : [])] };
    return {
      headline: msg('status.playCard'),
      mine: true,
      lines: [muted(state.judging === 'favourite' ? msg('status.chooserPicks') : msg('status.oneInTheDark')), muted(msg('status.clickToPlay')), ...(waiting ? [waiting] : [])],
    };
  }

  if (state.phase === 'voting') {
    if (state.judging === 'favourite' || state.judging === 'chooser') {
      const fav = state.judging === 'favourite';
      if (me.isChooser) {
        return {
          headline: me.myVote === null ? msg(fav ? 'status.pickFavourite' : 'status.decide') : msg(fav ? 'status.picked' : 'status.decided'),
          mine: me.myVote === null,
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
    if (me.waiting) return { headline: msg('status.joinNextRound'), mine: false, lines: [] };
    return {
      headline: msg(me.myVote === null ? 'status.vote' : 'status.voteIn'),
      mine: me.myVote === null,
      lines: [...(waitingOnVotes.length ? [msg('status.stillToVote', { names: waitingOnVotes })] : []), muted(msg('status.explainVote'))],
    };
  }

  if (state.phase === 'results' && state.results) {
    const r = state.results;
    // Returns the points a player gained this round (0 if none recorded).
    const gained = (id) => r.deltas?.[id] ?? 0;
    const further = [];
    if (r.judging === 'favourite') {
      return {
        headline: msg('status.favouritePicked', { chooser: nameOf(state.chooserId), winner: nameOf(r.winnerId) }),
        mine: false,
        lines: [msg('status.scores', { name: nameOf(r.winnerId), points: state.pointsFavourite }), muted(msg('status.discardAndDraw', { handSize: state.handSize }))],
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
    const winners = players.filter((p) => state.winners.includes(p.id)).map((p) => p.name);
    return {
      headline: winners.length > 1 ? msg('status.tie', { names: winners }) : msg('scoreboard.wins', { name: winners[0] ?? msg('status.nobody') }),
      mine: false,
      lines: [
        muted(msg('status.gameOverAfter', { count: state.completedRounds })),
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
