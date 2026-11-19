"""Builds everything about the Zurubang deck that is generated rather than written.

Run it from anywhere, with Python 3 and ImageMagick on the path:

    python tools/build-cards.py

It reads the card sheets and the machine-readable index next to them (../../../zurubang by default, or
wherever ZURUBANG_SOURCE points) and writes three things into this module:

  cards/faces/<id>.jpg, cards/backs/<colour>.jpg   the art, cut down to a size a web page wants
  cards.js                                         the deck as data, with no English in it at all
  locales/en.json                                  the `cards` block of it, merged in beside the rest

Every card's name comes from the sheets; every talent's text is written here, in the site's voice, so
that it is one piece of English rather than a hundred and five.  Nothing else in the locale file is
touched, so this is safe to run again whenever the sources change.
"""

import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.dirname(HERE)
SOURCE = os.environ.get("ZURUBANG_SOURCE") or os.path.normpath(os.path.join(MODULE, "..", "..", "..", "zurubang"))

# The rulebook's deck is 105 cards; the sheets carry a second, uncensored artwork of two of them.
UNCENSORED = {"white-14", "black-14"}
# The cards whose talent is theirs alone.  The shared ones name themselves in cards.json.
UNIQUE = {
    "white-04": "mercy-twister",
    "white-11": "hill-dwarf",
    "white-20": "ki-rin",
    "green-03": "gnomeling",
    "green-04": "bembi",
    "green-09": "beast-kid",
    "green-10": "carrot-knight",
    "green-12": "druid",
    "red-02": "cole-sage",
    "red-05": "ember-monkey",
    "red-17": "ogre-mage",
    "black-03": "sorcerer-apprentice",
    "black-08": "dark-warlord",
    "black-09": "melody",
    "black-19": "beholder",
    "black-21": "necromancer",
    "blue-04": "otter-warrior",
    "blue-18": "basilisk",
}

# What each talent does, in the site's own words rather than the card's.  The keys are the ones above and
# the shared ones in cards.json; the build fails if the two sets ever stop matching.
TALENTS = {
    "zurubang": "Beats every card, except any card with power 4 or less.  Cannot be destroyed.  A Zurubang that loses is thrown away, and the card that beat it takes 1 extra point.",
    "dragon": "A card with the shooting ability holds the Dragon to a draw.",
    "elemental": "Gains 1 power for every card of its own element face up on the battlefield, counting the card opposite but never itself.",
    "energy-knight": "Gains 5 power on position {position}, and nothing anywhere else.",
    "indestructible": "Cannot be destroyed.  Takes 1 extra point from a card with the destroying ability.",
    "swap": "Changes sides with the card opposite once the duel is over, even if it was destroyed first.",
    "troll": "Gains 1 power on position 2, 2 on position 3, 3 on position 4, and 4 on position 5.",
    "mercy-twister": "Before anything else, the card opposite is thrown away and replaced from a stack.",
    "hill-dwarf": "Takes 1 extra point if he wins his fight, and is thrown away if he loses it.",
    "ki-rin": "After the duel, if the Ki-Rin survived, draw a card: power 1 to 7 takes 1 extra point, and 8 or more throws the Ki-Rin away.",
    "gnomeling": "Beats any non-fire card of power 9 or more, flying or not.",
    "bembi": "If the Bembi loses to a fire card, take 4 extra points and throw the Bembi away.",
    "beast-kid": "Draw a card from a stack: its power is added to the Beast Kid's for this fight.  The drawn card is thrown away afterwards.",
    "carrot-knight": "Gains 4 power if the card opposite has an even power.",
    "druid": "Draw a card from a stack: if its face is earth, the Druid gains 4 power.  The drawn card is thrown away afterwards.",
    "cole-sage": "Takes 2 extra points if he wins his fight.",
    "ember-monkey": "Beats every other non-elemental card.",
    "ogre-mage": "Before anything else, and only once, a card opposite of power 8 or less is exchanged for the top card of the graveyard.",
    "sorcerer-apprentice": "Takes 1 extra point if he wins his fight.",
    "dark-warlord": "Gains 2 power for every spirit card still face down on the battlefield.",
    "melody": "Gains 2 power for every non-elemental card on the battlefield, face up or face down, except herself.",
    "beholder": "Position 1: flying.  Position 2: destroying.  Position 3: shooting.  Position 4: 1 more power.  Position 5: 1 less.",
    "necromancer": "Before anything else, the card opposite is exchanged for the top card of the graveyard.  A Necromancer who loses his fight is thrown away.",
    "otter-warrior": "Gains 8 power against a water card.",
    "basilisk": "On position 5, every card of the other player's that can be destroyed leaves the battlefield once the fight is over, and so does the Basilisk.",
}

# How wide a card is drawn.  The art is 3:5, and 360 is twice the widest a card is ever shown at.
WIDTH = 360

