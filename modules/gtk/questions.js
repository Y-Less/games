// The questions of GTK, and the answer pools the computer players write from.  This is the game's content, not its
// interface: like Just One's word list and Wavelength's spectra it stays in one file of English rather than in the
// locale files (see src/i18n.test.js, NOT_PLAYER_FACING), because a translation of it is a translation of content.
//
// Every question is asked twice over: `you` is what the person the round is about reads ("What is your favourite
// fruit?") and `about` is what everybody else reads, with `{name}` standing for that person ("What is Ann's favourite
// fruit?").  The server fills the name in, because a question is content and not a message.
//
// `pool` names a list in POOLS of answers that would not look out of place for that question.  Only the computer
// players read it: a person writes whatever they like.  Pools are shared between questions, so a few dozen lists cover
// two hundred questions, and no question needs its own answers written out.
//
// Nothing here has any opinion about politics or religion, and nothing asks for anything a person would not happily
// say out loud at a table of friends.
// Depends on: nothing.

/**
 * One question.
 * @param {string} id  a name unique in this list; saved with a room, so do not rename one casually
 * @param {string} pool  the key in POOLS the computer players write their answers from
 * @param {string} you  the question as the person it is about reads it
 * @param {string} about  the question as everybody else reads it, with `{name}` where their name goes
 * @returns {{ id: string, pool: string, you: string, about: string }}
 * Side effects: none.
 */
const q = (id, pool, you, about) => ({ id, pool, you, about });

/**
 * The answers computer players choose between, by pool.  They are plausible rather than true: a computer player has no
 * childhood and no favourite biscuit, and the game only needs its answers to sit believably beside everybody else's.
 */
