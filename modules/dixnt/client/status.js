// The words of the Status box: what is happening and what you should do next, worked out from the game's state.
// Returns { headline, mine, lines } for GameStatus. All instruction and turn text of the game lives here.
const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? ''));

export function statusFor(state, { isHost = false } = {}) {
  const me = state.me;
  const players = state.players;
  const chooser = players.find((p) => p.isChooser);
  const chooserName = chooser?.name ?? 'The chooser';
  const inRound = players.filter((p) => !p.waiting);
  const waitingOnCards = inRound.filter((p) => !p.isChooser && !p.hasPlayed).map((p) => p.name);
  const waitingOnVotes = inRound.filter((p) => !p.hasVoted).map((p) => p.name);
  const nameOf = (id) => players.find((p) => p.id === id)?.name ?? '?';
  const muted = (text) => ({ text, tone: 'muted' });

  if (state.phase === 'word') {
    if (me.isChooser) {
      return {
        headline: 'Your turn: choose a word or phrase.',
        mine: true,
        lines: [muted(state.judging === 'favourite' ? 'Everyone will see it. Pick something open to interpretation.' : 'Everyone else will see it, except one random player who sees ??? and has to bluff. Pick something open to interpretation.')],
      };
    }
    return { headline: `${chooserName} is choosing a word…`, mine: false, lines: [muted('While you wait, have a look at your hand.')] };
  }

  if (state.phase === 'picking') {
    const waiting = waitingOnCards.length ? `Waiting for ${list(waitingOnCards)}…` : '';
    if (me.waiting) return { headline: 'You joined mid-round, so you will be dealt in next round.', mine: false, lines: [] };
    if (me.isChooser) return { headline: waiting || 'Everyone has played.', mine: false, lines: [muted('This is your word. Waiting for everyone to play a card.')] };
    if (me.myPick !== null) return { headline: 'Card played.', mine: false, lines: [muted('You can swap it until everyone has played.'), ...(waiting ? [waiting] : [])] };
    if (state.wordHidden) return { headline: 'Your turn: you did not see the word. Play a card that could fit, and blend in.', mine: true, lines: [muted('Click a card in your hand to look closer and play it.'), ...(waiting ? [waiting] : [])] };
    return {
      headline: 'Your turn: play the card that fits the word best.',
      mine: true,
      lines: [muted(state.judging === 'favourite' ? 'The chooser will pick their favourite.' : 'One player cannot see this word.'), muted('Click a card in your hand to look closer and play it.'), ...(waiting ? [waiting] : [])],
    };
  }

  if (state.phase === 'voting') {
    if (state.judging === 'favourite' || state.judging === 'chooser') {
      const fav = state.judging === 'favourite';
      if (me.isChooser) {
        return {
          headline: me.myVote === null ? (fav ? 'Your turn: pick the card you like best.' : 'Your turn: who was in the dark?') : fav ? 'You have picked.' : 'You have decided.',
          mine: me.myVote === null,
          lines: [
            muted(
              fav
                ? `Listen to everyone explain why their card fits the word. That player scores ${state.pointsFavourite}.`
                : `Guess right and you score ${state.pointsChooserCorrect}. If you are fooled, the imposter scores ${state.pointsFooledChooser}.`,
            ),
          ],
        };
      }
      return {
        headline: fav ? `${chooserName} will pick their favourite.` : `${chooserName} will decide who was in the dark.`,
        mine: false,
        lines: [muted(fav ? `Explain why your card fits the word. If ${chooserName} picks yours you score ${state.pointsFavourite}.` : `Explain why your card fits the word. If ${chooserName} is fooled, the imposter scores ${state.pointsFooledChooser}.`)],
      };
    }
    if (me.waiting) return { headline: 'You will join in next round.', mine: false, lines: [] };
    return {
      headline: me.myVote === null ? 'Your turn: vote for the player who did not see the word.' : 'Your vote is in. You can still change it.',
      mine: me.myVote === null,
      lines: [
        ...(waitingOnVotes.length ? [`Still to vote: ${list(waitingOnVotes)}.`] : []),
        muted('Explain why you chose your card and listen to the others. The round ends when the last vote is in.'),
      ],
    };
  }

  if (state.phase === 'results' && state.results) {
    const r = state.results;
    const gained = (id) => r.deltas?.[id] ?? 0;
    const further = [];
    if (r.judging === 'favourite') {
      return { headline: `${nameOf(state.chooserId)} picked ${nameOf(r.winnerId)}’s card.`, mine: false, lines: [`${nameOf(r.winnerId)} scores ${state.pointsFavourite}.`, muted(`Played cards are discarded and everyone draws back up to ${state.handSize} cards.`)] };
    }
    if (r.judging === 'chooser') {
      further.push(r.groupCorrect ? `${nameOf(state.chooserId)} guessed right and scores ${state.pointsChooserCorrect}.` : `${nameOf(state.chooserId)} was fooled! ${nameOf(r.imposterId)} scores ${state.pointsFooledChooser}.`);
    } else {
      further.push(r.groupCorrect ? `The group found them. Everyone who voted for them scores ${state.pointsPerVote}.` : `The group was fooled! ${nameOf(r.imposterId)} scores ${gained(r.imposterId)} (${state.pointsPerVote} for each player who missed them).`);
    }
    if (r.judging === 'everyone') {
      const given = players.filter((p) => (r.tally?.[p.id] ?? 0) > 0).map((p) => `${p.name}: ${list(Object.entries(r.votes ?? {}).filter(([, target]) => target === p.id).map(([voter]) => nameOf(voter)))}`);
      if (given.length) further.push(muted(`Votes for ${given.join('; ')}.`));
    }
    return { headline: `${nameOf(r.imposterId)} was the imposter!`, mine: false, lines: further };
  }

  if (state.phase === 'finished') {
    const winners = players.filter((p) => state.winners.includes(p.id)).map((p) => p.name);
    return {
      headline: winners.length > 1 ? `It is a tie! ${list(winners)} win.` : `${winners[0] ?? 'Nobody'} wins!`,
      mine: false,
      lines: [
        muted(`Game over after ${state.completedRounds} round${state.completedRounds === 1 ? '' : 's'}.`),
        isHost ? { text: 'Press "Back to the lobby" to play again, or leave (top right).', tone: 'muted' } : muted('Waiting for the host to take everyone back to the lobby, or leave (top right).'),
      ],
    };
  }
  return { headline: '', mine: false, lines: [] };
}

/** The line that names the judging style, for the Status facts. */
export const styleName = (judging) => ({ everyone: 'Everyone votes', chooser: 'Only the chooser decides', favourite: 'Favourite card' })[judging] ?? judging;
