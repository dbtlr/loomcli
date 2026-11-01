import { spawnSync } from 'node:child_process';
/*
 * Acceptance plan for the color choice (docs/core/color.md#color).
 *
 * The color choice is proven when public APIs alone produce these results under Node and Bun,
 * through a fixture Application that marks its own option, with a host that reports a capable
 * terminal where a case says so. Each case prints through text that carries both a color and
 * `bold`: a fixture lane message styled with both, or the fixture's failure view override that
 * styles its line with both. A build declaration error is read from a development build, whose
 * Developer Diagnostic resolves through core's default styles.
 *
 * - The pair. On a capable terminal, `--no-color` prints no color escape and keeps bold, also with
 *   `FORCE_COLOR=1`. Piped, `--color` prints color escapes and no bold. `--color --no-color` prints
 *   its repetition failure with no color escape, and `--no-color --color` prints it in color. A
 *   spelling after the bare `--` changes nothing, and an alias spelling, such as `--no-colour`,
 *   works as the long spelling does.
 * - The variables. With `NO_COLOR=1`, `--color` prints color, and with `FORCE_COLOR=1`,
 *   `--no-color` prints none. With neither spelling, every byte is unchanged under each combination
 *   of the two variables, on a terminal and piped.
 * - The declared policy. `--no-color` beats `rendering: { color: 'always' }` on the Application and
 *   on `run()`, and `--color` beats `'never'` on each.
 * - Before the chain. An unknown command, a dotenv warning, a configuration source's warning, and a
 *   declaration error an `onGraphBuilt` hook raises each print with no color escape under
 *   `--no-color` on a capable terminal, and in color under `--color` piped.
 * - Host capture. On a capable terminal, a build that bakes malformed release facts prints its
 *   Developer Diagnostic with no color escape in an Application that marks an option, even under
 *   `--color` and `FORCE_COLOR=1`, and one that marks none prints it as today. An unreadable
 *   working directory's line holds no style and is unchanged byte for byte.
 * - A faulting word. `--color=x` fails with the usage failure the reference states, exit 2, and the
 *   line follows the declared policy: in color on a capable terminal, with no color escape piped,
 *   and with none under `NO_COLOR=1`.
 * - The option. `options.color` reads `true`, `false`, and the absent value for a positive
 *   spelling, a negative spelling, and neither.
 * - Declarations. Each rejected declaration the reference lists throws under
 *   `@loomcli/core/color-mark` from the moment the reference names, and the negative type checks
 *   reject the rules the types state.
 * - By name. A fixture Application's invocation by name captures plain text under `FORCE_COLOR=1`
 *   and `rendering: { color: 'always' }`. The color plugin's own option is proven in
 *   packages/plugins/tests/color.test.ts.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';
import { invoke as invokeFixture } from './run-fixture.ts';

/** The notes application, which marks its own `--[no-]color` unless a variant leaves it out. */
const fixture = new URL('fixtures/color.mjs', import.meta.url);

