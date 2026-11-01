// The "Juggler" computer player: a shuffler (see shuffler.js) that may move up to 20 table tiles, nearly the classic player.
import { makeShuffler } from './shuffler.js';

export default makeShuffler({
  id: 'shuffler-20',
  name: 'Juggler (20)',
  description: 'Will move up to twenty tiles already on the table, taking several sets apart at once.',
  tableTiles: 20,
});
