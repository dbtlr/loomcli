import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import {
  childEnvironment,
  invoke,
  invokeFromRemovedDirectory,
} from '../../../scripts/test-process.js';

/** The notes application, which marks its own `--[no-]color` unless a variant leaves it out. */
const fixture = new URL('fixtures/color.mjs', import.meta.url);

/** The runtimes every case runs under. */
const runtimes = ['node', 'bun'] as const;

/** A shell environment with no color variable and a terminal type that supports color. */
const plain = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: undefined, TERM: 'xterm' };

/** The working directory holding a malformed `.env` line and a malformed configuration file. */
const directory = realpathSync(mkdtempSync(join(tmpdir(), 'loom-color-')));
writeFileSync(join(directory, '.env'), 'NOTES_TOKEN\n');
writeFileSync(join(directory, '.notes.json'), '{');

afterAll(() => {
  rmSync(directory, { force: true, recursive: true });
});

/** Where the fixture writes: a capable terminal, pipes, or the capture of an invocation by name. */
type Terminal = 'tty' | 'pipe' | 'invoke';

/** One run of the fixture: the variant, the terminal, the command line, and any variables. */
function notes(
  runtime: string,
  variant: string,
  terminal: Terminal,
  argv: string[],
  env: Record<string, string | undefined> = {},
) {
  return invoke(fixture, [variant, terminal, ...argv], {
    env: { ...plain, PROBE_CWD: directory, ...env },
    runtime,
  });
}

/** One SGR sequence and the parameters it carries. */
const sgr = new RegExp(`${String.fromCodePoint(27)}\\[(?<parameters>[0-9;]*)m`, 'gu');

/**
 * Whether some SGR sequence in the text sets a foreground or background color, and whether one
 * sets bold. An extended color's own parameters are skipped, so its index is never read as bold.
 */
function styles(text: string): { bold: boolean; color: boolean } {
  let bold = false;
  let color = false;
  for (const match of text.matchAll(sgr)) {
    const parameters = (match.groups?.parameters ?? '').split(';').map(Number);
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index] ?? 0;
      if (parameter === 38 || parameter === 48) {
        color = true;
        index += parameters[index + 1] === 5 ? 2 : 4;
      } else if (
        (parameter >= 30 && parameter <= 37) ||
        (parameter >= 40 && parameter <= 47) ||
        (parameter >= 90 && parameter <= 97) ||
        (parameter >= 100 && parameter <= 107)
      ) {
        color = true;
      } else if (parameter === 1) {
        bold = true;
      }
    }
  }
  return { bold, color };
}

/** What one run's stderr carries: its styles, and the exit status. */
function printed(result: { status: number | null; stderr: string }) {
  return { status: result.status, ...styles(result.stderr) };
}

test.each(runtimes)(
  'on a capable terminal --no-color prints no color and keeps bold, under FORCE_COLOR too, under %s',
  (runtime) => {
    expect(printed(notes(runtime, 'marked', 'tty', ['save']))).toEqual({
      bold: true,
      color: true,
      status: 0,
    });
    expect(printed(notes(runtime, 'marked', 'tty', ['save', '--no-color']))).toEqual({
      bold: true,
      color: false,
      status: 0,
    });
    expect(
      printed(notes(runtime, 'marked', 'tty', ['save', '--no-color'], { FORCE_COLOR: '1' })),
    ).toEqual({ bold: true, color: false, status: 0 });
  },
);

test.each(runtimes)('piped, --color prints color and no bold under %s', (runtime) => {
  expect(printed(notes(runtime, 'marked', 'pipe', ['save']))).toEqual({
    bold: false,
    color: false,
    status: 0,
  });
  expect(printed(notes(runtime, 'marked', 'pipe', ['save', '--color']))).toEqual({
    bold: false,
    color: true,
    status: 0,
  });
});

test.each(runtimes)(
  'the last spelling sets the color of the repetition failure it causes under %s',
  (runtime) => {
    const off = notes(runtime, 'marked', 'tty', ['save', '--color', '--no-color']);
    expect(off.stderr).toContain(
      'Option "--no-color" can be supplied only once. Remove the repeated option.',
    );
    expect(printed(off)).toEqual({ bold: true, color: false, status: 2 });
    const on = notes(runtime, 'marked', 'pipe', ['save', '--no-color', '--color']);
    expect(on.stderr).toContain(
      'Option "--color" can be supplied only once. Remove the repeated option.',
    );
    expect(printed(on)).toEqual({ bold: false, color: true, status: 2 });
  },
);

test.each(runtimes)(
  'a spelling after the bare -- changes nothing, and an alias works as the long spelling under %s',
  (runtime) => {
    expect(printed(notes(runtime, 'marked', 'pipe', ['save', '--', '--color']))).toEqual({
      bold: false,
      color: false,
      status: 0,
    });
    expect(
      printed(notes(runtime, 'marked', 'tty', ['save', '--no-color', '--', '--color'])),
    ).toEqual({ bold: true, color: false, status: 0 });
    expect(printed(notes(runtime, 'marked', 'tty', ['save', '--no-colour']))).toEqual({
      bold: true,
      color: false,
      status: 0,
    });
    expect(printed(notes(runtime, 'marked', 'pipe', ['--colour', 'save']))).toEqual({
      bold: false,
      color: true,
      status: 0,
    });
  },
);

test.each(runtimes)('the choice overrides NO_COLOR and FORCE_COLOR under %s', (runtime) => {
  expect(printed(notes(runtime, 'marked', 'tty', ['save', '--color'], { NO_COLOR: '1' }))).toEqual({
    bold: true,
    color: true,
    status: 0,
  });
  expect(
    printed(notes(runtime, 'marked', 'pipe', ['save', '--no-color'], { FORCE_COLOR: '1' })),
  ).toEqual({ bold: true, color: false, status: 0 });
});

