import { MAX_TRAJECTORY_BYTES } from '../hand/gate-hand.js';

/** The module socket event (`module.json` has `"socket": true`). */
export const SOCKET_EVENT = 'module.dicer';

/** A payload whose roll holds more results than this is ignored before it is parsed. */
export const MAX_RESULTS = 1000;

/** How many objects countResults walks before it gives up on a payload as absurd. */
const MAX_NODES = 20000;

/** Total `results` entries anywhere in the roll JSON; Infinity once the walk is absurd. */
function countResults(data) {
  let total = 0;
  let visited = 0;
  const stack = [data];
  while (stack.length) {
    const node = stack.pop();
    if (++visited > MAX_NODES) return Infinity;
    const children = Array.isArray(node) ? node : Object.values(node);
    if (!Array.isArray(node) && Array.isArray(node.results)) total += node.results.length;
    if (total > MAX_RESULTS) return total;
    for (const child of children) if (child && typeof child === 'object') stack.push(child);
  }
  return total;
}

const idOrNull = (v) => (typeof v === 'string' && v !== '' ? v : null);

/**
 * The roll as JSON for the socket. A Foundry Roll serializes itself; a Roll-like object
 * `{dice: [{faces, results, options}]}` (the legacy show() shape) becomes Roll data of Die terms.
 * Such a die keeps its own `number` when it has one (a live DiceTerm does), so a ghost built
 * from this data never counts explosions or rerolls; a dynamic number or faces (a live term's
 * `_number` / `_faces` inner Roll) is marked as JSON marks it, so the ghost drops it (P3-R19).
 */
export function rollToData(roll) {
  if (typeof roll?.toJSON === 'function') return roll.toJSON();
  const dice = Array.isArray(roll?.dice) ? roll.dice : [];
  const dynamic = (v) => v != null && typeof v === 'object';
  const terms = dice.map((d) => ({
    class: 'Die',
    number: Number.isInteger(d?.number) ? d.number : (d?.results?.length ?? 0),
    faces: d?.faces,
    modifiers: [],
    results: (d?.results ?? []).map((r) => ({ result: r.result, active: r.active !== false })),
    options: d?.options ?? {},
    evaluated: true,
    ...(dynamic(d?._number) && { _number: true }),
    ...(dynamic(d?._faces) && { _faces: true }),
  }));
  return {
    class: 'Roll',
    formula: terms.map((t) => `${t.number}d${t.faces}`).join(' + '),
    terms,
    options: {},
    evaluated: true,
  };
}

/** How deep ghostRollData looks for dice inside nested terms (pools, parentheticals). */
const MAX_DEPTH = 32;

/**
 * Ghost roll data built from an allow-list (P3-R16): a fresh `{class: 'Roll', formula: '',
 * options: {}, evaluated: true, terms}` with, per die term found in `data` (nested pool and
 * parenthetical rolls included), only `{class: 'Die', faces, number, results}` where results is
 * `number` copies of `{result: 1, active: true}`: the original dice count, never the result
 * count, so explosions, rerolls and discards show nothing. Nothing else of the source survives:
 * no options, formula, flavor, flags, totals or non-die terms. A count that is not a plain
 * positive integer, an absurd count, or a dynamic count (`_number`, as `(1d4)d6` serializes) is
 * 0 dice. A die whose faces are dynamic (`_faces`, as `1d(1d20)`) or not a plain integer is not
 * sent at all (P3-R19). The inner rolls of dynamic terms are never read.
 */
export function ghostRollData(data) {
  const terms = [];
  collectGhostDice(data, null, ({ faces, number }) =>
    terms.push({ class: 'Die', ...ghostDie(faces, number) }),
  );
  return { class: 'Roll', formula: '', options: {}, evaluated: true, terms };
}

const ghostDie = (faces, number) => ({
  faces,
  number,
  results: Array.from({ length: number }, () => ({ result: 1, active: true })),
});

/**
 * The roll as ghost dice, for every local ghost render (P3-R20: the gate, showForRoll and
 * synchronized receivers): a Roll-like `{ghost: true, dice}` with the same dice as ghostRollData
 * (one die per term `number`, 0 for a dynamic count, none for dynamic faces, every result a 1),
 * so a ghost never shows explosions, rerolls or discards. Each die keeps its source term's class
 * as `constructor` (non-enumerable), so shapeFor still shapes a coin or a Fate die. A Roll-like
 * object without toJSON (the legacy show() shape) counts `number` when it has one, else its
 * results.
 */
export function ghostRoll(roll) {
  let data;
  let live;
  if (typeof roll?.toJSON === 'function') {
    data = roll.toJSON();
    live = roll;
  } else {
    const dice = Array.isArray(roll?.dice) ? roll.dice : [];
    live = { terms: dice };
    // A live dynamic term holds its inner Roll in _number / _faces: marked dynamic, as in JSON.
    const dynamic = (v) => v != null && typeof v === 'object';
    data = {
      terms: dice.map((d) => ({
        faces: d?.faces,
        number: Number.isInteger(d?.number) ? d.number : (d?.results?.length ?? 0),
        results: [],
        ...(dynamic(d?._number) && { _number: true }),
        ...(dynamic(d?._faces) && { _faces: true }),
      })),
    };
  }
  const dice = [];
  collectGhostDice(data, live, ({ faces, number, term }) => {
    const die = ghostDie(faces, number);
    const ctor = term?.constructor;
    if (typeof ctor === 'function' && ctor !== Object) {
      Object.defineProperty(die, 'constructor', { value: ctor, enumerable: false });
    }
    dice.push(die);
  });
  return { ghost: true, dice };
}

