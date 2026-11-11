/**
 * The benchmark window (lazy chunk, opened from the `dicer.benchmark` settings menu): a Run button,
 * a progress line, the result table, "Copy summary" and a note that nothing leaves this screen.
 * The run itself is game.dice3d.benchmark(); this window only presents it.
 */
import { checkTargets } from './dicer-adapter.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const loc = (key) => globalThis.game?.i18n?.localize?.(key) ?? key;
const num = (v, digits = 1) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '–');
const mib = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${(v / 1048576).toFixed(2)} MiB` : '–');

/** One table row from a ScenarioResult: numbers as text and a pass/fail verdict from the G2 targets. */
function rowOf(r) {
  const checks = checkTargets(r);
  const failed = checks.filter((c) => c.pass === false).map((c) => c.id);
  const verdict = failed.length ? 'fail' : checks.some((c) => c.pass === true) ? 'pass' : 'na';
  return {
    scenario: r.scenario,
    frame: num(r.frame?.p95),
    longTask: num(r.longTasks?.maxMs, 0),
    firstFrame: num(r.firstFrame?.p95),
    heap: r.heap ? mib(r.heap.after - r.heap.before) : '–',
    rolls: `${r.rolls ?? '–'}${r.failures ? ` (${r.failures} failed)` : ''}`,
    verdict,
    verdictLabel: loc(verdict === 'pass' ? 'DICER.Bench.Pass' : verdict === 'fail' ? 'DICER.Bench.Fail' : 'DICER.Bench.NA'),
    failed: failed.join(', '),
  };
}

let instance = null;

export class BenchmarkApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'dicer-benchmark',
    classes: ['dicer-benchmark'],
    window: { title: 'DICER.Bench.Title', icon: 'fa-solid fa-gauge-high', resizable: true },
    position: { width: 720, height: 460 },
    actions: {
      run: BenchmarkApp.#onRun,
      copy: BenchmarkApp.#onCopy,
    },
  };

  static PARTS = {
    body: {
      template: 'modules/dicer/templates/benchmark.hbs',
      scrollable: ['.dicer-bench-scroll'],
    },
  };

  #suite = null;
  #text = '';
  #running = false;
  #progress = '';

  /** `suite` and `text` (a finished run) seed the window; the render harness uses them. */
  constructor(options = {}) {
    super(options);
    this.#suite = options.suite ?? null;
    this.#text = options.text ?? '';
  }

  async _prepareContext() {
    const suite = this.#suite;
    const meta = suite
      ? `${suite.browser ?? '–'} | GPU ${suite.gpu ?? '–'} | tier ${suite.tier ?? '–'} | Dicer ${suite.version ?? '–'}`
      : '';
    return {
      running: this.#running,
      canCopy: Boolean(suite) && !this.#running,
      progress: this.#progress || (suite ? loc('DICER.Bench.Done') : ''),
      meta,
      rows: (suite?.results ?? []).map(rowOf),
    };
  }

  static async #onRun() {
    if (this.#running) return;
    const bench = globalThis.game?.dice3d?.benchmark;
    if (typeof bench !== 'function') {
      globalThis.ui?.notifications?.warn(loc('DICER.Bench.Unavailable'));
      return;
    }
    this.#running = true;
    this.#progress = loc('DICER.Bench.Running');
    await this.render();
    try {
      const out = await bench.call(globalThis.game.dice3d, {
        onProgress: ({ index, total, id }) => {
          this.#progress = `${loc('DICER.Bench.Progress')} ${index + 1}/${total}: ${id}`;
          void this.render().catch(() => {});
        },
      });
      // null: the engine refused (dice in the air); it already told the user.
      this.#progress = '';
      if (out) {
        this.#suite = out.suite;
        this.#text = out.text;
      }
    } catch (err) {
      console.error('dicer: the benchmark failed', err);
      this.#progress = `${loc('DICER.Bench.Failed')}: ${err?.message ?? err}`;
    }
    this.#running = false;
    await this.render();
  }

  static async #onCopy() {
    if (!this.#text) return;
    try {
      if (globalThis.navigator?.clipboard?.writeText) await globalThis.navigator.clipboard.writeText(this.#text);
      else await globalThis.game.clipboard.copyPlainText(this.#text);
      globalThis.ui?.notifications?.info(loc('DICER.Bench.Copied'));
    } catch {
      globalThis.ui?.notifications?.warn(loc('DICER.Bench.CopyFailed'));
    }
  }

  async close(options) {
    if (instance === this) instance = null;
    return super.close(options);
  }
}

/** Opens (or brings to front) the window: what the settings menu's proxy class calls. */
export function openBenchmarkApp() {
  instance ??= new BenchmarkApp();
  return instance.render({ force: true });
}
