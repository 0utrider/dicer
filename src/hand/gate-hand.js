/**
 * Rolling by hand, the receiver's world-start half (keep it byte-lean): the message gate's view of
 * the thrower's trajectories (socket `kind: 'hand'`, P6-D2: sent once the chat message exists).
 * The buffer, decoding and replay are the lazy hand chunk's (chunk/replay.js handBuffer), which
 * the first payload or the first wait loads.
 */

/** A missing trajectory is waited for this long, then the gate throws the result as today. */
export const HAND_REPLAY_WAIT_MS = 4000;
/** A trajectory that arrives before its chat message is kept this long. */
export const HAND_BUFFER_MS = 30000;
/**
 * A trajectory payload's size limit: the chunk's encoder gives null above it (as JSON), and sync
 * ignores a larger payload before decoding.
 */
export const MAX_TRAJECTORY_BYTES = 262144;

/** A roll whose dice were thrown by hand: a dicerHand flag with dice thrown, not a fallback. */
export const isHandRoll = (roll) => {
  const h = roll?.options?.dicerHand;
  return typeof h?.id === 'string' && typeof h.by === 'string' && !h.fallback && h.n > 0;
};

/**
 * `importChunk()` resolves the hand chunk (null: unavailable); `chunkNow()` is the chunk when
 * already loaded (the thrower's own stored throw is read synchronously). `now` and
 * `setTimeoutFn` go to the chunk's buffer.
 * - accept(payload, senderId): a verified payload, buffered HAND_BUFFER_MS for its message.
 * - waitFor(messageId, rollId, authorId): the decoded trajectory that author sent for that roll
 *   of that message, or null after HAND_REPLAY_WAIT_MS (or without the chunk).
 * - ownHandle(roll): this client's lingering hand throw of `roll`, or null.
 * - replay(decoded, o): the chunk buffer's replay (the landed promise of a validated replay), or
 *   null (no chunk, it failed, or it does not match the message).
 */
export function createHandGate(o) {
  let b = null;
  const buf = () => o.importChunk().then((m) => (b ??= m?.handBuffer(o)));
  return {
    isHand: isHandRoll,
    accept: (p, sender) => void buf().then((x) => x?.accept(p, sender), () => {}),
    waitFor: (...a) => buf().then((x) => x?.waitFor(...a) ?? null, () => null),
    ownHandle: (roll) => o.chunkNow?.()?.handThrows.get(roll.options.dicerHand.id)?.handle ?? null,
    replay: (d, x) => b?.replay(d, x) ?? null,
  };
}