export const POOLS = {
  animal: ['An otter', 'An elephant', 'A red panda', 'A penguin', 'A horse', 'A fox', 'An owl', 'A dolphin', 'A hedgehog', 'A tiger', 'A sloth', 'An octopus', 'A badger', 'A giraffe'],
  pet: ['A cat', 'A dog', 'A rabbit', 'A hamster', 'A goldfish', 'A budgie', 'A tortoise', 'A guinea pig', 'A grass snake', 'A pony', 'A parrot', 'A ferret', 'A cockatiel', 'A gecko'],
  fruit: ['Apples', 'Bananas', 'Mango', 'Strawberries', 'Raspberries', 'Pineapple', 'Pears', 'Satsumas', 'Grapes', 'Plums', 'Cherries', 'Melon', 'Peaches', 'Blackberries'],
  veg: ['Carrots', 'Broccoli', 'Peas', 'Sprouts', 'Sweetcorn', 'Cauliflower', 'Spinach', 'Mushrooms', 'Beetroot', 'Parsnips', 'Asparagus', 'Courgettes', 'Leeks', 'Cabbage'],
  dish: ['A roast dinner', 'Fish and chips', 'Lasagne', "Shepherd's pie", 'A curry', 'Pizza', 'Chilli', 'Spaghetti bolognese', 'A full English', 'Ramen', 'Toad in the hole', 'Paella', 'Stew and dumplings', 'A jacket potato'],
  pudding: ['Sticky toffee pudding', 'Apple crumble', 'Trifle', 'Cheesecake', 'Treacle tart', 'Rice pudding', 'Bread and butter pudding', 'Eton mess', 'Banoffee pie', 'Ice cream', 'Jam roly-poly', 'Lemon tart', 'Profiteroles', 'Spotted dick'],
  drink: ['Tea', 'Coffee', 'Hot chocolate', 'Lemonade', 'Orange juice', 'Ginger beer', 'Water', 'A milkshake', 'Apple juice', 'Blackcurrant squash', 'Cola', 'Elderflower cordial', 'Iced tea', 'A smoothie'],
  snack: ['Crisps', 'Chocolate digestives', 'Popcorn', 'A flapjack', 'Cheese on toast', 'Peanuts', 'A banana', 'Toast and jam', 'A scotch egg', 'A pork pie', 'Hummus and carrots', 'Malt loaf', 'Crumpets', 'A bacon sandwich'],
  biscuit: ['A custard cream', 'A bourbon', 'A Jammie Dodger', 'A digestive', 'A hobnob', 'A rich tea', 'A ginger nut', 'A party ring', 'A garibaldi', 'Shortbread', 'A chocolate finger', 'A Nice biscuit', 'A fig roll', 'A malted milk'],
  colour: ['Blue', 'Green', 'Red', 'Yellow', 'Purple', 'Orange', 'Pink', 'Turquoise', 'Black', 'White', 'Grey', 'Burgundy', 'Lime green', 'Navy'],
  number: ['3', '7', '11', '13', '21', '42', '8', '100', '5', '17', '9', '2', '99', '64'],
  country: ['Italy', 'Japan', 'Iceland', 'New Zealand', 'Canada', 'Spain', 'Norway', 'Greece', 'Portugal', 'Scotland', 'Wales', 'Ireland', 'Peru', 'Morocco'],
  city: ['Edinburgh', 'York', 'Bath', 'Lisbon', 'Kyoto', 'Berlin', 'Venice', 'Prague', 'Amsterdam', 'Dublin', 'Cardiff', 'Bristol', 'Seville', 'Copenhagen'],
  holiday: ['The seaside', 'A caravan park', 'A city break', 'A cottage in the hills', 'A campsite', 'A cruise', 'A ski resort', 'A holiday camp', 'A beach in Spain', 'A farm stay', 'A canal boat', 'A youth hostel', 'A tent in a field', "A friend's sofa"],
  room: ['The kitchen', 'The living room', 'My bedroom', 'The garden', 'The loft', 'The shed', 'The bathroom', 'The hallway', 'The spare room', 'The conservatory', 'The garage', 'The utility room', 'The cellar', 'The porch'],
  subject: ['Maths', 'English', 'History', 'Geography', 'Art', 'Music', 'PE', 'Science', 'Design and technology', 'Drama', 'French', 'Chemistry', 'Biology', 'Woodwork'],
  job: ['A vet', 'An astronaut', 'A firefighter', 'A teacher', 'A train driver', 'A chef', 'A pop star', 'A footballer', 'A doctor', 'An archaeologist', 'A pilot', 'A zookeeper', 'A spy', 'A lighthouse keeper'],
  hobby: ['Baking', 'Gardening', 'Knitting', 'Birdwatching', 'Painting', 'Cycling', 'Reading', 'Photography', 'Running', 'Board games', 'Fishing', 'Model railways', 'Pottery', 'Climbing'],
  sport: ['Football', 'Cricket', 'Swimming', 'Tennis', 'Rugby', 'Badminton', 'Netball', 'Running', 'Cycling', 'Snooker', 'Hockey', 'Darts', 'Rounders', 'Table tennis'],
  game: ['Monopoly', 'Scrabble', 'Cluedo', 'Chess', 'Uno', 'Trivial Pursuit', 'Snakes and ladders', 'Draughts', 'Jenga', 'Articulate', 'Dominoes', 'Risk', 'Pictionary', 'Rummy'],
  instrument: ['The piano', 'The guitar', 'The violin', 'The recorder', 'The drums', 'The flute', 'The trumpet', 'The cello', 'The clarinet', 'The harp', 'The ukulele', 'The saxophone', 'The banjo', 'The accordion'],
  book: ['Treasure Island', 'The Hobbit', 'Jane Eyre', 'Watership Down', 'Matilda', 'Dracula', 'Little Women', 'The Secret Garden', 'Rebecca', 'Wuthering Heights', 'Northern Lights', 'Frankenstein', 'Of Mice and Men', 'The Wind in the Willows'],
  film: ['Jaws', 'The Princess Bride', 'Jurassic Park', 'Casablanca', 'Alien', 'Back to the Future', 'Paddington', 'Die Hard', 'The Italian Job', 'Gladiator', 'Up', 'Amélie', 'Ghostbusters', "Singin' in the Rain"],
  song: ['Bohemian Rhapsody', 'Yesterday', 'Dancing Queen', 'Wonderwall', 'Hallelujah', 'Mr Brightside', 'Common People', "Don't Stop Me Now", 'Valerie', 'Africa', 'Hey Jude', 'Rolling in the Deep', 'Perfect Day', 'Nine to Five'],
  telly: ['Only Fools and Horses', 'Bake Off', 'Doctor Who', 'Blackadder', "Gardeners' World", 'Strictly', 'Poirot', 'The Chase', 'Top Gear', 'Friends', 'Pointless', "Dad's Army", 'Casualty', 'Line of Duty'],
  weather: ['Thunderstorms', 'Fresh snow', 'A crisp autumn day', 'Drizzle', 'Blazing sunshine', 'Fog', 'A windy beach day', 'Rain on the window', 'Frost', 'A warm evening', 'Hail', 'A mild cloudy day', 'Sea mist', 'A proper downpour'],
  smell: ['Fresh bread', 'Cut grass', 'Rain on hot pavement', 'Bonfire smoke', 'Coffee', 'Vanilla', 'The sea', 'Pine trees', 'Petrol', 'Old books', 'Lavender', 'A chip shop', 'Clean washing', 'A damp forest'],
  sound: ['Rain on a tent', 'A kettle boiling', 'Birdsong', 'Waves', 'A crackling fire', 'Church bells', 'A train going past', 'Pages turning', 'A cat purring', 'Wind in the trees', 'Distant thunder', 'A pencil on paper', 'Footsteps in snow', 'A ticking clock'],
  clothes: ['A big jumper', 'Jeans', 'Pyjamas', 'Walking boots', 'A denim jacket', 'Wellies', 'A scarf', 'Trainers', 'A flat cap', 'Dungarees', 'A woolly hat', 'A raincoat', 'Slippers', 'A stripy top'],
  transport: ['The train', 'A bicycle', 'Walking', 'The bus', 'A car', 'A boat', 'A tram', 'A motorbike', 'The Tube', 'A horse', 'A canoe', 'A scooter', 'A tractor', 'A hot air balloon'],
  chore: ['Washing up', 'Hoovering', 'Ironing', 'Taking the bins out', 'Cleaning the oven', 'Weeding', 'Dusting', 'Mopping', 'Folding the washing', 'Cleaning the windows', 'Scrubbing the bath', 'Mowing the lawn', 'Changing the beds', 'Sorting the recycling'],
  time: ['First thing in the morning', 'Mid-morning', 'Lunchtime', 'Mid-afternoon', 'Teatime', 'Just after dark', 'Late at night', 'Dawn', 'Dusk', 'Three in the morning', 'Sunday morning', 'Friday evening', 'Saturday lunchtime', 'The small hours'],
  age: ['Six', 'Eight', 'Eleven', 'Fourteen', 'Seventeen', 'Twenty-one', 'Nine', 'Twelve', 'Four', 'Sixteen', 'Nineteen', 'Twenty-five', 'Seven', 'Thirty'],
  name: ['Sam', 'Alex', 'Charlie', 'Jo', 'Robin', 'Frankie', 'Nicky', 'Jamie', 'Toni', 'Pat', 'Billie', 'Dani', 'Mo', 'Kit'],
  howlong: ['Five minutes', 'Half an hour', 'Two hours', 'All afternoon', 'Ten minutes', 'A whole day', 'Twenty minutes', 'Three days', 'A week', 'An hour and a half', 'Forty seconds', 'Most of a morning', 'A fortnight', 'A long weekend'],
  thing: ['A torch', 'A penknife', 'A notebook', 'An old photograph', 'A spare charger', 'A tin of beans', 'A woolly blanket', 'A pack of cards', 'Binoculars', 'A thermos', 'A compass', 'A paperback', 'A harmonica', 'A ball of string'],
  saying: ['"I will do it tomorrow"', '"It was like that when I got here"', '"I am on my way"', '"Five more minutes"', '"I know a shortcut"', '"It will be fine"', '"I have nearly finished"', '"I was just about to"', '"I will start on Monday"', '"That is not how I remember it"', '"I am listening"', '"I did not touch it"', '"Nearly there"', '"One more go"'],
  shop: ['The bakery', 'A bookshop', 'The garden centre', 'A hardware shop', 'The market', 'A charity shop', 'The corner shop', 'A record shop', 'The chemist', 'A sweet shop', 'The butcher', 'A stationery shop', 'The fishmonger', 'A camping shop'],
  bodge: ['Gaffer tape', 'A bit of string', 'A rubber band', 'Blu Tack', 'A paperclip', 'Superglue', 'A cable tie', 'A folded beer mat', 'A drawing pin', 'A bulldog clip', 'A wooden spoon', 'A tea towel', 'A safety pin', 'A brick'],
  feeling: ['Proud', 'Nervous', 'Relieved', 'Smug', 'Embarrassed', 'Exhausted', 'Delighted', 'Baffled', 'Calm', 'Hungry', 'Homesick', 'Giddy', 'Suspicious', 'Content'],
  // A "who" answer is deliberately open: the people at the table are only some of the answers anybody might give.
  who: ['Me, obviously', 'The host', 'Probably me', 'Nobody here', 'My neighbour', 'My best friend', 'My brother', 'My sister', 'The quiet one', 'Whoever is winning', 'The person on my left', 'My old boss', 'My flatmate', 'Anyone but me'],
  celeb: ['David Attenborough', 'Mary Berry', 'Keanu Reeves', 'Dolly Parton', 'Brian Cox', 'Judi Dench', 'Idris Elba', 'Tom Hanks', 'Nigella Lawson', 'Stephen Fry', 'Sandra Bullock', 'Gordon Ramsay', 'Michelle Yeoh', 'Hugh Grant'],
  sillyname: ['Fluffy Chesterfield', 'Rusty Oakwood', 'Misty Bellevue', 'Tiger Hollyhock', 'Bubbles Kingsway', 'Captain Marmalade', 'Duchess Barnaby', 'Smokey Larchfield', 'Biscuit Granville', 'Pepper Thistlewood', 'Bandit Fairview', 'Nutmeg Castleford', 'Shadow Pemberton', 'Waffles Underhill'],
  alien: ['Put the kettle on', 'Scream and run', 'Offer them a biscuit', 'Hide behind the sofa', 'Take a photograph', 'Ring the council', 'Pretend to be out', 'Ask for a lift', 'Try to sell them something', 'Point them at the neighbours', 'Start filming it all', 'Negotiate on behalf of Earth', 'Faint', 'Ask about their journey'],
  spy: ['A false moustache', 'An exploding pen', 'A car that swims', 'A briefcase of cash', 'A grappling hook', 'A very ordinary coat', 'An earpiece', 'A second passport', 'A watch with a laser', 'A dog that fetches secrets', 'A spare identity', 'Night vision goggles', 'A thoroughly dull disguise', 'A camera in a button'],
  superpower: ['Flying', 'Invisibility', 'Reading minds', 'Stopping time', 'Teleporting', 'Super strength', 'Talking to animals', 'Never needing sleep', 'Always finding a parking space', 'Instant tidying', 'A perfect memory', 'Breathing underwater', 'Shape-shifting', 'Making anybody laugh'],
  crime: ['Jaywalking', 'Taking the last biscuit', 'A very large bank job', 'Stealing a traffic cone', 'Never returning a library book', 'Pinching hotel towels', 'Riding without a ticket', 'An art heist', 'Parking on a double yellow', 'Nicking chips off a plate', 'Smuggling cheese', 'Speeding', 'Borrowing a pen for ever', 'Creative accounting'],
  monster: ['A dragon', 'A werewolf', 'A vampire', 'A kraken', 'A unicorn', 'A yeti', 'The Loch Ness monster', 'A phoenix', 'A giant spider', 'A mermaid', 'A troll under a bridge', 'A very polite ghost', 'A gremlin', 'A griffin'],
  plan: ['Build an enormous raft', 'Write SOS in the sand', 'Set fire to something', 'Train the seagulls', 'Wait and see', 'Dig a very long tunnel', 'Make friends with the locals', 'Light a signal fire', 'Take over the island', 'Send a message in a bottle', 'Learn to sail', 'Blame somebody else', 'Have a nap first', 'Make a plan tomorrow'],
};

