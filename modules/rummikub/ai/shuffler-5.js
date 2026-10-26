import { makeShuffler } from './shuffler.js';

export default makeShuffler({
  id: 'shuffler-5',
  name: 'Tidy (moves up to 5 table tiles)',
  description: 'Adds to sets and makes new ones, and will only shift a handful of tiles on the table.',
  tableTiles: 5,
});
