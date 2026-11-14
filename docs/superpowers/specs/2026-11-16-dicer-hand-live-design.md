# Live hand throws — design (small change)

## Why

The owner saw a GM's public hand roll (3d20) reach a player only after the GM's dice had finished
animating.

The physics worker computes the whole throw synchronously, within milliseconds of release
(`sim.throw`). The thrower's client still waited for its own animation to land, 2–4 s, before
reading the result. Only then did:

1. the roll resolve;
2. the chat message get created;
3. the trajectory go out (P6-D2).

Players therefore always lagged by a full throw.

## Goal

Players start replaying a hand throw about 0.2–0.5 s after the thrower releases, instead of 2–4 s
later.

## Non-goals and anti-goals

- **Privacy is unchanged.** The trajectory is still sent only after the message exists (P6-D2), to
  the same recipients.
- **Automatic rolls stay per-screen.** Making them identical on every screen is the separate v2
  item.
- **No spoiler on the thrower's screen.** The thrower's own card must not reveal before their dice
  land. Their sounds, effects and pets still fire at landing.

## Approaches

1. **Read the result at physics-done (picked).**
   - Playback already reads free dice from the final frame when the done chunk arrives.
   - DiceBox exposes those values as soon as physics is done, so the roll resolves early.
   - The P6-D2 path then sends the trajectory early too.
2. **Send the trajectory at release, before the message exists.** Dropped. The roll mode, whisper
   list and RollStart or PF2e secret flags aren't known yet, so a blind or secret result could leak.

## Design

- **`DiceBox.roll()` result gains `read: Promise<number[]|null>`:**
  - it holds the same values as `values`, in the same format;
  - it resolves at physics-done, after `record`, using the hand chunk's `values(roll)`, which is
    the mapping `land()` uses minus the d16 glow;
  - at landing it resolves at the latest, and it resolves null on failure;
  - without the hand chunk it resolves null.
- **Throw overlay, `openThrowOverlay({ early })`:** with `early` set, it finishes on `thrown.read`
  and adds `landed: thrown.landed` to its result. Its DOM is still removed at landing.
- **`castFree(resolver, specs, full, early)`:** the same `read` and `landed` behaviour.
- **resolve.js `queued(ms, fn)`:**
  - `fn` receives `hold(promise)`;
  - the next queued throw starts only after the held promise settles, bounded by `HAND_GRACE_MS`
    (20 s), so the next prompt never opens while dice still fly.
- **Extras (explosions, rerolls, dynamic terms; P6-D3):** `throwFree` first waits for the stored
  hand throw's `landed`, bounded by `HAND_GRACE_MS`. An extra die never appears while the first
  still flies, which would give the result away, and the order matches the replays. An exploding
  roll's message therefore still waits for its extras to land, so it doesn't gain the live head
  start. This was accepted (review finding 1).
- **Owned path guard:** the decoration at landing is skipped if the message was deleted or revealed
  in the meantime.
- **Follow-up window:**
  - `lastLanded` is set when the values are read;
  - a new `followUntil` is Infinity until landing, then landing + `FOLLOW_MS`;
  - `isFollowUp` is `startedAt >= lastLanded && startedAt < followUntil`;
  - so a follow-up that starts during the flight still counts, and a roll queued before the throw
    still doesn't.
- **Message gate, thrower's own real hand roll (owned):** it waits for `handle.landed`, then calls
  `decorateLanded`. The card reveals after landing. This also holds in the old mode, where
  `landed` has already resolved.
- **Setting:** a world setting `handLiveShare`, Boolean, default `true`, labelled "Share hand
  throws live". When off, the overlay and `castFree` use `values` as before.
- **Unchanged:** tray throws keep their current path.

## Tests

- **DiceBox:** `read` resolves before `landed` for a free roll, with values equal to `values`.
  It resolves null when the roll fails.
- **queued:** a held promise delays the next fn, and the bound caps that delay.
- **Follow-ups:** a roll started between read and landing is a follow-up; a roll started before the
  read is not.
- **Gate:** an owned hand roll whose handle hasn't landed reveals only after `landed`, and its
  decorate runs then.
- **Settings:** `handLiveShare` is registered and its strings exist.
- **Live check (owner):** the GM's hand roll reaches Idan's screen almost together with the GM's.