/** The runtimes the bundle runs under; every other case runs under the test run's runtime. */
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
async function notes(
  variant: string,
  terminal: Terminal,
  argv: string[],
  env: Record<string, string | undefined> = {},
) {
  return await invokeFixture(fixture, [variant, terminal, ...argv], {
    env: { ...plain, PROBE_CWD: directory, ...env },
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
function printed(result: { status: number | null | undefined; stderr: string }) {
  return { status: result.status, ...styles(result.stderr) };
}

test('on a capable terminal --no-color prints no color and keeps bold, under FORCE_COLOR too', async () => {
  expect(printed(await notes('marked', 'tty', ['save']))).toEqual({
    bold: true,
    color: true,
    status: 0,
  });
  expect(printed(await notes('marked', 'tty', ['save', '--no-color']))).toEqual({
    bold: true,
    color: false,
    status: 0,
  });
  expect(
    printed(await notes('marked', 'tty', ['save', '--no-color'], { FORCE_COLOR: '1' })),
  ).toEqual({
    bold: true,
    color: false,
    status: 0,
  });
});

test('piped, --color prints color and no bold', async () => {
  expect(printed(await notes('marked', 'pipe', ['save']))).toEqual({
    bold: false,
    color: false,
    status: 0,
  });
  expect(printed(await notes('marked', 'pipe', ['save', '--color']))).toEqual({
    bold: false,
    color: true,
    status: 0,
  });
});

test('the last spelling sets the color of the repetition failure it causes', async () => {
  const off = await notes('marked', 'tty', ['save', '--color', '--no-color']);
  expect(off.stderr).toContain(
    'Option "--no-color" can be supplied only once. Remove the repeated option.',
  );
  expect(printed(off)).toEqual({ bold: true, color: false, status: 2 });
  const on = await notes('marked', 'pipe', ['save', '--no-color', '--color']);
  expect(on.stderr).toContain(
    'Option "--color" can be supplied only once. Remove the repeated option.',
  );
  expect(printed(on)).toEqual({ bold: false, color: true, status: 2 });
});

test('a spelling after the bare -- changes nothing, and an alias works as the long spelling', async () => {
  expect(printed(await notes('marked', 'pipe', ['save', '--', '--color']))).toEqual({
    bold: false,
    color: false,
    status: 0,
  });
  expect(printed(await notes('marked', 'tty', ['save', '--no-color', '--', '--color']))).toEqual({
    bold: true,
    color: false,
    status: 0,
  });
  expect(printed(await notes('marked', 'tty', ['save', '--no-colour']))).toEqual({
    bold: true,
    color: false,
    status: 0,
  });
  expect(printed(await notes('marked', 'pipe', ['--colour', 'save']))).toEqual({
    bold: false,
    color: true,
    status: 0,
  });
});

test('the choice overrides NO_COLOR and FORCE_COLOR', async () => {
  expect(printed(await notes('marked', 'tty', ['save', '--color'], { NO_COLOR: '1' }))).toEqual({
    bold: true,
    color: true,
    status: 0,
  });
  expect(
    printed(await notes('marked', 'pipe', ['save', '--no-color'], { FORCE_COLOR: '1' })),
  ).toEqual({
    bold: true,
    color: false,
    status: 0,
  });
});

test('with neither spelling every byte matches the unmarked application', async () => {
  for (const terminal of ['tty', 'pipe'] as const) {
    for (const NO_COLOR of [undefined, '1']) {
      for (const FORCE_COLOR of [undefined, '1']) {
        const variables = { FORCE_COLOR, NO_COLOR };
        await expect(notes('marked', terminal, ['save'], variables)).resolves.toEqual(
          await notes('unmarked', terminal, ['save'], variables),
        );
      }
    }
  }
});

test("the choice beats the Application's and run()'s declared color", async () => {
  for (const variant of ['app-always', 'run-always']) {
    expect(printed(await notes(variant, 'tty', ['save', '--no-color']))).toEqual({
      bold: true,
      color: false,
      status: 0,
    });
  }
  for (const variant of ['app-never', 'run-never']) {
    expect(printed(await notes(variant, 'pipe', ['save']))).toEqual({
      bold: false,
      color: false,
      status: 0,
    });
    expect(printed(await notes(variant, 'pipe', ['save', '--color']))).toEqual({
      bold: false,
      color: true,
      status: 0,
    });
  }
});

test.each([
  ['an unknown command', 'marked', ['nope'], 2, 'Unknown command "nope".'],
  ['a dotenv warning', 'dotenv', ['save'], 0, 'Skipped NOTES_TOKEN on line 1 of .env'],
  ['a configuration warning', 'config', ['save'], 0, 'Skipped .notes.json'],
  ['an onGraphBuilt declaration error', 'graph', ['save'], 1, 'The judge rejects the graph.'],
] as const)('%s follows the choice', async (_name, variant, argv, status, line) => {
  const off = await notes(variant, 'tty', [...argv, '--no-color']);
  expect(off.status).toBe(status);
  expect(off.stderr).toContain(line);
  expect(styles(off.stderr).color).toBe(false);
  const on = await notes(variant, 'pipe', [...argv, '--color']);
  expect(on.status).toBe(status);
  expect(on.stderr).toContain(line);
  expect(styles(on.stderr).color).toBe(true);
});

test('a word that attaches a value supplies no choice and fails as the ordinary parse does', async () => {
  const line = 'Boolean option "--color" does not accept a value. Supply the flag alone.';
  const terminal = await notes('marked', 'tty', ['save', '--color=x']);
  expect(terminal.stderr).toContain(line);
  expect(printed(terminal)).toEqual({ bold: true, color: true, status: 2 });
  expect(printed(await notes('marked', 'pipe', ['save', '--color=x']))).toEqual({
    bold: false,
    color: false,
    status: 2,
  });
  expect(printed(await notes('marked', 'tty', ['save', '--color=x'], { NO_COLOR: '1' }))).toEqual({
    bold: true,
    color: false,
    status: 2,
  });
});

/** The value the action reads for the marked option, after the words the operator typed. */
async function typed(argv: string[]): Promise<unknown> {
  return JSON.parse(
    await notes('marked', 'tty', ['save', ...argv]).then((fixtureResult) => fixtureResult.stdout),
  );
}

test('the action reads what the operator typed, never whether color is on', async () => {
  await expect(typed(['--color'])).resolves.toEqual({ color: true });
  await expect(typed(['--no-color'])).resolves.toEqual({ color: false });
  await expect(typed([])).resolves.toEqual({ color: false });
  await expect(typed(['--colour'])).resolves.toEqual({ color: true });
});

test('an invocation by name captures plain text under FORCE_COLOR and a declared always', async () => {
  const result = await notes('app-always', 'invoke', [], { FORCE_COLOR: '1' });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    messages: 'ℹ Saved.\n',
    output: '{"color":true}\n',
    status: 'completed',
  });
});

/** The script that bundles a fixture with `Bun.build` and a define, as `loom build` does. */
const bundler = fileURLToPath(new URL('fixtures/release/bundle.mjs', import.meta.url));

test('a build that bakes malformed release facts prints its diagnostic as it did before the mark', () => {
  const outdir = join(directory, 'bundle');
  const bundled = spawnSync('bun', [bundler, 'color-process.mjs', outdir, '{"build":"staging"}'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(bundled.stderr).toBe('');
  expect(bundled.status).toBe(0);
  // Core's fallback output carries no theme, so the marked run's color off changes no byte today.
  const read = (runtime: string, variant: string) => {
    const result = spawnSync(
      runtime,
      [join(outdir, 'color-process.js'), variant, 'tty', '--color'],
      {
        encoding: 'utf8',
        env: childEnvironment({ ...plain, FORCE_COLOR: '1' }),
        timeout: 60_000,
      },
    );
    return { status: result.status, stderr: result.stderr, stdout: result.stdout };
  };
  for (const runtime of runtimes) {
    const marked = read(runtime, 'capture');
    expect(marked.status).toBe(1);
    expect(marked.stderr).toContain(
      'The release facts baked into __LOOM_RELEASE__ hold build "staging".',
    );
    expect(styles(marked.stderr).color).toBe(false);
    expect(marked).toEqual(read(runtime, 'capture-unmarked'));
  }
});

/** Runs host capture with a working-directory read that fails on this run's mock. */
function fromRemoved(variant: string) {
  return invokeFixture(fixture, [variant, 'tty', 'save', '--color'], {
    cwd: () => {
      throw new Error('ENOENT');
    },
    env: { ...plain, FORCE_COLOR: '1' },
  });
}

test("an unreadable working directory's line holds no style and is unchanged by the mark", async () => {
  const marked = await fromRemoved('capture');
  expect(marked.status).toBe(1);
  expect(marked.stderr).not.toContain('\u001b');
  expect(marked).toEqual(await fromRemoved('capture-unmarked'));
});
