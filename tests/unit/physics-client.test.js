import { expect, test } from 'vitest';
import { PhysicsClient } from '../../src/physics/physics-client.js';

class FakeWorker {
  constructor() {
    this.sent = [];
    this.terminated = false;
  }
  postMessage(m, t) {
    this.sent.push({ m, t });
  }
  terminate() {
    this.terminated = true;
  }
  emit(data) {
    this.onmessage({ data });
  }
}

test('throw before ready is queued, chunks are forwarded in order, done resolves', async () => {
  const w = new FakeWorker();
  const client = new PhysicsClient(() => w);
  const stream = client.throw({ dice: [{ type: 'd20' }], seed: 1 });
  expect(w.sent.some((s) => s.m.type === 'throw')).toBe(false);
  w.emit({ type: 'ready' });
  await client.ready();
  const throwMsg = w.sent.find((s) => s.m.type === 'throw').m;
  const got = [];
  stream.onChunk((c) => got.push(c.index));
  w.emit({
    type: 'chunk',
    id: throwMsg.id,
    index: 0,
    steps: 30,
    data: new Float32Array(210),
    done: false,
  });
  w.emit({
    type: 'chunk',
    id: throwMsg.id,
    index: 1,
    steps: 5,
    data: new Float32Array(35),
    done: true,
  });
  w.emit({ type: 'done', id: throwMsg.id, settledStep: 35 });
  await expect(stream.done).resolves.toEqual({ settledStep: 35 });
  expect(got).toEqual([0, 1]);
});

test('recycle transfers the buffer back; terminate terminates the single worker', () => {
  let created = 0;
  const w = new FakeWorker();
  const client = new PhysicsClient(() => (created++, w));
  const buf = new Float32Array(7);
  client.recycle(buf);
  expect(w.sent.at(-1).t).toEqual([buf.buffer]);
  client.resize({ halfWidth: 5, halfDepth: 5 });
  expect(created).toBe(1);
  client.terminate();
  expect(w.terminated).toBe(true);
});

test('an error message rejects only that stream', async () => {
  const w = new FakeWorker();
  const client = new PhysicsClient(() => w);
  w.emit({ type: 'ready' });
  const stream = client.throw({ dice: [{ type: 'd20' }], seed: 1 });
  const id = w.sent.find((s) => s.m.type === 'throw').m.id;
  w.emit({ type: 'error', id, message: 'boom' });
  await expect(stream.done).rejects.toThrow('boom');
});

test('init posts the hulls; throws and resizes keep their send order', () => {
  const w = new FakeWorker();
  const hulls = { d6: { points: new Float32Array(3), radius: 0.07 } };
  const client = new PhysicsClient(() => w, { hulls });
  expect(w.sent[0].m).toMatchObject({ type: 'init', hulls });
  client.resize({ halfWidth: 5, halfDepth: 5 });
  client.throw({ dice: [{ type: 'd6' }], seed: 1 });
  client.resize({ halfWidth: 6, halfDepth: 6 });
  w.emit({ type: 'ready' });
  expect(w.sent.slice(1).map((s) => s.m.type)).toEqual(['resize', 'throw', 'resize']);
});

test('an init failure rejects ready, every queued stream, and later throws', async () => {
  const w = new FakeWorker();
  const client = new PhysicsClient(() => w);
  const a = client.throw({ dice: [{ type: 'd6' }], seed: 1 });
  const b = client.throw({ dice: [{ type: 'd6' }], seed: 2 });
  w.emit({ type: 'error', message: 'wasm failed' });
  await expect(client.ready()).rejects.toThrow('wasm failed');
  await expect(a.done).rejects.toThrow('wasm failed');
  await expect(b.done).rejects.toThrow('wasm failed');
  await expect(client.throw({ dice: [], seed: 3 }).done).rejects.toThrow('wasm failed');
  expect(w.sent.some((s) => s.m.type === 'throw')).toBe(false);
});

test('throw after terminate returns an already rejected stream', async () => {
  const w = new FakeWorker();
  const client = new PhysicsClient(() => w);
  client.terminate();
  const stream = client.throw({ dice: [{ type: 'd6' }], seed: 1 });
  await expect(stream.done).rejects.toThrow(/terminated/);
  expect(w.sent.some((s) => s.m.type === 'throw')).toBe(false);
});

test('a worker error event rejects every pending stream', async () => {
  const w = new FakeWorker();
  const client = new PhysicsClient(() => w);
  w.emit({ type: 'ready' });
  const a = client.throw({ dice: [{ type: 'd6' }], seed: 1 });
  const b = client.throw({ dice: [{ type: 'd6' }], seed: 2 });
  w.onerror({ message: 'worker crashed', preventDefault() {} });
  await expect(a.done).rejects.toThrow('worker crashed');
  await expect(b.done).rejects.toThrow('worker crashed');
  await expect(client.throw({ dice: [], seed: 3 }).done).rejects.toThrow('worker crashed');
});

test('a worker messageerror event rejects every pending stream', async () => {
  const w = new FakeWorker();
  const client = new PhysicsClient(() => w);
  w.emit({ type: 'ready' });
  const a = client.throw({ dice: [{ type: 'd6' }], seed: 1 });
  w.onmessageerror({});
  await expect(a.done).rejects.toThrow(/could not be deserialized/);
});
