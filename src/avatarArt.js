// Draws an avatar (see shared/avatar.js) as SVG, layer by layer on a 100 x 100 canvas: backdrop, hair behind, clothes,
// neck, head, hair in front, eyes, mouth, glasses, hat. Every piece is built from our own catalogue (the colours come
// from it and the part ids are checked against it), never from text a player typed, so the markup is safe to inject.
import { avatarOption, normaliseAvatar } from '../shared/avatar.js';

const INK = '#241c1c';
const SHADE = 'rgb(0 0 0 / 0.14)';
const stroke = `stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;

const backdropOf = (option, id) => {
  if (!option.gradient) return `<rect width="100" height="100" fill="${option.colour}"/>`;
  const [from, to] = option.gradient;
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="100" height="100" fill="url(#${id})"/>`;
};

const HAIR_BEHIND = {
  bob: (c) => `<path d="M26 46 C22 12 78 12 74 46 L77 68 Q50 76 23 68 Z" fill="${c}"/>`,
  pigtails: (c) => `<path d="M26 40 L14 52 L19 70 L28 56 Z M74 40 L86 52 L81 70 L72 56 Z" fill="${c}"/><circle cx="15" cy="52" r="6" fill="${c}"/><circle cx="85" cy="52" r="6" fill="${c}"/><path d="M26 44 L22 50 M74 44 L78 50" stroke="#d8719c" stroke-width="3" stroke-linecap="round"/>`,
  long: (c) => `<path d="M26 46 C24 16 76 16 74 46 L79 84 L21 84 Z" fill="${c}"/>`,
  afro: (c) => `<circle cx="50" cy="34" r="31" fill="${c}"/>`,
  scraggly: (c) => `<path d="M25 46 C21 8 79 8 75 46 L82 66 L76 70 L84 84 L73 78 L74 92 L66 80 L62 90 L57 78 L50 88 L44 77 L38 91 L33 79 L26 90 L27 77 L16 84 L24 69 L18 64 Z" fill="${c}"/>`,
  bun: (c) => `<circle cx="50" cy="13" r="10" fill="${c}"/>`,
};

