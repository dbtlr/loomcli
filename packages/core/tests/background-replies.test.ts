// Acceptance plan: see packages/core/tests/background.test.ts.

import { Writable } from 'node:stream';

import { describe, expect, it } from 'vite-plus/test';

import {
  backgroundOfLuminance,
  colorFgBg,
  queryAllowed,
  readReplies,
  settleBackground,
} from '../src/background.js';
import type { BackgroundSources } from '../src/background.js';
import { captureHost } from '../src/host.js';
import { processHandle } from '../src/process-handle.js';

const escape = String.fromCodePoint(27);
const bell = String.fromCodePoint(7);
const terminator = `${escape}\\`;
const da1 = `${escape}[?62;22c`;

/** An OSC 11 reply carrying one `rgb:` payload, ended by the terminator given. */
function osc11(payload: string, end = terminator): string {
  return `${escape}]11;rgb:${payload}${end}`;
}

describe('the reply parser', () => {
  it.each([
    ['1 digit', 'f/f/f', 'light'],
    ['2 digits', '00/00/00', 'dark'],
    ['3 digits', 'fff/fff/fff', 'light'],
    ['4 digits', '1c1c/1c1c/1c1c', 'dark'],
    ['mixed widths, each scaled by its own', 'f/ffff/ff', 'light'],
  ])('an OSC 11 reply with %s in each component answers', (_case, payload, answer) => {
    for (const end of [bell, terminator]) {
      expect(readReplies(`${osc11(payload, end)}${da1}`)).toEqual({
        answer,
        ended: true,
        typeahead: '',
      });
    }
  });

  it('garbage before, between, and after the replies passes through as typeahead', () => {
    const received = `ab${osc11('ffff/ffff/ffff')}c${escape}[?997;1nd${da1}ef`;
    expect(readReplies(received)).toEqual({
      answer: 'light',
      ended: true,
      typeahead: 'abcdef',
    });
  });

  it(
    String.raw`Ctrl-C, Ctrl-\, and Ctrl-Z stay in the typeahead for the caller to raise, and the read has no signals`,
    () => {
      const keys = [26, 3, 28, 3].map((code) => String.fromCodePoint(code));
      const received = `a${keys[0]}${osc11('0/0/0')}b${keys[1]}${keys[2]}${da1}c${keys[3]}`;
      expect(readReplies(received)).toEqual({
        answer: 'dark',
        ended: true,
        typeahead: `a${keys[0]}b${keys[1]}${keys[2]}c${keys[3]}`,
      });
    },
  );

  it('a DA1 reply that arrives first ends the read with no answer', () => {
    expect(readReplies(`${da1}${osc11('ffff/ffff/ffff')}`)).toEqual({
      answer: undefined,
      ended: true,
      typeahead: osc11('ffff/ffff/ffff'),
    });
  });

  it.each([
    ['1', 'dark'],
    ['2', 'light'],
  ])('a color-scheme reply of %s answers alone', (mode, answer) => {
    expect(readReplies(`${escape}[?997;${mode}n${da1}`).answer).toBe(answer);
  });

  it('an OSC 11 reply wins over a color-scheme reply beside it', () => {
    expect(readReplies(`${escape}[?997;2n${osc11('0/0/0')}${da1}`).answer).toBe('dark');
  });

  it('an OSC 11 reply that does not parse is removed and answers nothing', () => {
    const received = `${escape}]11;rgba:ffff/ffff/ffff/ffff${bell}${da1}`;
    expect(readReplies(received)).toEqual({
      answer: undefined,
      ended: true,
      typeahead: '',
    });
  });

  it('replies read before the sentinel still answer, and the read is not ended', () => {
    expect(readReplies(`x${osc11('ffff/ffff/ffff')}`)).toEqual({
      answer: 'light',
      ended: false,
      typeahead: 'x',
    });
  });

  it('a luminance just above 0.5 answers light, while exactly 0.5 answers dark', () => {
    expect(backgroundOfLuminance(0.500001)).toBe('light');
    expect(backgroundOfLuminance(0.5)).toBe('dark');
  });

  it('a gray just above and just below the threshold answers by its WCAG luminance', () => {
    // #BCBCBC has a relative luminance of 0.5029, and #BBBBBB of 0.4969.
    expect(readReplies(`${osc11('bc/bc/bc')}${da1}`).answer).toBe('light');
    expect(readReplies(`${osc11('bb/bb/bb')}${da1}`).answer).toBe('dark');
  });
});

describe('COLORFGBG', () => {
  it.each([
    ['0;15', 'light'],
    ['15;0', 'dark'],
    ['15;default;7', 'light'],
    ['0;8', 'dark'],
    ['', undefined],
    [undefined, undefined],
  ])('%j answers %s', (value, answer) => {
    expect(colorFgBg(value)).toBe(answer);
  });
});

