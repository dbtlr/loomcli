/*
 * Acceptance plan for the background (docs/core/background.md#background).
 *
 * The background is proven when public APIs alone produce these results under Node and Bun, through
 * a fixture Application whose theme holds an adaptive entry and a plain one, and through the reply
 * parser and the settlement as pure functions:
 *
 * - Replies. OSC 11 replies with 1, 2, 3, and 4 hex digits in each component, each ended by BEL and
 *   by `ESC \`, parse to their colors; garbage before, between, and after the replies passes
 *   through as typeahead; `Ctrl-C`, `Ctrl-\`, and `Ctrl-Z` anywhere in what was read leave the
 *   typeahead and name SIGINT, SIGQUIT, and SIGTSTP in arrival order; a DA1 reply that arrives
 *   first ends the read with no answer; a `997` reply answers alone, and an OSC 11 reply beside it
 *   wins; and a luminance just above 0.5 answers light while exactly 0.5 answers dark.
 * - Precedence. Each of the eight steps settles a fixture run, and each beats every later step,
 *   `COLORFGBG` values `0;15`, `15;0`, `15;default;7`, and an empty value included; and a dotenv
 *   hook that imports `COLORFGBG=0;15`, `TERM=linux`, or `STY=1` leaves the settled background and
 *   the query unchanged.
 * - Detection runs for a reader. On a scripted light terminal with `COLORFGBG=0;15`, an Application
 *   whose theme holds no adaptive entry and that declares no background mark writes no query and
 *   reads `undefined` in the action and in a view; the same Application with `background()`
 *   installed writes the query and reads `'light'`; and with neither, `rendering: { background:
 *   'light' }` and a handle's terminal that states `'light'` each still read `'light'`.
 * - Settled once, before preparation. With `NO_COLOR=1` in the captured environment and a dotenv
 *   hook that imports `FORCE_COLOR=1`, on a scripted light terminal, the run writes no query,
 *   `host.terminal.background` reads `undefined`, and the colored output prints each adaptive
 *   token's dark side.
 * - The query on a scripted terminal. A host whose stdin is a scripted fake terminal shows: no byte
 *   written and none read on each skip and at steps 1 through 5; a run whose stdout, stdin, or
 *   stderr is not a terminal, or none of them, writes no query and reads `undefined` under
 *   `COLORFGBG=0;15` and `FORCE_COLOR=1`; the three queries written once, to stderr; raw mode set
 *   and restored to the mode found on the answered path and on the deadline path; typeahead before,
 *   between, and after the replies reaching the action's `stdin` read in order; and a sentinel that
 *   never comes falling through to step 7 after the deadline, with the timer unref'd, cleared at
 *   once on the answered path, and an abort of the caller's signal ending the wait; after the read,
 *   stdin is in the flowing state it was found in and holds no listener core added, and an action's
 *   bare `data` listener, with no `resume()` call, receives the typeahead and later input; an OSC
 *   11 reply with no DA1 reply settles the run from that reply at the deadline, without reaching
 *   step 7; a reply that arrives after the deadline reaches the action's stdin read; `Ctrl-C`,
 *   `Ctrl-\`, and `Ctrl-Z` read during the wait leave the action's typeahead and are raised on the
 *   process in arrival order after the mode is restored; and `Ctrl-C` read during the wait ends the
 *   process by SIGINT.
 * - Themed tokens. An adaptive token resolves to its light side under a light background and to its
 *   dark side under a dark one and under `undefined`, at truecolor, 256, and 16 colors, with each
 *   side's own fallbacks, and a plain token resolves to the same bytes under both.
 * - The choice. `--background=light`, `--background light`, an alias spelling, and the last of
 *   several occurrences each settle the run; a spelling after the bare `--` changes nothing;
 *   `--background=blue` supplies nothing and fails the plugin's validation with exit 2;
 *   `options.background` reads `'light'`, `'dark'`, or `undefined`; and `--background --verbose`
 *   and `--background --` supply no choice.
 * - Where it reads. `host.terminal.background` and a view's `context.background` read the settled
 *   value in the action, a middleware, and a failure view, a handle's stated value is
 *   overruled by an operator's choice, an invocation by name reads `undefined` under `rendering: {
 *   background: 'light' }`, a failure view rendering a failed host capture reads `undefined`, and a
 *   piped run whose theme adapts reads `undefined`.
 * - Declarations. Each rejected declaration the reference lists throws under its rule from the
 *   moment the reference names, `style.adaptive` throws its `TypeError` for each bad argument, and
 *   the negative type checks reject the rules the types state; mutating the object passed to
 *   `style.adaptive` after the call changes no emitted byte; a bare `theme()` accepts an adaptive
 *   entry and a custom token named `adaptive`; and a compiler check imports the four exported
 *   types, compiles a `run({ process: processHandle({ terminal }) })` whose terminal omits `background`, and rejects
 *   a write to `host.terminal.background`.
 * - The terminal itself. A test drives an interactive zsh with job control on a real
 *   pseudo-terminal under Node and Bun: a foreground run of an application whose theme adapts
 *   writes the query, reads a scripted answer as light, and hands the typeahead before it to an
 *   action that reads it with a bare `data` listener; a foreground run whose action never touches
 *   stdin ends after the answer with status 0 and returns the shell's prompt with no key pressed; a
 *   foreground run that reads `Ctrl-C` during the wait ends with status 130 and prints nothing of
 *   its action; and the same run started as a background job writes no query, neither stops nor
 *   hangs, and ends with status 0. A raw-mode switch in a background job stops the process under
 *   both runtimes, which is why the foreground check exists, as ADR-0092 records.
 */