test.each(runtimes)(
  'with neither spelling every byte matches the unmarked application under %s',
  (runtime) => {
    for (const terminal of ['tty', 'pipe'] as const) {
      for (const NO_COLOR of [undefined, '1']) {
        for (const FORCE_COLOR of [undefined, '1']) {
          const variables = { FORCE_COLOR, NO_COLOR };
          expect(notes(runtime, 'marked', terminal, ['save'], variables)).toEqual(
            notes(runtime, 'unmarked', terminal, ['save'], variables),
          );
        }
      }
    }
  },
);

test.each(runtimes)(
  "the choice beats the Application's and run()'s declared color under %s",
  (runtime) => {
    for (const variant of ['app-always', 'run-always']) {
      expect(printed(notes(runtime, variant, 'tty', ['save', '--no-color']))).toEqual({
        bold: true,
        color: false,
        status: 0,
      });
    }
    for (const variant of ['app-never', 'run-never']) {
      expect(printed(notes(runtime, variant, 'pipe', ['save']))).toEqual({
        bold: false,
        color: false,
        status: 0,
      });
      expect(printed(notes(runtime, variant, 'pipe', ['save', '--color']))).toEqual({
        bold: false,
        color: true,
        status: 0,
      });
    }
  },
);

test.each([
  ['an unknown command', 'marked', ['nope'], 2, 'Unknown command "nope".'],
  ['a dotenv warning', 'dotenv', ['save'], 0, 'Skipped NOTES_TOKEN on line 1 of .env'],
  ['a configuration warning', 'config', ['save'], 0, 'Skipped .notes.json'],
  ['an onGraphBuilt declaration error', 'graph', ['save'], 1, 'The judge rejects the graph.'],
] as const)('%s follows the choice', (_name, variant, argv, status, line) => {
  for (const runtime of runtimes) {
    const off = notes(runtime, variant, 'tty', [...argv, '--no-color']);
    expect(off.status).toBe(status);
    expect(off.stderr).toContain(line);
    expect(styles(off.stderr).color).toBe(false);
    const on = notes(runtime, variant, 'pipe', [...argv, '--color']);
    expect(on.status).toBe(status);
    expect(on.stderr).toContain(line);
    expect(styles(on.stderr).color).toBe(true);
  }
});

test.each(runtimes)(
  'a word that attaches a value supplies no choice and fails as the ordinary parse does under %s',
  (runtime) => {
    const line = 'Boolean option "--color" does not accept a value. Supply the flag alone.';
    const terminal = notes(runtime, 'marked', 'tty', ['save', '--color=x']);
    expect(terminal.stderr).toContain(line);
    expect(printed(terminal)).toEqual({ bold: true, color: true, status: 2 });
    expect(printed(notes(runtime, 'marked', 'pipe', ['save', '--color=x']))).toEqual({
      bold: false,
      color: false,
      status: 2,
    });
    expect(
      printed(notes(runtime, 'marked', 'tty', ['save', '--color=x'], { NO_COLOR: '1' })),
    ).toEqual({ bold: true, color: false, status: 2 });
  },
);

test.each(runtimes)(
  'the action reads what the operator typed, never whether color is on, under %s',
  (runtime) => {
    const read = (argv: string[]) =>
      JSON.parse(notes(runtime, 'marked', 'tty', ['save', ...argv]).stdout);
    expect(read(['--color'])).toEqual({ color: true });
    expect(read(['--no-color'])).toEqual({ color: false });
    expect(read([])).toEqual({ color: false });
    expect(read(['--colour'])).toEqual({ color: true });
  },
);

test.each(runtimes)(
  'an invocation by name captures plain text under FORCE_COLOR and a declared always under %s',
  (runtime) => {
    const result = notes(runtime, 'app-always', 'invoke', [], { FORCE_COLOR: '1' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      messages: 'ℹ Saved.\n',
      output: '{"color":true}\n',
      status: 'completed',
    });
  },
);

/** The script that bundles a fixture with `Bun.build` and a define, as `loom build` does. */
const bundler = fileURLToPath(new URL('fixtures/release/bundle.mjs', import.meta.url));

test('a marked build that bakes malformed release facts prints its diagnostic with no color', () => {
  const outdir = join(directory, 'bundle');
  const bundled = spawnSync('bun', [bundler, 'color.mjs', outdir, '{"build":"staging"}'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(bundled.stderr).toBe('');
  expect(bundled.status).toBe(0);
  for (const runtime of runtimes) {
    const result = spawnSync(runtime, [join(outdir, 'color.js'), 'capture', 'tty', '--color'], {
      encoding: 'utf8',
      env: childEnvironment({ ...plain, FORCE_COLOR: '1' }),
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'The release facts baked into __LOOM_RELEASE__ hold build "staging".',
    );
    expect(styles(result.stderr).color).toBe(false);
  }
});

test.each(runtimes)(
  "an unreadable working directory's line holds no style and is unchanged by the mark under %s",
  (runtime) => {
    const read = (variant: string) =>
      invokeFromRemovedDirectory(fixture, [variant, 'tty', 'save', '--color'], {
        env: { ...plain, FORCE_COLOR: '1' },
        runtime,
      });
    const marked = read('capture');
    expect(marked.status).toBe(1);
    expect(marked.stderr).not.toContain('\u001b');
    expect(marked).toEqual(read('capture-unmarked'));
  },
);
