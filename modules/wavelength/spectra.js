// The spectra of Wavelength: two opposites, and a few example clues with the place on the dial each one points to
// (0 is the left end, 100 the right end). The anchors are only used by the computer players, who cannot read a clue
// the way a person does: as the psychic one says the example nearest its target, and as a guesser one turns the dial
// to the place of the example it recognises. A person may write anything.
const spectrum = (id, left, right, ...anchors) => ({ id, left, right, anchors: anchors.map(([position, text]) => ({ position, text })) });

export const SPECTRA = [
  spectrum('temperature', 'Cold', 'Hot', [6, 'a freezer'], [28, 'a bracing sea swim'], [50, 'a pleasant spring day'], [74, 'a hot bath'], [95, 'the surface of the sun']),
  spectrum('speed', 'Slow', 'Fast', [5, 'a snail'], [25, 'a crowded high street'], [50, 'a bicycle'], [75, 'a motorway'], [96, 'a rocket']),
  spectrum('size', 'Tiny', 'Enormous', [5, 'a grain of sand'], [25, 'a mouse'], [50, 'a sofa'], [75, 'a cathedral'], [96, 'a galaxy']),
  spectrum('difficulty', 'Easy', 'Hard', [5, 'tying a shoelace'], [28, 'riding a bike'], [50, 'learning to drive'], [74, 'speaking Mandarin'], [96, 'solving a Rubik cube blindfolded']),
  spectrum('price', 'Cheap', 'Expensive', [5, 'a paperclip'], [28, 'a sandwich'], [50, 'a pair of trainers'], [74, 'a family car'], [96, 'a private jet']),
  spectrum('age', 'Young', 'Old', [5, 'a newborn'], [28, 'a teenager'], [50, 'a thirty year old'], [74, 'a pensioner'], [96, 'an ancient oak']),
  spectrum('weight', 'Light', 'Heavy', [5, 'a feather'], [28, 'a tennis ball'], [50, 'a bag of sugar'], [74, 'a piano'], [96, 'an elephant']),
  spectrum('volume', 'Quiet', 'Loud', [5, 'a library'], [28, 'a whisper'], [50, 'a normal conversation'], [74, 'a vacuum cleaner'], [96, 'a jet engine']),
  spectrum('film', 'Terrible film', 'Brilliant film', [5, 'a film you walk out of'], [28, 'a boring sequel'], [50, 'a decent Friday night film'], [74, 'a film you watch twice'], [96, 'an all-time classic']),
  spectrum('superpower', 'Useless superpower', 'Amazing superpower', [5, 'turning your socks inside out'], [28, 'talking to pigeons'], [50, 'invisibility when nobody is looking'], [74, 'flight'], [96, 'stopping time']),
  spectrum('texture', 'Rough', 'Smooth', [5, 'sandpaper'], [28, 'a brick wall'], [50, 'a woolly jumper'], [74, 'a polished table'], [96, 'a sheet of ice']),
  spectrum('taste', 'Sour', 'Sweet', [5, 'a lemon'], [28, 'a pickled onion'], [50, 'an apple'], [74, 'a chocolate bar'], [96, 'pure sugar']),
  spectrum('danger', 'Safe', 'Dangerous', [5, 'a teddy bear'], [28, 'a bicycle ride'], [50, 'a motorbike ride'], [74, 'a lion'], [96, 'a volcano']),
  spectrum('excitement', 'Boring', 'Exciting', [5, 'watching paint dry'], [28, 'a long meeting'], [50, 'a day out'], [74, 'a rollercoaster'], [96, 'a skydive']),
  spectrum('rarity', 'Rare', 'Common', [5, 'a four-leaf clover'], [28, 'a shooting star'], [50, 'a ginger cat'], [74, 'a sparrow'], [96, 'air']),
  spectrum('health', 'Unhealthy', 'Healthy', [5, 'a deep-fried chocolate bar'], [28, 'a burger'], [50, 'a cheese sandwich'], [74, 'porridge'], [96, 'a bowl of broccoli']),
  spectrum('wetness', 'Dry', 'Wet', [5, 'a desert'], [28, 'a cracker'], [50, 'a damp towel'], [74, 'a rainy day'], [96, 'the bottom of the ocean']),
  spectrum('silliness', 'Sensible', 'Ridiculous', [5, 'saving for a pension'], [28, 'carrying an umbrella'], [50, 'wearing a novelty hat'], [74, 'a pie-eating contest'], [96, 'a hat made of cheese']),
  spectrum('era', 'Ancient', 'Modern', [5, 'the pyramids'], [28, 'a castle'], [50, 'a steam train'], [74, 'a television'], [96, 'a smartphone']),
  spectrum('tidiness', 'Messy', 'Tidy', [5, 'a teenage bedroom'], [28, 'a kitchen after baking'], [50, 'a lived-in lounge'], [74, 'a hotel room'], [96, 'a museum shelf']),
  spectrum('feeling', 'Sad', 'Happy', [5, 'a funeral'], [28, 'a rainy Monday'], [50, 'an ordinary Tuesday'], [74, 'a birthday party'], [96, 'winning the lottery']),
  spectrum('smell', 'Smells awful', 'Smells wonderful', [5, 'rotten eggs'], [28, 'wet dog'], [50, 'fresh laundry'], [74, 'baking bread'], [96, 'roses after rain']),
  spectrum('pet', 'Bad pet', 'Good pet', [5, 'a crocodile'], [28, 'a tarantula'], [50, 'a goldfish'], [74, 'a cat'], [96, 'a loyal dog']),
  spectrum('wealth', 'Poor', 'Rich', [5, 'a beggar'], [28, 'a student'], [50, 'an office worker'], [74, 'a footballer'], [96, 'a billionaire']),
  spectrum('hardness', 'Soft', 'Hard', [5, 'a cloud'], [28, 'a pillow'], [50, 'a leather chair'], [74, 'a wooden floor'], [96, 'a diamond']),
  spectrum('brightness', 'Dark', 'Bright', [5, 'a cave'], [28, 'a cinema'], [50, 'an overcast day'], [74, 'a sunny beach'], [96, 'a camera flash']),
  spectrum('holiday', 'Awful holiday', 'Dream holiday', [5, 'a week of rain in a caravan'], [28, 'a lost-luggage weekend'], [50, 'a city break'], [74, 'a beach resort'], [96, 'a private island']),
  spectrum('stress', 'Relaxing job', 'Stressful job', [5, 'a lighthouse keeper'], [28, 'a librarian'], [50, 'a teacher'], [74, 'a paramedic'], [96, 'an air traffic controller']),
  spectrum('fantasy', 'Realistic', 'Fantasy', [5, 'a tax return'], [28, 'a soap opera'], [50, 'a superhero film'], [74, 'a dragon story'], [96, 'a unicorn riding a rainbow']),
  spectrum('weather', 'Awful weather', 'Perfect weather', [5, 'a hurricane'], [28, 'freezing drizzle'], [50, 'mild and grey'], [74, 'warm and breezy'], [96, 'a cloudless summer day']),
  spectrum('food', 'Disgusting food', 'Delicious food', [5, 'a boiled sprout'], [28, 'school custard'], [50, 'a cheese toastie'], [74, 'a roast dinner'], [96, 'warm chocolate pudding']),
  spectrum('fame', 'Unknown', 'Famous', [5, 'a hermit'], [28, 'your neighbour'], [50, 'a local newsreader'], [74, 'an Olympic champion'], [96, 'the Queen']),
  spectrum('duration', 'Short', 'Long', [5, 'a sneeze'], [28, 'a tea break'], [50, 'a film'], [74, 'a school term'], [96, 'a geological age']),
  spectrum('cool', 'Uncool', 'Cool', [5, 'socks with sandals'], [28, 'a bum bag'], [50, 'a denim jacket'], [74, 'sunglasses at night'], [96, 'a leather jacket on a motorbike']),
];

export const spectrumById = (id) => SPECTRA.find((s) => s.id === id) ?? null;
