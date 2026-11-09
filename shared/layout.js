// How a game's places are laid out, which is the only thing the two families of game really disagree about.
//
// Some games have numbered seats, where the number means something — who deals, who passes to whom, who is on your left
// — and an empty seat is a hole in the middle of the list.  Others keep a list of players in the order they joined,
// where the position means nothing and there are no holes.  Everything else about joining, leaving, computer players
// taking a place over and people taking it back is the same in both, and it should be written once.
//
// This is the part that cannot be: how a place is named from outside, and how to find who is in it.  Everybody is
// named by a **slot** — "s0", "s1" — which is the seat number in one family and the key handed out when a player joins
// in the other.  A slot is a string in both, deliberately: an account id is a small number too, and the two are
// indistinguishable once either is a key of an object or a field of a message, which is a mistake that has already
// been made twice and found late both times.
//
// Depends on: nothing.

/** The number in a slot ("s3" -> 3), or -1 if it is not one. */
const numberIn = (slot) => (typeof slot === 'string' && /^s\d+$/.test(slot) ? Number(slot.slice(1)) : -1);

/** The slot a seat number is called by. */
export const slotForSeat = (index) => `s${index}`;

/**
 * Numbered seats: the slot is the seat number, and an empty seat is a null in the list.
 */
export const seatLayout = {
  /** @param {object | null} member @param {number} index @returns {string} */
  slotOf: (member, index) => slotForSeat(index),
  /** The seat number behind a slot, or -1 when there is no such seat. */
  indexOf(room, slot) {
    const index = numberIn(slot);
    return index >= 0 && index < room.seats.length ? index : -1;
  },
  /** Who is in that slot, or null. */
  at(room, slot) {
    const index = this.indexOf(room, slot);
    return index === -1 ? null : (room.seats[index] ?? null);
  },
};

/**
 * A list of players: the slot is the key each player was given when they joined, and travels with their place.
 */
export const rosterLayout = {
  /** @param {object} member @returns {string} */
  slotOf: (member) => member?.slot,
  /** Where in the list that slot is, or -1. */
  indexOf: (room, slot) => room.players.findIndex((p) => p.slot === slot),
  /** Who is in that slot, or null. */
  at: (room, slot) => room.players.find((p) => p.slot === slot) ?? null,
};
