// The Help button's text for every page except a game (a game's own rules.md is shown there). Each is Markdown for
// renderMarkdown. `pageHelp(route)` picks the page by route name.
// Depends on: shared/achievements.js (the coin amounts quoted in the text); read by App.vue.
import { COINS_PER_LEVEL, SINGLE_LEVEL_COINS } from '../shared/achievements.js';

const SHOP_TABS = {
  names: ['Names', 'Styles put a border and a background around your name, and animations move them, wherever other players see it.'],
  backgrounds: ['Backgrounds', 'Pictures go behind the site and the game tables. Animations play over them, and only you see those.'],
  themes: ['Themes', 'Colours change every page on the site and fonts change the writing. Each is chosen separately and only changes how you see the site.'],
  'card-backs': ['Card backs', 'What the face-down cards look like to you in every card game.'],
  avatar: ['Avatar', 'Hair, clothes, hats and more for your avatar, shown in your details pop-up in games. Each part is previewed on you.'],
  unlocks: ['Unlocks', 'Choose your own colour, gradient or picture, any marker colour for games, and set how strong and how fast your background animation is, on the Profile page.'],
};

// One Markdown section per shop tab, built from SHOP_TABS so the tab list and the help cannot drift apart.
const SHOP_SECTIONS = Object.values(SHOP_TABS).map(([label, text]) => `## ${label}\n\n${text}`).join('\n\n');

// Returns the shop page's help Markdown (a function so it is only built when asked for).
const shopHelp = () => `# Shop

Spend the gold you win on ways to make the site your own. You get 100 for coming 1st in a game, 50 for 2nd and 20 for 3rd, and more for unlocking achievements.

Anything you own can be put on straight from here with **Use**. Animations are paused for people who have chosen to pause them in their profile, so those previews stand still.

${SHOP_SECTIONS}`;

// Help Markdown by route name, for the pages whose text is fixed.
const PAGES = {
  games: `# Games

Choose a game to open its table. Each card says how many people can play.

Inside a game, the Help button shows that game's rules.`,
  login: `# Signing in

Sign in with your username and password, or make an account. Your statistics, achievements, gold and look are saved with it.`,
  profile: `# Profile

How the site looks and how other players see you.

- **Name**: the display name other players see.
- **Animations**: whether the moving name borders and backgrounds from the shop play.
- **Background**: the picture behind the site. Games stay on a calm panel, so it never gets in the way of play.
- **Card back**: what the face-down cards look like to you.
- **Marker colour**: your colour in games such as Tints and Hints and Wavelength.
- **Password**: change it here.

Your own colours, gradients, pictures and animation sliders are unlocks in the shop.`,
  stats: `# Statistics

Your results across every game: games played, won and lost, your win rate, and each game's own figures. Under each game is a table of the players with the most wins. Your most recent games are at the bottom.`,
  achievements: `# Achievements

Every game has achievements, and so does the site itself. Most have levels, and each level asks for more than the last. The bar shows how far you are towards the next one.

Unlocking a level earns ${COINS_PER_LEVEL} gold times its level number, so ${COINS_PER_LEVEL} for level 1 and ${COINS_PER_LEVEL * 5} for level 5. An achievement with just one level earns ${SINGLE_LEVEL_COINS}.

Achievements you have not unlocked yet are hidden as ???, so there are surprises.`,
};

/**
 * The help text for a page.
 * @param {{ name: string }} route  the current route (only its name is used)
 * @returns {?{ title: string, markdown: string }}  the dialog title and Markdown, or null when the page has no help
 * Side effects: none.
 */
export function pageHelp(route) {
  const name = route.name;
  if (name === 'shop') return { title: 'Help', markdown: shopHelp() };
  return PAGES[name] ? { title: 'Help', markdown: PAGES[name] } : null;
}
