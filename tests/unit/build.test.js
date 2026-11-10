import { execSync } from 'node:child_process';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('build', () => {
  beforeAll(() => execSync('npx vite build', { stdio: 'pipe' }), 120000);
  it('emits dist/dicer.js referenced by module.json', () => {
    const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
    expect(manifest.esmodules).toEqual(['dist/dicer.js']);
    expect(statSync('dist/dicer.js').isFile()).toBe(true);
  });
  it('keeps dist under 4 MB', () => {
    const total = readdirSync('dist', { recursive: true })
      .map((f) => join('dist', f))
      .filter((p) => statSync(p).isFile())
      .reduce((sum, p) => sum + statSync(p).size, 0);
    expect(total).toBeLessThanOrEqual(4 * 1024 * 1024);
  });
});