import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vite-plus/test';

import { invoke, invokeFromRemovedDirectory } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/background.mjs', import.meta.url);

/** What one run on the scripted terminal did, as the fixture reports it. */
interface Report {
  code: number | string;
  deadline: { cleared: boolean; clearedSoon: boolean; referenced: boolean }[];
  elapsed: 'deadline' | 'prompt';
  flowing: boolean | null;
  listeners: number;
  modes: boolean[];
  paused: boolean;
  queried: number;
  raised: { raw: boolean; self: boolean; signal: string }[];
  raw: boolean;
  seen: Record<string, string | null>;
  stderr: string;
  stdinRead: string | null;
  stdout: string;
}

/** One run of the fixture under a scenario. */
function run(scenario: Record<string, unknown>): Report {
  const result = invoke(fixture, [JSON.stringify(scenario)]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const query = String.raw`<ESC>]11;?<ESC>\<ESC>[?996n<ESC>[c`;
const da1 = '<ESC>[?62;22c';
const light = `<ESC>]11;rgb:ffff/ffff/f0f0<ESC>\\${da1}`;
const terminalEnv = { COLORTERM: 'truecolor', TERM: 'xterm-256color' };

/** The action's printed line under each side of the adaptive token, at truecolor. */
const printed = {
  dark: '<ESC>[38;2;16;32;48maccent<ESC>[39m <ESC>[36mplain<ESC>[39m\n',
  light: '<ESC>[38;2;240;224;208maccent<ESC>[39m <ESC>[36mplain<ESC>[39m\n',
};

describe('the answered path', () => {
  it('writes the three queries once to stderr, reads light, and restores the mode', () => {
    const report = run({ replies: light });
    expect(report.queried).toBe(1);
    expect(report.stderr).toBe(query);
    expect(report.modes).toEqual([true, false]);
    expect(report.raw).toBe(false);
    expect(report.seen).toMatchObject({ action: 'light', middleware: 'light', view: 'light' });
    expect(report.stdout).toBe(printed.light);
  });

  it('restores the raw mode it found', () => {
    expect(run({ replies: light, startRaw: true }).modes).toEqual([true, true]);
  });

  it('clears the unreferenced deadline as soon as the sentinel arrives', () => {
    const report = run({ replies: light });
    expect(report.deadline).toEqual([{ cleared: true, clearedSoon: true, referenced: false }]);
    expect(report.elapsed).toBe('prompt');
  });

  it('leaves stdin in the flowing state it found, with no listener core added', () => {
    const report = run({ replies: light });
    expect(report.flowing).toBeNull();
    expect(report.paused).toBe(true);
    expect(report.listeners).toBe(0);
  });

  it('a bare data listener in the action receives the typeahead and later keys', () => {
    const report = run({ listen: true, replies: `a<ESC>]11;rgb:0/0/0<BEL>${da1}` });
    expect(report.seen.action).toBe('dark');
    expect(report.stdinRead).toBe('az');
  });

  it('typeahead before, between, and after the replies reaches the action in order', () => {
    const replies = `b<ESC>]11;rgb:0/0/0<BEL>c<ESC>[?997;2nd${da1}e`;
    const report = run({ before: 'a', replies });
    expect(report.stdinRead).toBe('abcde');
    expect(report.seen.action).toBe('dark');
  });
});

describe('the foreground check', () => {
  it('runs for any terminal stream, whatever the handle, and is skipped for a stream that is none', async () => {
    // A session of its own has no controlling terminal, so a check that runs reads background.
    const child = spawn(
      process.env.LOOM_TEST_RUNTIME ?? 'node',
      [fileURLToPath(new URL('fixtures/foreground.mjs', import.meta.url))],
      { detached: true, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    await new Promise((resolve) => child.once('close', resolve));
    expect(JSON.parse(output)).toEqual({ scripted: false, terminal: true });
  });
});

describe('interrupt keys during the wait', () => {
  const [ctrlC, ctrlBackslash, ctrlZ] = [3, 28, 26].map((code) => String.fromCodePoint(code));

  it('leave the typeahead and are raised on the process in order once the mode is restored', () => {
    const replies = `a${ctrlC}b${ctrlBackslash}${ctrlZ}${light}`;
    const report = run({ kill: 'record', replies });
    expect(report.raised).toEqual([
      { raw: false, self: true, signal: 'SIGINT' },
      { raw: false, self: true, signal: 'SIGQUIT' },
      { raw: false, self: true, signal: 'SIGTSTP' },
    ]);
    expect(report.stdinRead).toBe('ab');
    expect(report.seen.action).toBe('light');
  });

  it("raise nothing on a stdin that is not the source's terminal: Ctrl-C cancels, Ctrl-Z drops", () => {
    const cancelled = run({ kill: 'record', piped: true, replies: `a${ctrlC}${light}` });
    expect(cancelled.raised).toEqual([]);
    expect(cancelled.code).toBe(130);
    expect(cancelled.seen.action).toBe('unread');
    const quit = run({ kill: 'record', piped: true, replies: `${ctrlBackslash}${light}` });
    expect(quit.raised).toEqual([]);
    expect(quit.code).toBe(130);
    const suspended = run({ kill: 'record', piped: true, replies: `a${ctrlZ}${light}` });
    expect(suspended.raised).toEqual([]);
    expect(suspended.code).toBe(0);
    expect(suspended.stdinRead).toBe('a');
  });

  it('Ctrl-C ends the run by SIGINT, which a shell reports as status 130', () => {
    const scenario = JSON.stringify({ replies: `${ctrlC}${light}` });
    const result = spawnSync(
      process.env.LOOM_TEST_RUNTIME ?? 'node',
      [fileURLToPath(fixture), scenario],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(result.signal).toBe('SIGINT');
    expect(result.stdout).toBe('');
  });
});

describe('the deadline', () => {
  it('a sentinel that never comes falls through to COLORFGBG, with the mode restored', () => {
    const report = run({ env: { ...terminalEnv, COLORFGBG: '0;15' } });
    expect(report.elapsed).toBe('deadline');
    expect(report.seen.action).toBe('light');
    expect(report.modes).toEqual([true, false]);
    expect(report.deadline).toEqual([{ cleared: true, clearedSoon: false, referenced: false }]);
  });

  it('an OSC 11 reply with no DA1 reply settles the run at the deadline', () => {
    const replies = '<ESC>]11;rgb:ffff/ffff/ffff<BEL>';
    const report = run({ env: { ...terminalEnv, COLORFGBG: '15;0' }, replies });
    expect(report.elapsed).toBe('deadline');
    expect(report.seen.action).toBe('light');
  });

  it("a reply that arrives after the deadline reaches the action's stdin read", () => {
    const report = run({ delay: 1200, replies: light, wait: 400 });
    expect(report.seen.action).toBeNull();
    expect(report.stdinRead).toBe(light);
  });

  it("an abort of the caller's signal ends the wait at once", () => {
    const report = run({ abort: 50 });
    expect(report.elapsed).toBe('prompt');
    expect(report.code).toBe(130);
    expect(report.modes).toEqual([true, false]);
  });
});

describe('the skips', () => {
  it.each<[string, Record<string, boolean>]>([
    ['stdout is piped, as in app | fzf, app | less, or app > file', { stdout: false }],
    ['stdin is not a terminal', { stdin: false }],
    ['stderr is not a terminal', { stderr: false }],
    ['no stream is a terminal', { stderr: false, stdin: false, stdout: false }],
  ])('%s: no byte written or read, and the background reads undefined', (_case, terminal) => {
    const env = { ...terminalEnv, COLORFGBG: '0;15', FORCE_COLOR: '1' };
    const report = run({ env, replies: light, terminal });
    expect(report.queried).toBe(0);
    expect(report.modes).toEqual([]);
    expect(report.seen.action).toBeNull();
  });

  it.each<[string, { env?: Record<string, string>; [key: string]: unknown }]>([
    ['stdin has no raw mode', { raw: false }],
    ['stdin refuses raw mode', { raw: 'throws' }],
    ['TERM is unset', { env: { COLORTERM: 'truecolor' } }],
    ['TERM is dumb', { env: { COLORTERM: 'truecolor', FORCE_COLOR: '1', TERM: 'dumb' } }],
    ['STY is set', { env: { ...terminalEnv, STY: '1234.pts-0.host' } }],
    ['INSIDE_EMACS is set', { env: { ...terminalEnv, INSIDE_EMACS: '29.1,comint' } }],
  ])('%s: no byte written or read, and COLORFGBG answers', (_case, scenario) => {
    const env = { ...(scenario.env ?? terminalEnv), COLORFGBG: '0;15' };
    const report = run({ ...scenario, env, replies: light });
    expect(report.queried).toBe(0);
    expect(report.modes).toEqual([]);
    expect(report.seen.action).toBe('light');
  });

  it.each<[string, Record<string, unknown>, string | null]>([
    ['the choice', { argv: ['--background=dark'], reader: 'both' }, 'dark'],
    ["the author's policy", { declared: { background: 'dark' } }, 'dark'],
    ['a stated background', { stated: 'dark' }, 'dark'],
    ['color off', { env: { ...terminalEnv, NO_COLOR: '1' } }, null],
    ['the Linux console', { env: { COLORTERM: 'truecolor', TERM: 'linux' } }, 'dark'],
    ['no reader', { reader: 'plain' }, null],
  ])('%s settles the run with no query', (_case, scenario, settled) => {
    const report = run({ ...scenario, replies: light });
    expect(report.queried).toBe(0);
    expect(report.modes).toEqual([]);
    expect(report.seen.action).toBe(settled);
  });

  it('a run already cancelled writes no query', () => {
    const report = run({ abort: 0, replies: light });
    expect(report.queried).toBe(0);
    expect(report.code).toBe(130);
  });
});

describe('readers', () => {
  it('the background mark turns detection on for a theme that does not adapt', () => {
    const report = run({ reader: 'mark', replies: light });
    expect(report.queried).toBe(1);
    expect(report.seen.action).toBe('light');
  });

  it.each<[string, Record<string, unknown>]>([
    ['rendering.background', { declared: { background: 'light' } }],
    ['a stated background', { stated: 'light' }],
  ])('%s reads light with no reader', (_case, scenario) => {
    const report = run({ ...scenario, reader: 'plain' });
    expect(report.seen).toMatchObject({ action: 'light', view: 'light' });
  });

  it("an operator's choice overrules a stated background", () => {
    const report = run({ argv: ['--background', 'light'], reader: 'both', stated: 'dark' });
    expect(report.seen).toMatchObject({ action: 'light', option: 'light' });
  });

  it('a failure view reads the settled background', () => {
    expect(run({ fail: true, replies: light }).seen.failure).toBe('light');
  });

  it('a failed host capture fails the run before settlement and writes no query', () => {
    const result = invokeFromRemovedDirectory(fixture, [JSON.stringify({ replies: light })]);
    const report: Report = JSON.parse(result.stdout);
    expect(report.code).toBe(1);
    expect(report.queried).toBe(0);
    expect(report.modes).toEqual([]);
  });

  it('an invocation by name reads undefined under a light policy', () => {
    const report = run({ declared: { background: 'light' }, invoke: true });
    expect(report.seen).toMatchObject({ action: null, view: null });
  });

  it('a piped run whose theme adapts reads undefined', () => {
    const report = run({ terminal: { stderr: false, stdin: false, stdout: false } });
    expect(report.seen.action).toBeNull();
  });
});

describe('settled once, before preparation', () => {
  it('a color change during preparation leaves the background as settled', () => {
    const report = run({
      env: { ...terminalEnv, NO_COLOR: '1' },
      prepare: { FORCE_COLOR: '1' },
      replies: light,
    });
    expect(report.queried).toBe(0);
    expect(report.seen.action).toBeNull();
    expect(report.stdout).toBe(printed.dark);
  });

  it.each([{ COLORFGBG: '0;15' }, { TERM: 'linux' }, { STY: '1' }])(
    'an imported %j leaves the query and the settled background unchanged',
    (prepare) => {
      const report = run({ prepare, replies: `<ESC>]11;rgb:0/0/0<BEL>${da1}` });
      expect(report.queried).toBe(1);
      expect(report.seen.action).toBe('dark');
    },
  );
});

describe('the choice', () => {
  it.each<[string, string[], string | null]>([
    ['an attached value', ['--background=light'], 'light'],
    ['the next word', ['--background', 'light'], 'light'],
    ['the last of several', ['--background=light', '--background=dark'], 'dark'],
    ['a spelling after the bare --', ['--', '--background=light'], 'dark'],
  ])('%s', (_case, argv, settled) => {
    const { seen } = run({ argv, reader: 'both', stated: 'dark' });
    // A run whose parse fails reads its background in the failure view instead of the action.
    expect(seen.action === 'unread' ? seen.failure : seen.action).toBe(settled);
  });

  it("an alias spelling of the application's own marked option settles the run", () => {
    const { seen } = run({ argv: ['--tint=light'], reader: 'own', stated: 'dark' });
    expect(seen.action).toBe('light');
  });

  it('--background=blue supplies nothing and fails validation with exit 2', () => {
    const report = run({ argv: ['--background=blue'], reader: 'both', stated: 'dark' });
    expect(report.code).toBe(2);
    expect(report.stderr).toContain('Supply dark or light.');
  });

  it.each([[['--background', '--verbose']], [['--background', '--']]])(
    '%j supplies no choice',
    (argv) => {
      const report = run({ argv, reader: 'both', stated: 'dark' });
      expect(report.code).toBe(2);
      expect(report.seen.failure).toBe('dark');
    },
  );
});

/** The action's printed line with the adaptive token in one color. */
function line(color: string): string {
  return `<ESC>[${color}maccent<ESC>[39m <ESC>[36mplain<ESC>[39m\n`;
}

describe('themed tokens', () => {
  it.each<[string, Record<string, string>, Record<'dark' | 'light', string>]>([
    ['truecolor', terminalEnv, { dark: '38;2;16;32;48', light: '38;2;240;224;208' }],
    ['256 colors', { TERM: 'xterm-256color' }, { dark: '38;5;17', light: '38;5;223' }],
    ['16 colors', { TERM: 'xterm' }, { dark: '34', light: '33' }],
  ])('an adaptive token resolves to the side the background names at %s', (_case, env, sides) => {
    expect(run({ env, stated: 'light' }).stdout).toBe(line(sides.light));
    expect(run({ env, stated: 'dark' }).stdout).toBe(line(sides.dark));
    expect(run({ env, reader: 'adaptive', terminal: { stdin: false } }).stdout).toBe(
      line(sides.dark),
    );
  });
});
