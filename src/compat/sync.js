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
 */
export function rollToData(roll) {
  if (typeof roll?.toJSON === 'function') return roll.toJSON();
  const dice = Array.isArray(roll?.dice) ? roll.dice : [];
  const terms = dice.map((d) => ({
    class: 'Die',
    number: d.results?.length ?? 0,
    faces: d.faces,
    modifiers: [],
    results: (d.results ?? []).map((r) => ({ result: r.result, active: r.active !== false })),
    options: d.options ?? {},
    evaluated: true,
  }));
  return {
    class: 'Roll',
    formula: terms.map((t) => `${t.number}d${t.faces}`).join(' + '),
    terms,
    options: {},
    evaluated: true,
  };
}

/**
 * Sends and receives showForRoll payloads over the module socket. Foundry never echoes an emit
 * back to its sender. A received payload is ignored when it is not `{v: 1, kind: 'show'}`, when
 * its `users` list is malformed or excludes the current user, when its roll holds more than
 * MAX_RESULTS results, or when the roll fails `fromData`. What the receiver then shows (privacy
 * view, maxDice) is onShow's job. Nothing a payload does throws into the socket handler.
 *
 * @param {object} deps
 * @param {{ on(event, fn): void, off?(event, fn): void, emit(event, data): void }} deps.socket
 * @param {() => { id?: string } | undefined} deps.currentUser
 * @param {(payload: object) => Promise<unknown>} deps.onShow the payload, its roll parsed
 * @param {(data: object) => object} [deps.fromData] Roll.fromData
 * @returns {{ broadcast(payload: object, recipients?: string[] | null): void, dispose(): void }}
 */
export function createSync({ socket, currentUser, onShow, fromData = (d) => globalThis.Roll.fromData(d) }) {
  function receive(p) {
    if (!p || typeof p !== 'object' || p.v !== 1 || p.kind !== 'show') return;
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
      users,
      // Any truthy flag counts: a malformed flag errs towards showing less.
      blind: Boolean(p.blind),
      ghost: Boolean(p.ghost),
      secret: Boolean(p.secret),
      messageID: idOrNull(p.messageID),
      speaker: p.speaker && typeof p.speaker === 'object' ? p.speaker : null,
    });
    Promise.resolve(shown).catch((err) => console.error('dicer: cannot show a synchronized roll', err));
  }

  const handler = (payload) => {
    try {
      receive(payload);
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
