import { makeShuffler } from './shuffler.js';

export default makeShuffler({
  id: 'shuffler-10',
  name: 'Rearranger (10)',
  description: 'Will move up to ten tiles already on the table to get its own tiles out.',
  tableTiles: 10,
});