export const QUESTIONS = [
  // ---- food and drink ----
  q('fav-fruit', 'fruit', 'What is your favourite fruit?', 'What is {name}’s favourite fruit?'),
  q('worst-veg', 'veg', 'Which vegetable can you not stand?', 'Which vegetable can {name} not stand?'),
  q('fav-veg', 'veg', 'Which vegetable would you happily eat every day?', 'Which vegetable would {name} happily eat every day?'),
  q('last-meal', 'dish', 'If you could only eat one meal again, what would it be?', 'If {name} could only eat one meal again, what would it be?'),
  q('sunday-dinner', 'dish', 'What do you cook when you want to impress somebody?', 'What does {name} cook when they want to impress somebody?'),
  q('lazy-dinner', 'dish', 'What do you eat when you cannot be bothered to cook?', 'What does {name} eat when they cannot be bothered to cook?'),
  q('fav-pudding', 'pudding', 'What is your favourite pudding?', 'What is {name}’s favourite pudding?'),
  q('fav-biscuit', 'biscuit', 'Which biscuit do you take with a cup of tea?', 'Which biscuit does {name} take with a cup of tea?'),
  q('fav-drink', 'drink', 'What do you drink first thing in the morning?', 'What does {name} drink first thing in the morning?'),
  q('late-snack', 'snack', 'What do you raid the kitchen for at eleven at night?', 'What does {name} raid the kitchen for at eleven at night?'),
  q('never-again-food', 'dish', 'Which food have you sworn never to eat again?', 'Which food has {name} sworn never to eat again?'),
  q('childhood-tea', 'dish', 'What did you eat for tea most often as a child?', 'What did {name} eat for tea most often as a child?'),
  q('odd-combination', 'snack', 'What odd food combination do you secretly enjoy?', 'What odd food combination does {name} secretly enjoy?'),
  q('takeaway', 'dish', 'What is your usual takeaway order?', 'What is {name}’s usual takeaway order?'),
  q('birthday-cake', 'pudding', 'What do you want on your birthday instead of cake?', 'What does {name} want on their birthday instead of cake?'),
  q('picnic-item', 'snack', 'What must be in the basket for a picnic to count?', 'What must be in the basket for {name} to call it a picnic?'),
  q('first-cooked', 'dish', 'What was the first thing you ever cooked by yourself?', 'What was the first thing {name} ever cooked by themselves?'),
  q('crisp-flavour', 'snack', 'Which snack do you always buy at a service station?', 'Which snack does {name} always buy at a service station?'),
  q('fav-sandwich', 'snack', 'What goes in your perfect sandwich?', 'What goes in {name}’s perfect sandwich?'),
  q('seconds-of', 'dish', 'Which dish do you always go back for seconds of?', 'Which dish does {name} always go back for seconds of?'),
  q('cup-of-tea', 'drink', 'What do you make for somebody who has had bad news?', 'What does {name} make for somebody who has had bad news?'),
  q('fridge-staple', 'snack', 'What is always in your fridge?', 'What is always in {name}’s fridge?'),

  // ---- animals ----
  q('fav-animal', 'animal', 'What is your favourite animal?', 'What is {name}’s favourite animal?'),
  q('first-pet', 'pet', 'What was your first pet?', 'What was {name}’s first pet?'),
  q('dream-pet', 'pet', 'What pet would you get if nobody stopped you?', 'What pet would {name} get if nobody stopped them?'),
  q('scared-animal', 'animal', 'Which animal gives you the creeps?', 'Which animal gives {name} the creeps?'),
  q('animal-you-are', 'animal', 'Which animal are you most like before coffee?', 'Which animal is {name} most like before coffee?'),
  q('zoo-first', 'animal', 'Which animal do you go to see first at a zoo?', 'Which animal does {name} go to see first at a zoo?'),
  q('pet-name', 'name', 'What would you call a pet goldfish?', 'What would {name} call a pet goldfish?'),
  q('animal-day', 'animal', 'Which animal would you be for a day?', 'Which animal would {name} be for a day?'),
  q('bird-garden', 'animal', 'Which creature in your garden do you like seeing?', 'Which creature in their garden does {name} like seeing?'),
  q('worst-chore-pet', 'pet', 'Which pet would be too much work for you?', 'Which pet would be too much work for {name}?'),

  // ---- travel and places ----
  q('dream-country', 'country', 'Which country do you most want to visit?', 'Which country does {name} most want to visit?'),
  q('been-twice', 'country', 'Which country would you happily go back to tomorrow?', 'Which country would {name} happily go back to tomorrow?'),
  q('fav-city', 'city', 'What is your favourite city?', 'What is {name}’s favourite city?'),
  q('best-holiday', 'holiday', 'What was your best holiday ever?', 'What was {name}’s best holiday ever?'),
  q('worst-holiday', 'holiday', 'What was your worst holiday ever?', 'What was {name}’s worst holiday ever?'),
  q('holiday-style', 'holiday', 'What is your idea of a perfect week off?', 'What is {name}’s idea of a perfect week off?'),
  q('childhood-holiday', 'holiday', 'Where did your family go on holiday when you were small?', 'Where did {name}’s family go on holiday when they were small?'),
  q('never-go', 'country', 'Where would you never want to go?', 'Where would {name} never want to go?'),
  q('live-abroad', 'country', 'Where would you move if you had to leave tomorrow?', 'Where would {name} move if they had to leave tomorrow?'),
  q('travel-way', 'transport', 'What is your favourite way to travel?', 'What is {name}’s favourite way to travel?'),
  q('travel-hate', 'transport', 'What way of travelling do you dread?', 'What way of travelling does {name} dread?'),
  q('always-packs', 'thing', 'What do you always pack that nobody else bothers with?', 'What does {name} always pack that nobody else bothers with?'),
  q('forgot-packing', 'thing', 'What do you always forget to pack?', 'What does {name} always forget to pack?'),
  q('day-trip', 'city', 'Where would you take a visitor for the day?', 'Where would {name} take a visitor for the day?'),
  q('getting-lost', 'city', 'Where were you when you were most hopelessly lost?', 'Where was {name} when they were most hopelessly lost?'),
  q('souvenir', 'thing', 'What sort of souvenir do you always bring home?', 'What sort of souvenir does {name} always bring home?'),

  // ---- home and the everyday ----
  q('fav-room', 'room', 'Which room in your home is your favourite?', 'Which room in their home is {name}’s favourite?'),
  q('messiest-room', 'room', 'Which part of your home is the untidiest?', 'Which part of {name}’s home is the untidiest?'),
  q('worst-chore', 'chore', 'Which household chore do you hate most?', 'Which household chore does {name} hate most?'),
  q('best-chore', 'chore', 'Which household chore do you secretly enjoy?', 'Which household chore does {name} secretly enjoy?'),
  q('always-putting-off', 'chore', 'What job around the house have you been putting off?', 'What job around the house has {name} been putting off?'),
  q('fix-anything', 'bodge', 'What do you reach for when something needs mending?', 'What does {name} reach for when something needs mending?'),
  q('drawer-of-doom', 'thing', 'What is in your junk drawer that should not be?', 'What is in {name}’s junk drawer that should not be?'),
  q('never-throw-away', 'thing', 'What can you never bring yourself to throw away?', 'What can {name} never bring themselves to throw away?'),
  q('lost-often', 'thing', 'What do you lose most often around the house?', 'What does {name} lose most often around the house?'),
  q('first-thing-morning', 'chore', 'What is the first thing you do when you get up?', 'What is the first thing {name} does when they get up?'),
  q('best-time-of-day', 'time', 'What is your favourite time of day?', 'What is {name}’s favourite time of day?'),
  q('worst-time-of-day', 'time', 'What time of day do you least enjoy?', 'What time of day does {name} least enjoy?'),
  q('weekend-morning', 'chore', 'How do you spend a free Saturday morning?', 'How does {name} spend a free Saturday morning?'),
  q('shop-happy', 'shop', 'Which shop could you wander round for an hour?', 'Which shop could {name} wander round for an hour?'),
  q('splurge', 'thing', 'What do you spend too much money on?', 'What does {name} spend too much money on?'),
  q('tidy-trigger', 'chore', 'What makes you suddenly start tidying?', 'What makes {name} suddenly start tidying?'),

  // ---- childhood and memories ----
  q('childhood-ambition', 'job', 'What did you want to be when you grew up?', 'What did {name} want to be when they grew up?'),
  q('best-age', 'age', 'What was the best age you have been so far?', 'What was the best age {name} has been so far?'),
  q('first-memory', 'room', 'Where is your earliest memory set?', 'Where is {name}’s earliest memory set?'),
  q('childhood-toy', 'thing', 'What toy did you refuse to go anywhere without?', 'What toy did {name} refuse to go anywhere without?'),
  q('school-subject', 'subject', 'Which school subject did you love?', 'Which school subject did {name} love?'),
  q('worst-subject', 'subject', 'Which school subject were you hopeless at?', 'Which school subject was {name} hopeless at?'),
  q('school-trouble', 'saying', 'What did you say most often when you were in trouble at school?', 'What did {name} say most often when they were in trouble at school?'),
  q('first-record', 'song', 'What was the first song you knew every word of?', 'What was the first song {name} knew every word of?'),
  q('instrument-learned', 'instrument', 'Which instrument did you learn, or try to?', 'Which instrument did {name} learn, or try to?'),
  q('childhood-hero', 'job', 'Whose job did you think was the most exciting as a child?', 'Whose job did {name} think was the most exciting as a child?'),
  q('school-dinner', 'dish', 'What was the school dinner you actually looked forward to?', 'What was the school dinner {name} actually looked forward to?'),
  q('summer-holidays', 'hobby', 'What did you do all summer as a child?', 'What did {name} do all summer as a child?'),
  q('childhood-fear', 'animal', 'What were you frightened of as a child?', 'What was {name} frightened of as a child?'),
  q('proudest-young', 'sport', 'What did you win, or nearly win, at school?', 'What did {name} win, or nearly win, at school?'),
  q('nickname-era', 'name', 'What did people call you at school?', 'What did people call {name} at school?'),
  q('first-job', 'job', 'What was your first ever job?', 'What was {name}’s first ever job?'),
  q('saved-up-for', 'thing', 'What was the first thing you saved up for?', 'What was the first thing {name} saved up for?'),
  q('teenage-bedroom', 'colour', 'What colour were your bedroom walls as a teenager?', 'What colour were {name}’s bedroom walls as a teenager?'),

  // ---- work and study ----
  q('dream-job', 'job', 'What job would you do if money were no object?', 'What job would {name} do if money were no object?'),
  q('job-never', 'job', 'Which job could you never do?', 'Which job could {name} never do?'),
  q('best-workmate', 'job', 'What sort of person makes the best colleague for you?', 'What sort of person makes the best colleague for {name}?'),
  q('work-snack', 'snack', 'What gets you through a long afternoon at work?', 'What gets {name} through a long afternoon at work?'),
  q('work-excuse', 'saying', 'What do you say when you are running late?', 'What does {name} say when they are running late?'),
  q('meeting-doodle', 'thing', 'What do you fiddle with in a long meeting?', 'What does {name} fiddle with in a long meeting?'),
  q('learn-next', 'hobby', 'What would you learn if you had a free year?', 'What would {name} learn if they had a free year?'),
  q('good-at-surprising', 'hobby', 'What are you better at than people expect?', 'What is {name} better at than people expect?'),
  q('worst-at', 'hobby', 'What are you genuinely terrible at?', 'What is {name} genuinely terrible at?'),
  q('commute', 'transport', 'How would you most like to get to work?', 'How would {name} most like to get to work?'),
  q('desk-item', 'thing', 'What is always on your desk?', 'What is always on {name}’s desk?'),
  q('procrastinate', 'chore', 'What do you do instead of the thing you should be doing?', 'What does {name} do instead of the thing they should be doing?'),

  // ---- hobbies, sport and games ----
  q('fav-hobby', 'hobby', 'What do you do to relax?', 'What does {name} do to relax?'),
  q('hobby-abandoned', 'hobby', 'Which hobby did you take up and then abandon?', 'Which hobby did {name} take up and then abandon?'),
  q('sport-watch', 'sport', 'Which sport do you most enjoy watching?', 'Which sport does {name} most enjoy watching?'),
  q('sport-play', 'sport', 'Which sport are you best at?', 'Which sport is {name} best at?'),
  q('sport-hopeless', 'sport', 'Which sport are you hopeless at?', 'Which sport is {name} hopeless at?'),
  q('board-game', 'game', 'Which game do you always want to play?', 'Which game does {name} always want to play?'),
  q('game-refuse', 'game', 'Which game causes arguments in your house?', 'Which game causes arguments in {name}’s house?'),
  q('competitive-about', 'game', 'What are you unreasonably competitive about?', 'What is {name} unreasonably competitive about?'),
  q('rainy-sunday', 'hobby', 'What do you do on a wet Sunday afternoon?', 'What does {name} do on a wet Sunday afternoon?'),
  q('hobby-would-try', 'hobby', 'Which hobby would you try if you were braver?', 'Which hobby would {name} try if they were braver?'),
  q('collection', 'thing', 'What do you collect, whether you mean to or not?', 'What does {name} collect, whether they mean to or not?'),
  q('outdoors-indoors', 'weather', 'What weather gets you outdoors?', 'What weather gets {name} outdoors?'),

  // ---- books, films, music and telly ----
  q('fav-book', 'book', 'What book would you press into a friend’s hands?', 'What book would {name} press into a friend’s hands?'),
  q('book-reread', 'book', 'Which book have you read more than once?', 'Which book has {name} read more than once?'),
  q('book-never-finished', 'book', 'Which famous book did you never finish?', 'Which famous book did {name} never finish?'),
  q('fav-film', 'film', 'What is your favourite film?', 'What is {name}’s favourite film?'),
  q('film-cry', 'film', 'Which film makes you well up every time?', 'Which film makes {name} well up every time?'),
  q('film-quote', 'film', 'Which film can you quote far too much of?', 'Which film can {name} quote far too much of?'),
  q('comfort-telly', 'telly', 'What do you put on when you are poorly?', 'What does {name} put on when they are poorly?'),
  q('telly-guilty', 'telly', 'What do you watch that you would not admit to?', 'What does {name} watch that they would not admit to?'),
  q('song-loud', 'song', 'Which song do you sing far too loudly in the car?', 'Which song does {name} sing far too loudly in the car?'),
  q('song-dance', 'song', 'Which song gets you onto a dance floor?', 'Which song gets {name} onto a dance floor?'),
  q('karaoke', 'song', 'What is your karaoke song?', 'What is {name}’s karaoke song?'),
  q('song-stuck', 'song', 'Which song gets stuck in your head?', 'Which song gets stuck in {name}’s head?'),
  q('desert-island-disc', 'song', 'Which one song would you take to a desert island?', 'Which one song would {name} take to a desert island?'),
  q('book-film', 'book', 'Which book should never have been made into a film?', 'Which book does {name} think should never have been made into a film?'),

  // ---- likes, dislikes and small opinions ----
  q('fav-colour', 'colour', 'What is your favourite colour?', 'What is {name}’s favourite colour?'),
  q('colour-never-wear', 'colour', 'Which colour do you never wear?', 'Which colour does {name} never wear?'),
  q('lucky-number', 'number', 'What is your lucky number?', 'What is {name}’s lucky number?'),
  q('fav-weather', 'weather', 'What is your favourite kind of weather?', 'What is {name}’s favourite kind of weather?'),
  q('worst-weather', 'weather', 'What weather ruins your day?', 'What weather ruins {name}’s day?'),
  q('fav-smell', 'smell', 'What is your favourite smell?', 'What is {name}’s favourite smell?'),
  q('worst-smell', 'smell', 'What smell cannot you bear?', 'What smell can {name} not bear?'),
  q('fav-sound', 'sound', 'What is the nicest sound in the world?', 'What does {name} think is the nicest sound in the world?'),
  q('worst-sound', 'sound', 'What sound sets your teeth on edge?', 'What sound sets {name}’s teeth on edge?'),
  q('comfy-clothes', 'clothes', 'What do you put on the moment you get home?', 'What does {name} put on the moment they get home?'),
  q('clothes-keep', 'clothes', 'What item of clothing should you have thrown out years ago?', 'What item of clothing should {name} have thrown out years ago?'),
  q('pet-hate', 'sound', 'What small thing annoys you far more than it should?', 'What small thing annoys {name} far more than it should?'),
  q('overrated', 'dish', 'What do you think is wildly overrated?', 'What does {name} think is wildly overrated?'),
  q('underrated', 'dish', 'What do you think deserves far more praise?', 'What does {name} think deserves far more praise?'),
  q('season', 'weather', 'Which time of year suits you best?', 'Which time of year suits {name} best?'),
  q('always-late-for', 'chore', 'What are you always late for?', 'What is {name} always late for?'),

  // ---- family and friends ----
  q('family-saying', 'saying', 'What does somebody in your family always say?', 'What does somebody in {name}’s family always say?'),
  q('family-recipe', 'dish', 'What does your family cook for a celebration?', 'What does {name}’s family cook for a celebration?'),
  q('family-tradition', 'hobby', 'What does your family always do at Christmas?', 'What does {name}’s family always do at Christmas?'),
  q('family-argument', 'game', 'What does your family argue about most?', 'What does {name}’s family argue about most?'),
  q('family-pet-name', 'name', 'What was the family pet called?', 'What was {name}’s family pet called?'),
  q('learned-from', 'hobby', 'What did a grandparent teach you?', 'What did a grandparent teach {name}?'),
  q('advice-given', 'saying', 'What advice do you give far too often?', 'What advice does {name} give far too often?'),
  q('friend-first-met', 'shop', 'Where did you meet your oldest friend?', 'Where did {name} meet their oldest friend?'),
  q('who-to-ring', 'feeling', 'How do you feel when the phone rings unexpectedly?', 'How does {name} feel when the phone rings unexpectedly?'),
  q('family-nickname', 'name', 'What does your family call you?', 'What does {name}’s family call them?'),
  q('inherited-thing', 'thing', 'What have you got that belonged to a relative?', 'What has {name} got that belonged to a relative?'),
  q('family-game', 'game', 'What game comes out when the family is all together?', 'What game comes out when {name}’s family is all together?'),

  // ---- experiences and stories ----
  q('proudest-moment', 'sport', 'What are you proudest of having done?', 'What is {name} proudest of having done?'),
  q('bravest-thing', 'hobby', 'What is the bravest thing you have done?', 'What is the bravest thing {name} has done?'),
  q('best-surprise', 'thing', 'What is the best surprise anybody has given you?', 'What is the best surprise anybody has given {name}?'),
  q('worst-queue', 'howlong', 'What is the longest you have ever queued for anything?', 'What is the longest {name} has ever queued for anything?'),
  q('longest-walk', 'howlong', 'How long was the longest walk you have done in one go?', 'How long was the longest walk {name} has done in one go?'),
  q('met-famous', 'job', 'Which sort of famous person have you stood next to?', 'Which sort of famous person has {name} stood next to?'),
  q('broke-something', 'thing', 'What is the most expensive thing you have broken?', 'What is the most expensive thing {name} has broken?'),
  q('got-away-with', 'saying', 'What did you once get away with?', 'What did {name} once get away with?'),
  q('worst-journey', 'transport', 'How did your worst-ever journey go wrong?', 'How did {name}’s worst-ever journey go wrong?'),
  q('stuck-somewhere', 'room', 'Where have you been stuck for hours?', 'Where has {name} been stuck for hours?'),
  q('learned-hard-way', 'chore', 'What did you learn the hard way?', 'What did {name} learn the hard way?'),
  q('unlikely-skill', 'hobby', 'What can you do that would surprise everybody here?', 'What can {name} do that would surprise everybody here?'),
  q('best-present-given', 'thing', 'What is the best present you have ever given?', 'What is the best present {name} has ever given?'),
  q('worst-present', 'thing', 'What is the worst present you have ever been given?', 'What is the worst present {name} has ever been given?'),
  q('time-lost-track', 'hobby', 'What makes you lose all track of time?', 'What makes {name} lose all track of time?'),
  q('scariest-moment', 'feeling', 'How did you feel the last time something went badly wrong?', 'How did {name} feel the last time something went badly wrong?'),

  // ---- habits and oddities ----
  q('secret-talent', 'hobby', 'What is your useless talent?', 'What is {name}’s useless talent?'),
  q('always-say', 'saying', 'What do you say far too often?', 'What does {name} say far too often?'),
  q('superstition', 'number', 'Which number do you avoid?', 'Which number does {name} avoid?'),
  q('first-cup', 'drink', 'What do you order in a café without looking at the menu?', 'What does {name} order in a café without looking at the menu?'),
  q('pockets', 'thing', 'What is in your pocket right now?', 'What is in {name}’s pocket right now?'),
  q('phone-background', 'animal', 'What is on the back of your phone case?', 'What is on the back of {name}’s phone case?'),
  q('bedside-table', 'thing', 'What is on your bedside table?', 'What is on {name}’s bedside table?'),
  q('odd-habit', 'chore', 'What do you do that other people find strange?', 'What does {name} do that other people find strange?'),
  q('snooze-button', 'howlong', 'How long do you lie in bed after the alarm goes off?', 'How long does {name} lie in bed after the alarm goes off?'),
  q('queue-behaviour', 'feeling', 'How do you feel in a slow-moving queue?', 'How does {name} feel in a slow-moving queue?'),
  q('always-carry', 'thing', 'What do you never leave the house without?', 'What does {name} never leave the house without?'),
  q('tea-strength', 'drink', 'What do you make for a guest without asking?', 'What does {name} make for a guest without asking?'),
  q('hum-while', 'chore', 'What are you doing when you catch yourself humming?', 'What is {name} doing when they catch themselves humming?'),
  q('tidy-or-not', 'room', 'Which part of your life is suspiciously well organised?', 'Which part of {name}’s life is suspiciously well organised?'),

  // ---- hypotheticals ----
  q('lottery-first', 'thing', 'What is the first thing you would buy with a lottery win?', 'What is the first thing {name} would buy with a lottery win?'),
  q('time-travel', 'age', 'Which age would you go back to for a day?', 'Which age would {name} go back to for a day?'),
  q('desert-island-item', 'thing', 'What one thing would you take to a desert island?', 'What one thing would {name} take to a desert island?'),
  q('superpower', 'hobby', 'What would you use a superpower for, really?', 'What would {name} use a superpower for, really?'),
  q('last-day', 'dish', 'What would you eat on your last day on earth?', 'What would {name} eat on their last day on earth?'),
  q('swap-lives', 'job', 'Whose job would you swap into for a week?', 'Whose job would {name} swap into for a week?'),
  q('new-name', 'name', 'What name would you pick if you had to change yours?', 'What name would {name} pick if they had to change theirs?'),
  q('open-a-shop', 'shop', 'What sort of shop would you open?', 'What sort of shop would {name} open?'),
  q('one-skill', 'instrument', 'Which instrument would you be able to play overnight?', 'Which instrument would {name} choose to be able to play overnight?'),
  q('live-anywhere', 'room', 'What room would your dream house have that most do not?', 'What room would {name}’s dream house have that most do not?'),
  q('year-off', 'country', 'Where would you spend a whole year off?', 'Where would {name} spend a whole year off?'),
  q('invent-thing', 'thing', 'What would you invent to make life easier?', 'What would {name} invent to make life easier?'),
  q('team-apocalypse', 'job', 'What sort of person would you want on your team in an emergency?', 'What sort of person would {name} want on their team in an emergency?'),
  q('one-rule', 'chore', 'What would you ban if you were in charge for a day?', 'What would {name} ban if they were in charge for a day?'),

  // ---- feelings and self ----
  q('cheers-you-up', 'snack', 'What always cheers you up?', 'What always cheers {name} up?'),
  q('calms-you-down', 'sound', 'What calms you down?', 'What calms {name} down?'),
  q('feeling-mornings', 'feeling', 'How do you usually feel first thing in the morning?', 'How does {name} usually feel first thing in the morning?'),
  q('feeling-crowds', 'feeling', 'How do you feel in a big crowd?', 'How does {name} feel in a big crowd?'),
  q('proud-of-now', 'hobby', 'What are you quietly pleased with yourself about lately?', 'What is {name} quietly pleased with themselves about lately?'),
  q('switch-off', 'hobby', 'What do you do when you need to switch off completely?', 'What does {name} do when they need to switch off completely?'),
  q('motivates', 'feeling', 'What gets you going when you do not want to?', 'What gets {name} going when they do not want to?'),
  q('best-compliment', 'feeling', 'How do you feel when somebody praises your cooking?', 'How does {name} feel when somebody praises their cooking?'),
  q('energy-dip', 'time', 'When in the day do you run out of steam?', 'When in the day does {name} run out of steam?'),
  q('perfect-evening', 'hobby', 'What is your idea of a perfect evening in?', 'What is {name}’s idea of a perfect evening in?'),
  q('would-change', 'chore', 'What would you change about your daily routine?', 'What would {name} change about their daily routine?'),
  q('treat-yourself', 'pudding', 'How do you treat yourself after a hard week?', 'How does {name} treat themselves after a hard week?'),

  // ---- far-fetched, daft, and a little cheeky ----
  q('porn-name', 'sillyname', 'What is your porn star name: your first pet, then the street you grew up on?', 'What is {name}’s porn star name: their first pet, then the street they grew up on?'),
  q('celeb-crush', 'celeb', 'Who is your celebrity crush?', 'Who is {name}’s celebrity crush?'),
  q('celeb-dinner', 'celeb', 'Which famous person would you most like to have dinner with?', 'Which famous person would {name} most like to have dinner with?'),
  q('celeb-annoy', 'celeb', 'Which famous person would drive you up the wall within a week?', 'Which famous person would drive {name} up the wall within a week?'),
  q('alien-first', 'alien', 'Aliens land in your garden. What do you do first?', 'Aliens land in {name}’s garden. What do they do first?'),
  q('alien-gift', 'thing', 'What would you offer the aliens as a present from Earth?', 'What would {name} offer the aliens as a present from Earth?'),
  q('alien-food', 'dish', 'Which Earth food would you make the aliens try first?', 'Which Earth food would {name} make the aliens try first?'),
  q('alien-volunteer', 'who', 'The aliens will take one person back with them. Who do you put forward?', 'The aliens will take one person back with them. Who does {name} put forward?'),
  q('island-luxury', 'thing', 'What one luxury would you take to a desert island?', 'What one luxury would {name} take to a desert island?'),
  q('island-company', 'who', 'Who would you want to be stranded on a desert island with?', 'Who would {name} want to be stranded on a desert island with?'),
  q('island-escape', 'plan', 'How would you get yourself rescued from a desert island?', 'How would {name} get themselves rescued from a desert island?'),
  q('spy-codename', 'sillyname', 'What would your spy codename be?', 'What would {name}’s spy codename be?'),
  q('spy-gadget', 'spy', 'Which spy gadget would you want in your pocket?', 'Which spy gadget would {name} want in their pocket?'),
  q('spy-cover', 'job', 'What would your cover job be as a spy?', 'What would {name}’s cover job be as a spy?'),
  q('apocalypse-job', 'job', 'What would your job be after the end of the world?', 'What would {name}’s job be after the end of the world?'),
  q('zombie-weapon', 'thing', 'What would you grab from the kitchen to fight off a zombie?', 'What would {name} grab from the kitchen to fight off a zombie?'),
  q('zombie-long', 'howlong', 'How long would you last in a zombie apocalypse?', 'How long would {name} last in a zombie apocalypse?'),
  q('monster-bed', 'monster', 'What is under your bed, really?', 'What is under {name}’s bed, really?'),
  q('mythical-be', 'monster', 'Which mythical creature would you be?', 'Which mythical creature would {name} be?'),
  q('haunted-night', 'feeling', 'How would you feel spending a night in a haunted house?', 'How would {name} feel spending a night in a haunted house?'),
  q('ghost-haunt', 'room', 'Which room would you haunt if you came back as a ghost?', 'Which room would {name} haunt if they came back as a ghost?'),
  q('superpower-want', 'superpower', 'Which superpower would you choose?', 'Which superpower would {name} choose?'),
  q('superpower-useless', 'superpower', 'Which superpower would be no use to you whatsoever?', 'Which superpower would be no use to {name} whatsoever?'),
  q('villain-plan', 'plan', 'You are a supervillain. What is the plan?', 'If {name} were a supervillain, what would the plan be?'),
  q('wrestler-name', 'sillyname', 'What would your wrestling name be?', 'What would {name}’s wrestling name be?'),
  q('band-name', 'sillyname', 'What would you call your band?', 'What would {name} call their band?'),
  q('dragon-name', 'sillyname', 'What would you call your pet dragon?', 'What would {name} call their pet dragon?'),
  q('pirate-name', 'sillyname', 'What would your pirate name be?', 'What would {name}’s pirate name be?'),
  q('crime-away', 'crime', 'Which crime could you get away with?', 'Which crime could {name} get away with?'),
  q('crime-jail', 'crime', 'What would land you in jail, if anything ever did?', 'What would land {name} in jail, if anything ever did?'),
  q('prison-known', 'hobby', 'What would you be famous for in prison?', 'What would {name} be famous for in prison?'),
  q('invisible-first', 'plan', 'You wake up invisible. What is the first thing you do?', 'If {name} woke up invisible, what is the first thing they would do?'),
  q('clone-chore', 'chore', 'What would you make your clone do?', 'What would {name} make their clone do?'),
  q('robot-butler', 'chore', 'What would you have a robot do for you every day?', 'What would {name} have a robot do for them every day?'),
  q('heist-role', 'job', 'What is your job on the heist crew?', 'What is {name}’s job on the heist crew?'),
  q('locked-in-shop', 'shop', 'You are locked in one shop overnight. Which one?', 'If {name} were locked in one shop overnight, which would it be?'),
  q('tattoo-tomorrow', 'thing', 'What tattoo would you get if you had to get one tomorrow?', 'What tattoo would {name} get if they had to get one tomorrow?'),
  q('last-words', 'saying', 'What are your famous last words going to be?', 'What are {name}’s famous last words going to be?'),
  q('time-machine-really', 'plan', 'What would you actually do with a time machine?', 'What would {name} actually do with a time machine?'),
  q('mars-ticket', 'who', 'You have one ticket to Mars and you are not using it. Who gets it?', 'If {name} had one ticket to Mars and was not using it, who would get it?'),

  // ---- about other people (the answer need not be anybody at this table) ----
  q('who-spy', 'who', 'Who do you know who would make the best spy?', 'Who does {name} think would make the best spy?'),
  q('who-liar', 'who', 'Who is the best liar you know?', 'Who is the best liar {name} knows?'),
  q('who-zombie', 'who', 'Who would last longest in a zombie apocalypse?', 'Who does {name} think would last longest in a zombie apocalypse?'),
  q('who-secret', 'who', 'Who would you trust with a secret?', 'Who would {name} trust with a secret?'),
  q('who-gossip', 'who', 'Who would tell everybody your secret within a day?', 'Who would tell everybody {name}’s secret within a day?'),
  q('who-late', 'who', 'Who do you know who is always late?', 'Who does {name} know who is always late?'),
  q('who-lottery', 'who', 'Who would get through a lottery win the fastest?', 'Who does {name} think would get through a lottery win the fastest?'),
  q('who-famous', 'who', 'Who is most likely to end up famous?', 'Who does {name} think is most likely to end up famous?'),
  q('who-arrested', 'who', 'Who is most likely to be arrested for something very silly?', 'Who does {name} think is most likely to be arrested for something very silly?'),
  q('who-karaoke', 'who', 'Who would hog the karaoke machine all night?', 'Who does {name} think would hog the karaoke machine all night?'),
  q('who-cooking', 'who', 'Whose cooking would you trust with your life?', 'Whose cooking would {name} trust with their life?'),
  q('who-lost', 'who', 'Who would get lost on the way to the pub?', 'Who does {name} think would get lost on the way to the pub?'),
  q('who-argue', 'who', 'Who would argue with a traffic warden and win?', 'Who does {name} think would argue with a traffic warden and win?'),
  q('who-crisis', 'who', 'Who would be completely useless in a crisis?', 'Who does {name} think would be completely useless in a crisis?'),
  q('who-house', 'who', 'Who would you trust to look after your house for a month?', 'Who would {name} trust to look after their house for a month?'),
  q('who-swap', 'who', 'Whose life would you swap into for a week?', 'Whose life would {name} swap into for a week?'),
  q('who-three-am', 'who', 'Who would you ring at three in the morning, no questions asked?', 'Who would {name} ring at three in the morning, no questions asked?'),
  q('who-holiday', 'who', 'Who would you most like to go on holiday with?', 'Who would {name} most like to go on holiday with?'),
  q('who-advice', 'who', 'Whose advice do you always take?', 'Whose advice does {name} always take?'),
  q('who-laugh', 'who', 'Who makes you laugh most?', 'Who makes {name} laugh most?'),
  q('who-driver', 'who', 'Who is the worst driver you know?', 'Who is the worst driver {name} knows?'),
];

/**
 * A text in the form answers are compared in: lower case, no punctuation, single spaces, a leading "a", "an" or "the"
 * dropped, and a plural "s" taken off the last word.  "The Red Pandas" and "red panda" are the same answer, which is
 * what matters when two people write the same thing by accident.
 * @param {unknown} text  the answer as typed
 * @returns {string} the comparable form (possibly empty)
 * Side effects: none.
 */
export function normal(text) {
  const plain = String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!plain) return '';
  const words = plain.replace(/^(?:a|an|the) /, '').split(' ');
  const last = words[words.length - 1];
  if (last.length > 3 && last.endsWith('s')) words[words.length - 1] = last.slice(0, -1);
  return words.join(' ');
}

/**
 * The answers a computer player may write for a question.
 * @param {{ pool?: string }} question  a question from QUESTIONS
 * @returns {string[]} that question's pool (an empty list for a question whose pool is unknown)
 * Side effects: none.
 */
export const answersFor = (question) => POOLS[question?.pool] ?? [];
