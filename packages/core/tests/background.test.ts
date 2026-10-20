import { describe, expect, it } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/background.mjs', import.meta.url);

/** What one run on the scripted terminal did, as the fixture reports it. */
interface Report {
  code: number | string;
  deadline: { cleared: boolean; clearedSoon: boolean; referenced: boolean }[];
  elapsed: 'deadline' | 'prompt';
  listeners: number;
  modes: boolean[];
  paused: boolean;
  queried: number;
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

  it('leaves stdin paused with no listener core added', () => {
    const report = run({ replies: light });
    expect(report.paused).toBe(true);
    expect(report.listeners).toBe(0);
  });

  it('typeahead before, between, and after the replies reaches the action in order', () => {
    const replies = `b<ESC>]11;rgb:0/0/0<BEL>c<ESC>[?997;2nd${da1}e`;
    const report = run({ before: 'a', replies });
    expect(report.stdinRead).toBe('abcde');
    expect(report.seen.action).toBe('dark');
  });

  it('writes to stdout when only stdout is a terminal whose color is on', () => {
    const report = run({ replies: light, terminal: { stderr: false } });
    expect(report.stderr).toBe('');
    expect(report.stdout).toBe(`${query}${printed.light}`);
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
  it.each<[string, { env?: Record<string, string>; [key: string]: unknown }]>([
    ['stdin is not a terminal', { terminal: { stdin: false } }],
    ['stdin has no raw mode', { raw: false }],
    ['stdin refuses raw mode', { raw: 'throws' }],
    [
      'no destination is a terminal',
      { env: { ...terminalEnv, FORCE_COLOR: '1' }, terminal: { stderr: false, stdout: false } },
    ],
    ['TERM is unset', { env: { COLORTERM: 'truecolor' } }],
    ['TERM is dumb', { env: { COLORTERM: 'truecolor', FORCE_COLOR: '1', TERM: 'dumb' } }],
    ['STY is set', { env: { ...terminalEnv, STY: '1234.pts-0.host' } }],
    ['INSIDE_EMACS is set', { env: { ...terminalEnv, INSIDE_EMACS: '29.1,comint' } }],
    ['the platform is Windows', { platform: 'win32' }],
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

  it('a run() policy that fails its background writes no query', () => {
    const report = run({ rendering: { background: 'blue' }, replies: light });
    expect(report.queried).toBe(0);
    expect(report.code).toBe(1);
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