/**
 * The ghostRollData walk: calls `onDie({faces, number, term})` per die term of `data` it keeps,
 * `term` being the matching node of `live` (the object `data` was serialized from), if any.
 */
function collectGhostDice(data, live, onDie) {
  let total = 0;
  const visit = (node, depth, mirror) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (Array.isArray(node)) {
      node.forEach((child, i) =>
        visit(child, depth + 1, Array.isArray(mirror) ? mirror[i] : undefined),
      );
      return;
    }
    if (Array.isArray(node.results) && Object.hasOwn(node, 'faces')) {
      // A dynamic term's serialized number / faces is its inner roll's total (P3-R19: Foundry
      // writes the getters, plus _number / _faces): such a value is a result, never sent.
      const faces = node.faces;
      const facesStatic = !Object.hasOwn(node, '_faces') && Number.isInteger(faces) && faces > 0;
      if (!facesStatic || faces > MAX_RESULTS) return; // its shape could be a result: nothing
      const n = node.number;
      const numberStatic = !Object.hasOwn(node, '_number') && Number.isInteger(n) && n > 0;
      const number = numberStatic && total + n <= MAX_RESULTS ? n : 0;
      total += number;
      onDie({ faces, number, term: mirror });
      return;
    }
    for (const key of ['terms', 'rolls', 'roll']) visit(node[key], depth + 1, mirror?.[key]);
  };
  visit(data, 0, live);
}

/**
 * Sends and receives showForRoll payloads over the module socket. Foundry never echoes an emit
 * back to its sender. A received payload is ignored when it is not `{v: 1, kind: 'show'}`, when
 * its `users` list is malformed or excludes the current user, when its roll holds more than
 * MAX_RESULTS results, or when the roll fails `fromData`. The server calls the handler with
 * `(data, senderUserId)`; when a sender id is given, a payload whose `userId` differs from it is
 * ignored (P3-R15: nobody can throw dice in another user's name). `authorId` (the caller's
 * `user`, P3-R18) only picks the dice look. What the receiver then shows
 * (privacy view, maxDice) is onShow's job. Nothing a payload does throws into the socket handler.
 *
 * @param {object} deps
 * @param {{ on(event, fn): void, off?(event, fn): void, emit(event, data): void }} deps.socket
 * @param {() => { id?: string } | undefined} deps.currentUser
 * @param {(payload: object) => Promise<unknown>} deps.onShow the payload, its roll parsed
 * @param {(payload: object, senderId: string) => void} [deps.onHand] a verified hand trajectory
 * @param {(data: object) => object} [deps.fromData] Roll.fromData
 * @returns {{ broadcast(payload: object, recipients?: string[] | null): void, dispose(): void }}
 */
export function createSync({
  socket,
  currentUser,
  onShow,
  onHand,
  fromData = (d) => globalThis.Roll.fromData(d),
}) {
  let warned = false;
  /**
   * Task 8: a thrower's trajectory (`kind: 'hand'`) goes to onHand(payload, senderId) only from a
   * verified sender (required here) equal to `userId`, and only when the trajectory (its base64
   * sections and the rest, as JSON: as the encoder measures it) fits MAX_TRAJECTORY_BYTES, else
   * it is ignored before decoding (one warning). The rest is the hand gate's.
   */
  function hand(p, sender) {
    const t = p.trajectory;
    if (!onHand || sender == null || p.userId !== sender || !t || typeof t !== 'object') return;
    if (JSON.stringify(t).length > MAX_TRAJECTORY_BYTES) {
      return void (warned ||= !console.warn('dicer: an oversized hand throw was ignored'));
    }
    onHand(p, sender);
  }

  function receive(p, senderUserId) {
    if (!p || typeof p !== 'object' || p.v !== 1) return;
    if (p.kind === 'hand') return hand(p, senderUserId);
    if (p.kind !== 'show') return;
    if (senderUserId != null && p.userId !== senderUserId) return;
    let users = null;
    if (p.users != null) {
      if (!Array.isArray(p.users)) return;
      users = p.users.filter((u) => typeof u === 'string');
      const me = currentUser()?.id;
      if (me == null || !users.includes(me)) return;
    }
    if (!p.roll || typeof p.roll !== 'object' || countResults(p.roll) > MAX_RESULTS) return;
    let roll;
    try {
      roll = fromData(p.roll);
    } catch {
      return;
    }
    if (!roll || typeof roll !== 'object') return;
    const shown = onShow({
      roll,
      userId: idOrNull(p.userId),
      // Whose look the dice wear (P3-R18); privacy keeps using the verified userId.
      authorId: idOrNull(p.authorId) ?? idOrNull(p.userId),
      users,
      // Any truthy flag counts: a malformed flag errs towards showing less.
      blind: Boolean(p.blind),
      ghost: Boolean(p.ghost),
      secret: Boolean(p.secret),
      messageID: idOrNull(p.messageID),
      speaker: p.speaker && typeof p.speaker === 'object' ? p.speaker : null,
    });
    Promise.resolve(shown).catch((err) =>
      console.error('dicer: cannot show a synchronized roll', err),
    );
  }

  const handler = (payload, senderUserId) => {
    try {
      receive(payload, senderUserId);
    } catch (err) {
      console.error('dicer: cannot handle a socket payload', err);
    }
  };
  socket.on(SOCKET_EVENT, handler);

  return {
    /** `recipients` (user ids) limits delivery server-side; omitted or null reaches everyone. */
    broadcast(payload, recipients = null) {
      if (Array.isArray(recipients)) socket.emit(SOCKET_EVENT, payload, { recipients });
      else socket.emit(SOCKET_EVENT, payload);
    },
    dispose() {
      socket.off?.(SOCKET_EVENT, handler);
    },
  };
}
