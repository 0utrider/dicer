/* Module worker: owns one Rapier sim. Must not touch the DOM or import three.js. */
import wasmUrl from 'virtual:rapier-wasm-url';
import { createSim, initPhysics, prewarm } from './sim.js';
import { MSG, READY } from './protocol.js';

const DEFAULT_AREA = { halfWidth: 12, halfDepth: 7 };
let sim = null;
let ready = null;

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === MSG.INIT) {
      ready = initPhysics(wasmUrl).then(() => {
        sim = createSim(msg.area ?? DEFAULT_AREA, msg.hulls, msg.readers);
        // Pre-warm every die type (colliders, hulls, wasm paths) before announcing ready.
        prewarm(sim, [...Object.keys(msg.hulls ?? {}), 'd2']);
      });
      await ready;
      self.postMessage({ type: READY });
      return;
    }
    await ready; // messages sent before init completes are handled in order afterwards
    if (msg.type === MSG.RESIZE) {
      sim.resize(msg.area);
    } else if (msg.type === MSG.RECYCLE) {
      sim.recycle(msg.buffer, msg.events);
    } else if (msg.type === MSG.THROW) {
      // The request as sent: dice, seed, area?, obstacles?, splatSpeed?, free?, launch? (protocol.js).
      const { settledStep, nudges } = sim.throw(msg, (c) =>
        self.postMessage({ type: MSG.CHUNK, id: msg.id, ...c }, [c.data.buffer, c.events.buffer]),
      );
      self.postMessage({ type: MSG.DONE, id: msg.id, settledStep, nudges });
    }
  } catch (err) {
    self.postMessage({ type: MSG.ERROR, id: msg.id, message: String(err?.message ?? err) });
  }
};