describe('the environment a query needs', () => {
  it.each<[string, Record<string, string | undefined>, boolean]>([
    ['a color terminal', { TERM: 'xterm-256color' }, true],
    ['TERM unset', {}, false],
    ['TERM empty', { TERM: '' }, false],
    ['TERM dumb', { TERM: 'dumb' }, false],
    ['GNU screen', { STY: '1234.pts-0.host', TERM: 'screen' }, false],
    ['an empty STY', { STY: '', TERM: 'screen' }, true],
    ['Emacs', { INSIDE_EMACS: '29.1,comint', TERM: 'xterm' }, false],
    ['CI', { CI: 'true', TERM: 'xterm' }, false],
    ['CI=false', { CI: 'false', TERM: 'xterm' }, true],
  ])('%s', (_case, env, allowed) => {
    expect(queryAllowed(env)).toBe(allowed);
  });
});

/** Sources that settle nothing before the query, on a terminal whose color is on. */
const detecting: BackgroundSources = {
  choice: undefined,
  colored: true,
  detects: true,
  env: { TERM: 'xterm-256color' },
  policy: undefined,
  stated: undefined,
  terminals: true,
};

/** A query that answers `answer` and counts how often it was asked. */
function asked(answer: 'dark' | 'light' | undefined) {
  const calls: number[] = [];
  return {
    calls,
    query: async () => {
      calls.push(1);
      return answer;
    },
  };
}

describe('the precedence', () => {
  it.each<[string, Partial<BackgroundSources>, 'dark' | 'light' | undefined]>([
    ["the operator's choice beats every later step", { choice: 'dark', policy: 'light' }, 'dark'],
    ["the author's policy beats a stated background", { policy: 'light', stated: 'dark' }, 'light'],
    ["'auto' answers nothing", { policy: 'auto', stated: 'dark' }, 'dark'],
    ['a stated background beats color off', { colored: false, stated: 'light' }, 'light'],
    ['color off settles undefined', { colored: false }, undefined],
    [
      'a stream that is not a terminal settles undefined, whatever COLORFGBG names',
      { env: { COLORFGBG: '0;15', TERM: 'xterm' }, terminals: false },
      undefined,
    ],
    [
      'a stated background beats a stream that is not a terminal',
      { stated: 'light', terminals: false },
      'light',
    ],
    ['TERM=linux settles dark', { env: { COLORFGBG: '0;15', TERM: 'linux' } }, 'dark'],
  ])('%s, with no query', async (_case, sources, settled) => {
    const { calls, query } = asked('light');
    await expect(settleBackground({ ...detecting, ...sources }, query)).resolves.toBe(settled);
    expect(calls).toEqual([]);
  });

  it('the query answers after every earlier step, and beats COLORFGBG', async () => {
    const { calls, query } = asked('light');
    const env = { COLORFGBG: '15;0', TERM: 'xterm' };
    await expect(settleBackground({ ...detecting, env }, query)).resolves.toBe('light');
    expect(calls).toEqual([1]);
  });

  it('COLORFGBG answers when the query has no answer', async () => {
    const env = { COLORFGBG: '0;15', TERM: 'xterm' };
    await expect(settleBackground({ ...detecting, env }, asked(undefined).query)).resolves.toBe(
      'light',
    );
  });

  it('a background no source knows settles undefined', async () => {
    await expect(settleBackground(detecting, asked(undefined).query)).resolves.toBeUndefined();
  });

  it('detection runs only for a reader: no adaptive entry and no mark settle undefined', async () => {
    const { calls, query } = asked('light');
    const env = { COLORFGBG: '0;15', TERM: 'linux' };
    await expect(
      settleBackground({ ...detecting, detects: false, env }, query),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('a stated background and the policy answer even when nothing detects', async () => {
    const quiet = { ...detecting, detects: false };
    await expect(
      settleBackground({ ...quiet, stated: 'light' }, asked('light').query),
    ).resolves.toBe('light');
    await expect(
      settleBackground({ ...quiet, policy: 'dark' }, asked('light').query),
    ).resolves.toBe('dark');
  });
});

describe('the captured terminal', () => {
  it('reads undefined until the run settles it, even when the override states one', () => {
    const stderr = new Writable({ write: (_chunk, _encoding, done) => done() });
    const handle = processHandle({
      cwd: '/work',
      terminal: {
        background: 'light',
        stderr: { columns: 80, isTTY: true, rows: 24 },
        stdin: { isTTY: true },
        stdout: { columns: 80, isTTY: true, rows: 24 },
      },
    });
    // A failed capture's report is this host, so a failure view rendering it reads undefined.
    expect(captureHost('notes', handle, stderr).report.terminal.background).toBeUndefined();
  });
});