HEADER = """// The Zurubang deck: 105 cards, as data.  This file says what a card *is* — its back, the element on its face, its
// power, its abilities, and which talent it has — and never what a talent does: the rules of a talent are duel.js, and
// the words of one are locales/en.json.  There is no English here at all, by design: the site's translation check reads
// every string literal in a module, and a hundred card names written in a .js file would be a hundred pieces of
// untranslatable text.  A card's name is `cards.<id>` in the locale file and its talent's text `cards.talent.<key>`.
//
// Generated by tools/build-cards.py from the card sheets in ../../../zurubang, which is where the artwork and the
// rulebook live.  The sheets carry 107 faces: a second, uncensored artwork of the Harpy and of the Succubus, which
// this deck leaves out, so that the deck is the 105 cards the rulebook counts.  Do not edit it by hand.
//
// Depends on nothing.

/** The five card backs, and the element each one promises.  A back can lie: the face is what counts in a duel. */
export const BACK_ELEMENT = { white: 'air', green: 'earth', red: 'fire', black: 'spirit', blue: 'water' };
/** The five backs, in the order a hand is sorted and the lobby lists them. */
export const BACKS = Object.keys(BACK_ELEMENT);
/** The five elements a face can be.  A face may also be 'none', which neither wins nor loses on element. */
export const ELEMENTS = Object.values(BACK_ELEMENT);
/**
 * Which element each one beats: spirit beats air beats water beats fire beats earth, and earth beats spirit.  The
 * circle closes, so every element beats exactly one and loses to exactly one.
 */
export const BEATS = { spirit: 'air', air: 'water', water: 'fire', fire: 'earth', earth: 'spirit' };
/** The three abilities a card's face can carry. */
export const ABILITIES = ['flying', 'shooting', 'destroying'];

/**
 * Every card in the deck, in sheet order.  `power` is null for the five Zurubangs, whose printed power is infinite;
 * `talent` is the key of its talent (shared with other cards, or its own), or null; `position` is the battlefield
 * position an Energy Knight is at home on.
 *
 * @type {{ id: string, back: string, face: string, power: number | null, abilities: string[], talent: string | null,
 *   position?: number }[]}
 */
export const CARDS = [
"""

FOOTER = """];

/** Every card by id, for the lookups the rules do on every move. */
const BY_ID = new Map(CARDS.map((card) => [card.id, card]));

/**
 * The card with this id.
 * @param {unknown} id  anything a client might have sent
 * @returns {object | null} the card, or null if there is no such card
 * Side effects: none.
 */
export const cardOf = (id) => (typeof id === 'string' ? (BY_ID.get(id) ?? null) : null);

/**
 * Is this the id of a card in the deck?
 * @param {unknown} id
 * @returns {boolean}
 * Side effects: none.
 */
export const isCard = (id) => cardOf(id) !== null;

/**
 * A fresh, unshuffled deck of every card's id.
 * @returns {string[]} a new array each call
 * Side effects: none.
 */
export const fullDeck = () => CARDS.map((card) => card.id);

/**
 * The back of a card, which both players may see at all times.
 * @param {string} id
 * @returns {string | null} the back's colour
 * Side effects: none.
 */
export const backOf = (id) => cardOf(id)?.back ?? null;
"""


def js(value):
    """A JSON value written the way this codebase quotes one."""
    return json.dumps(value).replace('"', "'")


def convert(src, dst):
    subprocess.run(["magick", src, "-resize", f"{WIDTH}x", "-strip", "-interlace", "Plane", "-quality", "84", dst], check=True)


def merge(into, block):
    for key, value in block.items():
        if isinstance(value, dict):
            merge(into.setdefault(key, {}), value)
        else:
            into[key] = value


def main(art=True):
    index = os.path.join(SOURCE, "cards.json")
    if not os.path.exists(index):
        sys.exit(f"no card index at {index}; set ZURUBANG_SOURCE to where the sheets are")
    data = json.load(open(index, encoding="utf-8"))
    cards = [c for c in data["cards"] if c["id"] not in UNCENSORED]
    if len(cards) != 105:
        sys.exit(f"expected 105 cards, found {len(cards)}")

    lines = []
    names = {}
    for card in cards:
        talent = card.get("shared") or UNIQUE.get(card["id"])
        if card["talent"] and not talent:
            sys.exit(f"{card['id']} has talent text but no key: add it to UNIQUE")
        if talent and talent not in TALENTS:
            sys.exit(f"{card['id']} has the talent {talent}, which has no words here")
        names[card["id"]] = card["name"]
        fields = [
            f"id: {js(card['id'])}",
            f"back: {js(card['back'])}",
            f"face: {js(card['face'])}",
            f"power: {'null' if card['power'] is None else card['power']}",
            f"abilities: [{', '.join(js(a) for a in card['abilities'])}]",
            f"talent: {js(talent) if talent else 'null'}",
        ]
        if card.get("position"):
            fields.append(f"position: {card['position']}")
        lines.append("  { " + ", ".join(fields) + " },")

    with open(os.path.join(MODULE, "cards.js"), "w", encoding="utf-8", newline="\n") as out:
        out.write(HEADER + "\n".join(lines) + "\n" + FOOTER)

    words_path = os.path.join(MODULE, "locales", "en.json")
    words = json.load(open(words_path, encoding="utf-8"))
    merge(words, {"cards": {**dict(sorted(names.items())), "talent": dict(sorted(TALENTS.items()))}})
    with open(words_path, "w", encoding="utf-8", newline="\n") as out:
        json.dump({key: words[key] for key in sorted(words)}, out, indent=2, ensure_ascii=False)
        out.write("\n")

    if art:
        for folder in ("faces", "backs"):
            os.makedirs(os.path.join(MODULE, "cards", folder), exist_ok=True)
        for card in cards:
            convert(os.path.join(SOURCE, card["file"]), os.path.join(MODULE, "cards", "faces", card["id"] + ".jpg"))
        for colour, back in data["backs"].items():
            convert(os.path.join(SOURCE, back["file"]), os.path.join(MODULE, "cards", "backs", colour + ".jpg"))

    print(f"wrote {len(cards)} cards, {len(TALENTS)} talents{', and the art' if art else ' (the art was left alone)'}")


if __name__ == "__main__":
    main(art="--no-art" not in sys.argv)
