import { spawnWorker } from '../../src/core/spawn-worker.js';

class FakeWorker {
  constructor(url, opts) {
    this.url = String(url);
    this.opts = opts;
  }
}

test('a same-origin worker script is started directly, as a module worker', () => {
  const w = spawnWorker('https://game.example/modules/dicer/dist/assets/physics.worker.js', {
    location: { origin: 'https://game.example', href: 'https://game.example/game' },
    Worker: FakeWorker,
  });
  expect(w.url).toBe('https://game.example/modules/dicer/dist/assets/physics.worker.js');
  expect(w.opts).toEqual({ type: 'module' });
});

test('a CDN-served script (The Forge) starts from a same-origin blob that imports it', async () => {
  vi.useFakeTimers();
  const made = [];
  const revoked = [];
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (made.push(b), 'blob:game/1'));
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => revoked.push(u));
  const src = 'https://assets.forge-vtt.com/bazaar/modules/dicer/1.0.7/dist/assets/physics.worker.js';
  const w = spawnWorker(src, { location: { origin: 'https://someone.forge-vtt.com', href: 'https://someone.forge-vtt.com/game' }, Worker: FakeWorker });
  expect(w.url).toBe('blob:game/1');
  expect(w.opts).toEqual({ type: 'module' });
  expect(await made[0].text()).toBe(`import ${JSON.stringify(src)};`);
  expect(revoked).toEqual([]);
  vi.advanceTimersByTime(60000);
  expect(revoked).toEqual(['blob:game/1']);
  create.mockRestore();
  revoke.mockRestore();
  vi.useRealTimers();
});
