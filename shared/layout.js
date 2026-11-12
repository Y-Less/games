// How a game's places are laid out, which is the only thing the two families of game really disagree about.
//
// Some games have numbered seats, where the number means something — who deals, who passes to whom, who is on your left
// — and an empty seat is a hole in the middle of the list.  Others keep a list of players in the order they joined,
// where the position means nothing and there are no holes.  Everything else about joining, leaving, computer players
// taking a place over and people taking it back is the same in both, and it is written once, in shared/members.js.
//
// This is the part that cannot be: how a place is named from outside, how to find who is in it, how a newcomer is
// given one, what an empty one is, and how the room comes to hold more or fewer of them.  How many a room holds, who
// may change it and when are the same question in both families, and so are asked once, in shared/members.js; what a
// room with that many places actually looks like is the one thing only the layout knows, and that is `resize` and
// `settle` below.  Everybody is named by a **slot** — "s0", "s1" — which is the seat number in
// one family and the key handed out when a player joins in the other.  A slot is a string in both, deliberately: an
// account id is a small number too, and the two are indistinguishable once either is a key of an object or a field of
// a message, which is a mistake that has already been made twice and found late both times.
//
// Depends on: nothing.

/** The number in a slot ("s3" -> 3), or -1 if it is not one. */
const numberIn = (slot) => (typeof slot === 'string' && /^s\d+$/.test(slot) ? Number(slot.slice(1)) : -1);

/** The slot a seat number is called by. */
export const slotForSeat = (index) => `s${index}`;

/**
 * Gives a new member its slot: the name the scoreboard's history calls them by, for as long as this game lasts.
 *
 * A player's place in `room.players` is not an identity — `removeBot` splices the list in the lobby, which renumbers
 * everybody after it — and nor is their id, because a person who leaves a game under way is replaced by a computer
 * player with a new one.  The slot is neither: it is handed out once, here, and it travels with the place through
 * every replacement, because both of those paths build the new member by spreading the old one.  That is what lets
 * the history be written once and never touched again.
 *
 * Only the list family needs this; a numbered seat's slot is its number, so there is nothing to hand out.
 *
 * @param {object} room    the room, whose counter is used up
 * @param {object} member  the member to give a slot to
 * @returns {object} the same member
 * Side effects: sets `member.slot` and advances `room.nextSlot`.
 */
export function withSlot(room, member) {
  room.nextSlot ??= 0;
  member.slot = `s${room.nextSlot++}`;
  return member;
}

/**
 * Numbered seats: the slot is the seat number, and an empty seat is a null in the list.
 */
export const seatLayout = {
  /** @param {object | null} member @param {number} index @returns {string} */
  slotOf: (member, index) => slotForSeat(index),
  /** Everybody at the table, in seat order, with the empty seats left out. */
  list: (room) => room.seats.filter(Boolean),
  /** How many places the room has: a seated game is as big as its table. */
  capacity: (room) => room.seats.length,
  /**
   * Changes how many places the room holds: the table gains or loses seats, and the people and computer players at it
   * keep their order.  Shrinking never puts anybody out, because the rules refuse a size smaller than the room holds.
   */
  resize(room, size) {
    const seated = room.seats.filter(Boolean);
    room.seats = [...seated, ...Array.from({ length: Math.max(0, size - seated.length) }, () => null)];
  },
  /** The room becomes exactly as big as the members in it: the empty seats go, and the rest keep their order. */
  settle(room) {
    room.seats = room.seats.filter(Boolean);
  },
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
  /** The slot this id is in, or undefined.  An empty seat holds nobody, so it never matches. */
  slotOfId(room, id) {
    const index = room.seats.findIndex((seat) => seat?.id === id);
    return index === -1 ? undefined : slotForSeat(index);
  },
  /** A new member needs nothing here: its slot is wherever it ends up sitting. */
  adopt: (room, member) => member,
  /** Sits a member in the first empty seat, and says which.  Null when the table is full. */
  place(room, member) {
    const index = room.seats.findIndex((seat) => seat === null);
    if (index === -1) return null;
    room.seats[index] = member;
    return slotForSeat(index);
  },
  /** Puts a member in a slot that already exists, replacing whoever was in it. */
  put(room, slot, member) {
    const index = this.indexOf(room, slot);
    if (index !== -1) room.seats[index] = member;
  },
  /** Empties a slot: a seat becomes a hole, and keeps its number. */
  vacate(room, slot) {
    const index = this.indexOf(room, slot);
    if (index !== -1) room.seats[index] = null;
  },
  /** The slots every computer player is in. */
  bots: (room) => room.seats.flatMap((seat, index) => (seat?.kind === 'bot' ? [slotForSeat(index)] : [])),
  /** A person who leaves a game under way is replaced by a computer player, and the seat starts afresh: a seated
   *  game keeps its per-player state in arrays beside the seats, indexed by the seat number, so there is nothing on
   *  the seat itself to carry over. */
  replacement: (room, leaving, bot) => bot,
};

/**
 * A list of players: the slot is the key each player was given when they joined, and travels with their place.
 */
export const rosterLayout = {
  /** @param {object} member @returns {string} */
  slotOf: (member) => member?.slot,
  /** Everybody in the room, in the order they joined.  There are no holes. */
  list: (room) => room.players,
  /** How many players the room will hold: what the host settled on, or the whole game until they do. */
  capacity: (room, maxPlayers) => (Number.isInteger(room.size) ? room.size : maxPlayers),
  /** Changes how many places the room holds.  There are no seats to add or take away, only the number itself. */
  resize(room, size) {
    room.size = size;
  },
  /** The room becomes exactly as big as the members in it. */
  settle(room) {
    room.size = room.players.length;
  },
  /** Where in the list that slot is, or -1. */
  indexOf: (room, slot) => room.players.findIndex((p) => p.slot === slot),
  /** Who is in that slot, or null. */
  at: (room, slot) => room.players.find((p) => p.slot === slot) ?? null,
  /** The slot this id is in, or undefined. */
  slotOfId: (room, id) => room.players.find((p) => p.id === id)?.slot,
  /** A new member is given its slot as it is made, before it goes anywhere. */
  adopt: withSlot,
  /** Adds a member to the end of the list, and says which slot it has. */
  place(room, member) {
    room.players.push(member);
    return member.slot;
  },
  /** Puts a member in a slot that already exists, replacing whoever was in it. */
  put(room, slot, member) {
    const index = this.indexOf(room, slot);
    if (index !== -1) room.players[index] = member;
  },
  /** Takes a slot out of the list altogether: there are no holes, so everybody after it moves up. */
  vacate(room, slot) {
    const index = this.indexOf(room, slot);
    if (index !== -1) room.players.splice(index, 1);
  },
  /** The slots every computer player is in. */
  bots: (room) => room.players.flatMap((p) => (p.kind === 'bot' ? [p.slot] : [])),
  /** A person who leaves a game under way hands their place over as it stands — their score, their counters, their
   *  colour — because this family keeps all of that on the member.  Only who is sitting there changes. */
  replacement: (room, leaving, bot) => ({ ...leaving, kind: 'bot', id: bot.id, name: bot.name }),
};