const HAIR_FRONT = {
  bob: (c) => `<path d="M26 56 C22 10 78 10 74 56 L68 56 C68 38 60 30 50 30 C40 30 32 38 32 56 Z" fill="${c}"/>`,
  pigtails: (c) => `<path d="M28 44 C24 4 76 4 72 44 C67 33 59 28 50 28 C41 28 33 33 28 44 Z" fill="${c}"/>`,
  quiff: (c) => `<path d="M27 44 C22 14 56 -2 80 16 C73 20 70 26 71 44 C66 34 58 30 50 30 C42 30 33 34 27 44 Z" fill="${c}"/>`,
  short: (c) => `<path d="M28 44 C24 3 76 3 72 44 C67 33 59 28 50 28 C41 28 33 33 28 44 Z" fill="${c}"/>`,
  long: (c) => `<path d="M28 46 C24 3 76 3 72 46 C68 34 60 27 50 27 C40 27 32 34 28 46 Z" fill="${c}"/>`,
  bun: (c) => `<path d="M28 44 C24 3 76 3 72 44 C67 33 59 28 50 28 C41 28 33 33 28 44 Z" fill="${c}"/>`,
  afro: (c) => `<path d="M29 40 C27 6 73 6 71 40 C66 31 59 28 50 28 C41 28 34 31 29 40 Z" fill="${c}"/>`,
  scraggly: (c) =>
    `<path d="M27 46 C23 3 77 3 73 46 L67 44 L66 35 L61 40 L56 31 L51 38 L46 30 L41 36 L36 32 L33 44 Z" fill="${c}"/>` +
    `<path d="M24 40 L19 62 L23 60 L17 80 L27 70 L26 86 L35 62 L34 40 Z M76 40 L81 62 L77 60 L83 80 L73 70 L74 86 L65 62 L66 40 Z" fill="${c}"/>`,
  spiky: (c) => `<path d="M28 44 C24 3 76 3 72 44 C67 33 59 28 50 28 C41 28 33 33 28 44 Z" fill="${c}"/><path d="M27 44 L29 20 L38 29 L43 11 L50 27 L57 11 L62 29 L71 20 L73 44 C67 33 59 30 50 30 C41 30 33 33 27 44 Z" fill="${c}"/>`,
  mohawk: (c) => `<path d="M43 30 L44 6 L56 6 L57 30 C53 27 47 27 43 30 Z" fill="${c}"/>`,
  curly: (c) =>
    [[31, 33, 8], [41, 24, 9], [54, 23, 9], [66, 31, 8], [71, 42, 6], [29, 43, 6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join(''),
};

const moustache = (c) => `<path d="M37 55 C41 50 48 52 50 54 C52 52 59 50 63 55 C59 58 52 56 50 56 C48 56 41 58 37 55 Z" fill="${c}"/>`;
const FACIAL_HAIR = {
  none: () => '',
  stubble: (c) => `<path d="M29 50 C30 66 40 71 50 71 C60 71 70 66 71 50 C66 54 58 53 50 55 C42 53 34 54 29 50 Z" fill="${c}" fill-opacity="0.4"/>`,
  moustache,
  handlebar: (c) => `<path d="M35 55 C38 51 47 52 50 54 C53 52 62 51 65 55 C61 53 55 55 50 56 C45 55 39 53 35 55 Z" fill="${c}"/><path d="M36 55 Q31 56 32 51 M64 55 Q69 56 68 51" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  goatee: (c) => moustache(c) + `<ellipse cx="50" cy="67" rx="5.5" ry="4.5" fill="${c}"/>`,
  beard: (c) => `<path d="M28 47 C27 72 38 78 50 78 C62 78 73 72 72 47 C71 58 65 62 58 62 L42 62 C35 62 29 58 28 47 Z" fill="${c}"/>` + moustache(c),
};

const eye = (x, kind) => {
  if (kind === 'happy') return `<path d="M${x - 4} 47 Q${x} 41 ${x + 4} 47" ${stroke}/>`;
  if (kind === 'sleepy') return `<path d="M${x - 4} 46 L${x + 4} 46" ${stroke}/><path d="M${x - 3} 49 Q${x} 50.5 ${x + 3} 49" stroke="${INK}" stroke-width="1" fill="none"/>`;
  if (kind === 'stars') return `<path d="M${x} 40 L${x + 1.8} 44.4 L${x + 6} 46 L${x + 1.8} 47.6 L${x} 52 L${x - 1.8} 47.6 L${x - 6} 46 L${x - 1.8} 44.4 Z" fill="#f2c94c" stroke="${INK}" stroke-width="1"/>`;
  return `<circle cx="${x}" cy="46" r="3" fill="${INK}"/><circle cx="${x + 1}" cy="45" r="0.9" fill="#fff"/>`;
};
const wideEye = (x) => `<circle cx="${x}" cy="46" r="4.8" fill="#fff" stroke="${INK}" stroke-width="1.6"/><circle cx="${x}" cy="46" r="2.3" fill="${INK}"/>`;
const heartEye = (x) => `<path d="M${x} 50 C${x - 7} 45 ${x - 4} 40 ${x} 43.5 C${x + 4} 40 ${x + 7} 45 ${x} 50 Z" fill="#e0506a" stroke="#a83348" stroke-width="0.8"/>`;
const closedEye = (x) => `<path d="M${x - 4} 46 Q${x} 50.5 ${x + 4} 46" ${stroke}/><path d="M${x - 4} 46 L${x - 5.5} 44.5 M${x + 4} 46 L${x + 5.5} 44.5" ${stroke}/>`;
const EYES = {
  scowl: () => `<path d="M36 46 L44 46 A4 4 0 0 1 36 46 Z M56 46 L64 46 A4 4 0 0 1 56 46 Z" fill="${INK}"/><path d="M33 38 L46 45 M67 38 L54 45" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
  sad: () =>
    eye(40, 'round') + eye(60, 'round') + `<path d="M34 43 L45 39 M66 43 L55 39" ${stroke}/><path d="M37 51 Q34.2 55 37 57.5 Q39.8 55 37 51 Z" fill="#6cb4f0" stroke="#3c7fc0" stroke-width="0.8"/>`,
  wide: () => wideEye(40) + wideEye(60),
  closed: () => closedEye(40) + closedEye(60),
  hearts: () => heartEye(40) + heartEye(60),
  angry: () => eye(40, 'round') + eye(60, 'round') + `<path d="M34 40 L45 44 M66 40 L55 44" ${stroke}/>`,
  round: () => eye(40, 'round') + eye(60, 'round'),
  happy: () => eye(40, 'happy') + eye(60, 'happy'),
  sleepy: () => eye(40, 'sleepy') + eye(60, 'sleepy'),
  stars: () => eye(40, 'stars') + eye(60, 'stars'),
  wink: () => eye(40, 'round') + eye(60, 'happy'),
};

const MOUTHS = {
  scowl: () => `<path d="M42 62 Q50 55 58 62 L57 64 Q50 59 43 64 Z" fill="#fff" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M47 58.5 L47 62 M50 58 L50 61.5 M53 58.5 L53 62" stroke="${INK}" stroke-width="0.9"/>`,
  sad: () => `<path d="M43 63 Q45 59 47.5 61 Q50 63 52.5 61 Q55 59 57 63" ${stroke}/>`,
  smirk: () => `<path d="M43 60 Q51 61 58 55" ${stroke}/>`,
  frown: () => `<path d="M43 63 Q50 56 57 63" ${stroke}/>`,
  kiss: () => `<ellipse cx="50" cy="59.5" rx="3.6" ry="2.8" fill="#d9506a" stroke="${INK}" stroke-width="1.5"/>`,
  laugh: () => `<path d="M40 55 L60 55 Q60 69 50 69 Q40 69 40 55 Z" fill="#5a1f24" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M41.5 56 L58.5 56 L58.5 59 L41.5 59 Z" fill="#fff"/><ellipse cx="50" cy="66" rx="4" ry="2" fill="#e0707d"/>`,
  fangs: () => `<path d="M42 57 Q50 65 58 57" ${stroke}/><path d="M44 58.6 L45.6 63 L47.4 60 Z M52.6 60 L54.4 63 L56 58.6 Z" fill="#fff" stroke="${INK}" stroke-width="0.8" stroke-linejoin="round"/>`,
  smile: () => `<path d="M42 57 Q50 65 58 57" ${stroke}/>`,
  neutral: () => `<path d="M44 60 L56 60" ${stroke}/>`,
  grin: () => `<path d="M41 56 Q50 69 59 56 Z" fill="#fff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`,
  open: () => `<ellipse cx="50" cy="60" rx="4" ry="5" fill="#5a1f24" stroke="${INK}" stroke-width="1.5"/>`,
  tongue: () => `<path d="M42 57 Q50 66 58 57 Z" fill="#5a1f24" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><ellipse cx="50" cy="62" rx="3.2" ry="2.6" fill="#e0707d"/>`,
};

const GLASSES = {
  eyepatch: () => `<path d="M30 36 L56 43 M64 44 L71 40" stroke="#17171c" stroke-width="1.8" fill="none"/><ellipse cx="60" cy="46" rx="7.5" ry="6.5" fill="#17171c"/>`,
  heart: () =>
    `<path d="M40 53 C30 47 32 38 38.5 40 C40 40.6 40 41.6 40 42.5 C40 41.6 40 40.6 41.5 40 C48 38 50 47 40 53 Z" fill="#e0506a" fill-opacity="0.75" stroke="#a83348" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M60 53 C50 47 52 38 58.5 40 C60 40.6 60 41.6 60 42.5 C60 41.6 60 40.6 61.5 40 C68 38 70 47 60 53 Z" fill="#e0506a" fill-opacity="0.75" stroke="#a83348" stroke-width="1.6" stroke-linejoin="round"/>`,
  goggles: () => `<path d="M27 44 L33 44 M67 44 L73 44" stroke="#444" stroke-width="3.5"/><circle cx="40" cy="46" r="8" fill="rgb(120 200 255 / 0.4)" stroke="#c9a24a" stroke-width="3"/><circle cx="60" cy="46" r="8" fill="rgb(120 200 255 / 0.4)" stroke="#c9a24a" stroke-width="3"/><path d="M48 46 L52 46" stroke="#c9a24a" stroke-width="3"/>`,
  none: () => '',
  round: () => `<circle cx="40" cy="46" r="7.5" fill="rgb(255 255 255 / 0.15)" stroke="#2f2f38" stroke-width="2"/><circle cx="60" cy="46" r="7.5" fill="rgb(255 255 255 / 0.15)" stroke="#2f2f38" stroke-width="2"/><path d="M47.5 46 L52.5 46" stroke="#2f2f38" stroke-width="2"/>`,
  square: () => `<rect x="32" y="40" width="16" height="12" rx="2.5" fill="rgb(255 255 255 / 0.15)" stroke="#2f2f38" stroke-width="2"/><rect x="52" y="40" width="16" height="12" rx="2.5" fill="rgb(255 255 255 / 0.15)" stroke="#2f2f38" stroke-width="2"/><path d="M48 45 L52 45" stroke="#2f2f38" stroke-width="2"/>`,
  shades: () => `<path d="M31 41 L49 41 L47 52 L33 52 Z M51 41 L69 41 L67 52 L53 52 Z" fill="#17171c" stroke="#17171c" stroke-width="2" stroke-linejoin="round"/><path d="M49 43 L51 43" stroke="#17171c" stroke-width="2"/>`,
  monocle: () => `<circle cx="60" cy="46" r="7.5" fill="rgb(255 255 255 / 0.15)" stroke="#d4a82f" stroke-width="2"/><path d="M66 52 Q72 66 66 78" fill="none" stroke="#d4a82f" stroke-width="1"/>`,
};

/** Clothes: the body, drawn from the shoulders down, in the chosen colour. */
const body = (c) => `<path d="M10 100 C10 78 28 70 50 70 C72 70 90 78 90 100 Z" fill="${c}"/>`;
const TOPS = {
  tank: (c, skin) => `<path d="M10 100 C10 78 28 70 50 70 C72 70 90 78 90 100 Z" fill="${skin}"/><path d="M26 100 L31 80 C37 77 43 78 50 85 C57 78 63 77 69 80 L74 100 Z" fill="${c}"/>`,
  turtleneck: (c) => body(c) + `<rect x="39" y="60" width="22" height="13" rx="6" fill="${c}"/><path d="M40 66 L60 66 M41 70 L59 70" stroke="${SHADE}" stroke-width="1.5"/>`,
  jersey: (c) => body(c) + `<path d="M40 70 Q50 80 60 70" fill="none" stroke="#fff" stroke-width="3"/><text x="50" y="96" font-size="17" font-weight="700" text-anchor="middle" fill="#fff" font-family="sans-serif">7</text>`,
  scarf: (c) => body(c) + `<path d="M33 67 Q50 79 67 67 L69 76 Q50 88 31 76 Z" fill="#e2c13f"/><path d="M58 79 L63 99 L54 97 L53 83 Z" fill="#e2c13f"/><path d="M58 90 L62 91 M57 94 L61 95" stroke="${SHADE}" stroke-width="1.5"/>`,
  overalls: (c) => body(c) + `<path d="M35 100 L37 82 L63 82 L65 100 Z" fill="#3f6fc4"/><path d="M37 82 L34 72 M63 82 L66 72" stroke="#3f6fc4" stroke-width="4.5" stroke-linecap="round"/><circle cx="37" cy="83" r="1.6" fill="#e2c13f"/><circle cx="63" cy="83" r="1.6" fill="#e2c13f"/><rect x="44" y="88" width="12" height="8" rx="1.5" fill="none" stroke="${SHADE}" stroke-width="1.5"/>`,
  tuxedo: () => `<path d="M10 100 C10 78 28 70 50 70 C72 70 90 78 90 100 Z" fill="#1e1e26"/><path d="M41 70 L50 100 L59 70 Z" fill="#f4efe3"/><path d="M41 70 L50 100 M59 70 L50 100" stroke="${SHADE}" stroke-width="2"/><path d="M50 76 L43 72 L43 80 Z M50 76 L57 72 L57 80 Z" fill="#b83a46"/><circle cx="50" cy="76" r="2" fill="#b83a46"/>`,
  cape: (c) => `<path d="M3 100 C3 72 26 64 50 64 C74 64 97 72 97 100 Z" fill="#7a1f2e"/>` + body(c) + `<path d="M36 72 Q50 80 64 72" fill="none" stroke="#e0b84a" stroke-width="2.5"/><circle cx="50" cy="77" r="3" fill="#e0b84a"/>`,
  tee: (c) => body(c),
  polo: (c) => body(c) + `<path d="M40 70 L50 82 L44 69 Z M60 70 L50 82 L56 69 Z" fill="#fff" fill-opacity="0.9"/><path d="M50 82 L50 100" stroke="${SHADE}" stroke-width="1.5"/>`,
  hoodie: (c) => `<path d="M30 74 C30 60 70 60 70 74 L74 84 L26 84 Z" fill="${SHADE}"/>` + body(c) + `<path d="M36 72 C42 80 58 80 64 72" fill="none" stroke="${SHADE}" stroke-width="3"/><path d="M45 79 L44 92 M55 79 L56 92" stroke="#eee9dc" stroke-width="1.8" stroke-linecap="round"/>`,
  stripes: (c) => body(c) + `<g stroke="#fff" stroke-opacity="0.55" stroke-width="3"><path d="M14 82 L86 82 M11 90 L89 90 M10 98 L90 98"/></g>`,
  suit: (c) => body(c) + `<path d="M40 70 L50 100 L60 70 Z" fill="#f2efe6"/><path d="M40 70 L50 100 M60 70 L50 100" stroke="${SHADE}" stroke-width="2"/><path d="M48 74 L52 74 L53 90 L50 94 L47 90 Z" fill="#b83a46"/>`,
  armour: () => `<path d="M10 100 C10 78 28 70 50 70 C72 70 90 78 90 100 Z" fill="#9ca6af"/><path d="M50 72 L50 100" stroke="#6f7983" stroke-width="2"/><path d="M26 76 C20 78 14 86 14 94 L30 94 Z M74 76 C80 78 86 86 86 94 L70 94 Z" fill="#b9c2ca" stroke="#6f7983" stroke-width="1.5"/><circle cx="22" cy="86" r="1.5" fill="#6f7983"/><circle cx="78" cy="86" r="1.5" fill="#6f7983"/>`,
};

const HATS = {
  bucket: () => `<path d="M28 39 C26 12 74 12 72 39 Z" fill="#8a9a5b"/><path d="M20 39 Q50 30 80 39 Q50 48 20 39 Z" fill="#6d7c45"/><path d="M29 35 Q50 40 71 35" fill="none" stroke="#5a6638" stroke-width="2"/>`,
  santa: () => `<path d="M27 38 C25 9 64 4 80 28 C75 28 72 31 73 38 Z" fill="#d03a3a"/><rect x="25" y="32" width="50" height="9" rx="4.5" fill="#f4efe3"/><circle cx="80" cy="29" r="5" fill="#f4efe3"/>`,
  headphones: () => `<path d="M25 47 C22 4 78 4 75 47" fill="none" stroke="#2f2f38" stroke-width="4.5" stroke-linecap="round"/><rect x="19" y="40" width="10" height="17" rx="4.5" fill="#c9473f" stroke="#2f2f38" stroke-width="1.5"/><rect x="71" y="40" width="10" height="17" rx="4.5" fill="#c9473f" stroke="#2f2f38" stroke-width="1.5"/>`,
  cowboy: () => `<path d="M32 35 C30 4 70 4 68 35 Z" fill="#8b5a2b"/><path d="M33 31 Q50 36 67 31 L67 27 Q50 32 33 27 Z" fill="#4e3218"/><path d="M10 33 Q28 44 50 39 Q72 44 90 33 Q72 27 50 30 Q28 27 10 33 Z" fill="#a06a35"/>`,
  wizard: () => `<path d="M53 -2 L72 38 Q50 44 28 38 Z" fill="#4a3fa0"/><ellipse cx="50" cy="38" rx="27" ry="5" fill="#3a3180"/><circle cx="53" cy="20" r="2" fill="#f2c94c"/><circle cx="46" cy="30" r="1.6" fill="#f2c94c"/><circle cx="61" cy="30" r="1.6" fill="#fff"/><path d="M40 35 Q50 38 63 35" fill="none" stroke="#f2c94c" stroke-width="2"/>`,
  knight: () => `<path d="M27 40 C24 4 76 4 73 40 Z" fill="#aab3bb"/><path d="M27 38 L73 38" stroke="#6f7983" stroke-width="2"/><rect x="48.5" y="38" width="3" height="13" fill="#aab3bb" stroke="#6f7983" stroke-width="0.8"/><path d="M50 8 Q50 -6 66 -2 Q58 2 60 9 Z" fill="#c9473f"/><path d="M30 24 C30 14 70 14 70 24" fill="none" stroke="#d3dae0" stroke-width="2"/>`,
  none: () => '',
  cap: () => `<path d="M28 38 C26 12 74 12 72 38 Z" fill="#3f6fc4"/><path d="M26 37 Q50 29 74 37 Q50 45 26 37 Z" fill="#2e529a"/><circle cx="50" cy="15" r="2" fill="#2e529a"/>`,
  beanie: () => `<path d="M28 37 C25 8 75 8 72 37 Z" fill="#c9473f"/><rect x="26" y="31" width="48" height="8" rx="4" fill="#a63a33"/><circle cx="50" cy="9" r="5" fill="#eee9dc"/>`,
  party: () => `<path d="M50 0 L67 33 Q50 38 33 33 Z" fill="#d8719c"/><circle cx="46" cy="22" r="2" fill="#fff"/><circle cx="55" cy="14" r="2" fill="#f2c94c"/><circle cx="58" cy="27" r="2" fill="#fff"/><circle cx="50" cy="3" r="3" fill="#f2c94c"/>`,
  tophat: () => `<ellipse cx="50" cy="30" rx="28" ry="5" fill="#17171c"/><rect x="34" y="2" width="32" height="28" rx="2" fill="#23232b"/><rect x="34" y="21" width="32" height="6" fill="#b83a46"/>`,
  crown: () => `<path d="M30 33 L32 11 L42 22 L50 6 L58 22 L68 11 L70 33 Z" fill="#e0b84a" stroke="#a37e1c" stroke-width="1.5" stroke-linejoin="round"/><circle cx="50" cy="26" r="2.6" fill="#d9506a"/><circle cx="38" cy="28" r="2" fill="#5a8fe0"/><circle cx="62" cy="28" r="2" fill="#4fc08a"/>`,
};

// Hats that cover the top of the head: the hair is only drawn below the hat line, so none of it shows above or through them.
const COVERING = new Set(['cap', 'beanie', 'bucket', 'santa', 'cowboy', 'wizard', 'knight', 'tophat', 'party']);

let counter = 0;

/** The SVG contents (to put inside an <svg viewBox="0 0 100 100">) for an avatar. Anything unknown is drawn as the default. */
export function avatarMarkup(input) {
  const a = normaliseAvatar(input);
  const colour = (slot) => avatarOption(slot, a[slot]).colour;
  const skin = colour('skin');
  const hair = colour('hairColour');
  const top = colour('topColour');
  const id = counter++;
  const gradientId = `avatar-gradient-${id}`;
  const clipId = `avatar-hairline-${id}`;
  const covered = COVERING.has(a.hat);
  const wrap = (markup) => (covered && markup ? `<g clip-path="url(#${clipId})">${markup}</g>` : markup);
  return [
    covered ? `<clipPath id="${clipId}"><rect x="0" y="36" width="100" height="64"/></clipPath>` : '',
    backdropOf(avatarOption('backdrop', a.backdrop), gradientId),
    wrap(HAIR_BEHIND[a.hair]?.(hair) ?? ''),
    TOPS[a.top](top, skin),
    `<rect x="43" y="58" width="14" height="16" fill="${skin}"/><rect x="43" y="64" width="14" height="10" fill="${SHADE}"/>`,
    `<circle cx="28.5" cy="47" r="4.5" fill="${skin}"/><circle cx="71.5" cy="47" r="4.5" fill="${skin}"/>`,
    `<ellipse cx="50" cy="45" rx="22" ry="24" fill="${skin}"/>`,
    `<path d="M49 49 Q46.5 54 50 55" fill="none" stroke="${SHADE}" stroke-width="2" stroke-linecap="round"/>`,
    FACIAL_HAIR[a.facialHair](hair),
    wrap(HAIR_FRONT[a.hair]?.(hair) ?? ''),
    EYES[a.eyes](),
    MOUTHS[a.mouth](),
    GLASSES[a.glasses](),
    HATS[a.hat](),
  ].join('');
}
