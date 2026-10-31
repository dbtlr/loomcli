/*
 * Acceptance plan for the configuration plugin (docs/plugins/config.md#configuration-plugin).
 *
 * The configuration plugin is proven when textstat installs
 * `configuration({ file: '.textstat.{toml,json}', schema, short: 'c' })` and binds `--min-bytes` to `minBytes` and
 * `--total` to `total`, and public APIs alone produce these results under Node and Bun, with `HOME`
 * pointed at a temporary directory through `host.env`:
 *
 * - Lookup. textstat reads `minBytes` from `.textstat.toml` in `host.cwd`, from
 *   `<HOME>/.textstat.toml` when the working directory holds no candidate, and from no file when
 *   neither directory holds one. A file in the working directory hides the home file entirely, so a
 *   key only the home file holds is not read, and a broken file in the working directory warns and
 *   no later location answers. `configuration()` with only a schema reads `.textstat.json`.
 * - Precedence. `TEXTSTAT_MIN_BYTES` beats the file, and a flag beats both.
 * - `--config`. `--config` and `-c` each name a file that answers alone, so a file in the working
 *   directory is not read. A named file that does not exist, is not valid in its format, or holds
 *   an array prints its failure with code 2, reports nothing under `--help`, and a run that fills
 *   every bound option from argv reads no file and exits 0.
 * - `--no-config`. A run with `--no-config` reads neither the working directory's file nor the
 *   home file, and `--no-config` beside `--config` fails with code 2.
 * - Discovered files. A missing file prints nothing. A directory in its place, an empty JSON file,
 *   invalid JSON, and a top-level array each print one warning and the run exits 0, and a broken
 *   home file under `--help` prints its warning before the page. A file that does not parse names
 *   the line and column where it breaks, in the warning and in the `--config` failure.
 * - Formats. `.textstat.toml`, `.textstat.yaml`, an extensionless file, and `.textstat.conf` each
 *   fill `--min-bytes` and `--total` under a `file` that names them, the last two as JSON, and a
 *   `--config` file reads by its extension. With `.textstat.toml` and `.textstat.json` both in one
 *   directory, the TOML file answers and the several-candidates warning prints once, a
 *   `.textstat.json` with comments and a trailing comma fills, and a run
 *   whose file is JSON loads neither parser. A broken TOML file, a broken YAML file, an empty YAML
 *   file, and a YAML file with a second document or a `!!binary` tag each print their warning when
 *   discovered and fail with code 2 when named.
 * - Values. A counted option in a fixture reads `3` as `3` and `0` as `0`, and `"3"`, `-1`, and
 *   `1.5` are not answered, and the option takes its default. `5` fills `--min-bytes` as `"5"`, a
 *   string for `--total` and an object for `--min-bytes` are dropped by the schema and fill
 *   nothing, with exit code 0, and a multiple option in a fixture reads an array and an empty
 *   array, and an array with an object at position 1 fills nothing.
 *   A TOML date and a local time with one fractional digit fill their text as written, a TOML
 *   integer beyond the safe range fills its exact digits, and a YAML `no` for `--total` fills
 *   nothing.
 * - Paths. `"limits": 5` leaves `limits.bytes` unanswered, so the option takes its default, and
 *   `configInput({ path: 'a..b' })` throws at the call.
 * - Escaping. A `--config` path that holds U+001B prints it as `\u001b` in its failure and in the
 *   label of a filled value a validator rejects, and a home directory that holds it prints it as
 *   `\u001b` in its warning.
 * - Edges. `configuration({ file: '/etc/textstat.json' })`, `configuration({ file: '*.json' })`, and
 *   `configuration({ file: '.textstat.{toml,ini}' })` throw from `configuration()` under their rules, a file that
 *   starts with a byte order mark reads, two wrong values fill nothing and print nothing, the
 *   `problems` of a source `InputError` reach an override of the `InputError` view, and a local
 *   structure fault outranks a source `InputError`.
 * - Packed consumers. A consumer installs the packed pack, imports `@loomcli/plugins/config` and
 *   `@loomcli/plugins/config/extension`, compiles against their declarations, and reads a value
 *   from a file.
 */

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DeclarationError } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { configApp } from './fixtures/config-app.js';
import type { Choices, Settings } from './fixtures/config-app.js';
import { run } from './run.js';

/** What one run left behind: its status, and everything it wrote to each stream. */
type Result = Awaited<ReturnType<typeof run>>;

/**
 * Runs the fixture application the choices describe in this process, with the argv and the
 * environment a case gives and `project` as the host's working directory. A fault at a call
 * prints its rule, as an application's own run would fail.
 */
async function runApp(
  choices: Choices,
  argv: string[],
  project: string,
  env: Record<string, string | undefined>,
): Promise<Result> {
  const mock = mockProcess({ argv, cwd: project, env });
  try {
    const status = await configApp(choices).run({ process: mock });
    return { status, stderr: mock.stderr.text, stdout: mock.stdout.text };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    const rule = error instanceof DeclarationError ? error.rule?.identity : undefined;
    return { status: undefined, stderr: '', stdout: `${error.name}: ${rule ?? error.message}\n` };
  }
}

/**
 * One temporary workspace per test: the project directory textstat runs in, with two files to
 * count, and the directory `HOME` points at.
 */
interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  /** The built application, run in the project directory with `HOME` set. */
  textstat(argv: string[], env?: Record<string, string | undefined>): Promise<Result>;
  /**
   * An application named textstat, built from public APIs, that installs the plugin with the
   * settings given, or with none, and prints the options it receives.
   */
  app(
    settings: Choices['settings'],
    argv?: string[],
    env?: Record<string, string | undefined>,
  ): Promise<Result>;
  /** Writes one file under a base directory, creating its directories, and answers its path. */
  write(base: string, relative: string, content: string): string;
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'loom-textstat-config-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  for (const directory of [project, home]) {
    mkdirSync(directory);
  }
  writeFileSync(join(project, 'one.txt'), 'hello\n');
  writeFileSync(join(project, 'two.txt'), 'é');
  const variables = { HOME: home };
  return {
    app: (settings, argv = [], env = {}) => {
      const { FIXTURE_PATH, FIXTURE_VIEWS, ...own } = env;
      return runApp(
        {
          ...(FIXTURE_PATH === undefined ? {} : { limitPath: FIXTURE_PATH }),
          ...(settings === undefined ? {} : { settings }),
          ...(FIXTURE_VIEWS === 'input' ? { view: 'input' } : {}),
        },
        argv,
        project,
        { ...variables, ...own },
      );
    },
    home,
    project,
    root,
    textstat: (argv, env = {}) => run(argv, { cwd: project, env: { ...variables, ...env } }),
    write: (base, relative, content) => {
      const path = join(base, relative);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
  };
}

/** Runs one test body in a fresh workspace and removes it afterward. */
function inWorkspace(body: (space: Workspace) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const space = workspace();
    try {
      await body(space);
    } finally {
      rmSync(space.root, { force: true, recursive: true });
    }
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** The options the fixture application received, parsed from the one line it prints. */
function received(result: Result): unknown {
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return JSON.parse(result.stdout);
}

const hint = 'Run "textstat --help" to see the usage.\n';

/** The failure the named file prints for one clause and its fix, then the help hint. */
function namedFailure(path: string, clause: string): string {
  return `textstat: Option "--config": File "${path}" ${clause}\n${hint}`;
}

/** The warning a discovered file prints for one clause and its fix. */
function skipped(file: string, clause: string): string {
  return `⚠ Skipped ${file}: the file ${clause}\n`;
}

const files = ['one.txt', 'two.txt'];
const both = 'COUNT  SOURCE\n    6  one.txt\n    2  two.txt\n    0  stdin\n';
const filtered = 'COUNT  SOURCE\n    6  one.txt\n';
const withTotal = `${both}    8  total\n`;
const filteredTotal = `${filtered}    6  total\n`;

/** The clause of a discovered file that does not parse, at the line and column where it breaks. */
const invalidJson = (at: string) =>
  `is not valid JSON at ${at}, so this run reads no configuration. Correct its syntax, or remove it.`;
const invalidToml = (at: string) =>
  `is not valid TOML at ${at}, so this run reads no configuration. Correct its syntax, or remove it.`;
const invalidYaml = (at: string) =>
  `is not valid YAML at ${at}, so this run reads no configuration. Correct its syntax, or remove it.`;
const notObject =
  'does not hold a JSON object, so this run reads no configuration. Write its settings as one JSON object, or remove it.';
const notMapping =
  'does not hold a YAML mapping, so this run reads no configuration. Write its settings as one YAML mapping, or remove it.';
const fixtureDefaults = {
  field: [],
  limit: 'none',
  'min-bytes': 0,
  'no-config': false,
  total: false,
};

test(
  'Lookup: textstat reads .textstat.toml in the working directory, then in the home directory',
  inWorkspace(async (space) => {
    await expect(space.textstat(files)).resolves.toEqual({ status: 0, stderr: '', stdout: both });
    space.write(space.home, '.textstat.toml', 'minBytes = 5\n');
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: filtered,
    });
    // A file in the working directory hides the home file, so its minBytes is not read.
    space.write(space.project, '.textstat.toml', 'total = true\n');
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: withTotal,
    });
    // A broken file in the working directory warns, and the home file does not answer.
    space.write(space.project, '.textstat.toml', 'total = ');
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: skipped('.textstat.toml', invalidToml('line 1, column 9')),
      stdout: both,
    });
    rmSync(join(space.project, '.textstat.toml'));
    rmSync(join(space.home, '.textstat.toml'));
    await expect(space.textstat(files)).resolves.toEqual({ status: 0, stderr: '', stdout: both });
  }),
);

test(
  'Lookup: configuration() with only a schema reads .textstat.json',
  inWorkspace(async (space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 3\n');
    expect(received(await space.app(undefined))).toEqual(fixtureDefaults);
    space.write(space.project, '.textstat.json', json({ minBytes: 5 }));
    expect(received(await space.app(undefined))).toEqual({ ...fixtureDefaults, 'min-bytes': 5 });
  }),
);

test(
  'Precedence: TEXTSTAT_MIN_BYTES beats the file, and a flag beats both',
  inWorkspace(async (space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: filtered,
    });
    await expect(space.textstat(files, { TEXTSTAT_MIN_BYTES: '0' })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
    await expect(
      space.textstat([...files, '--min-bytes', '0'], { TEXTSTAT_MIN_BYTES: '5' }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
  }),
);

test(
  '--config: --config and -c name a file that answers alone, and a bad named file fails the run',
  inWorkspace(async (space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    space.write(space.project, 'pinned.json', json({ total: true }));
    for (const spelling of ['--config', '-c']) {
      await expect(space.textstat([...files, spelling, 'pinned.json'])).resolves.toEqual({
        status: 0,
        stderr: '',
        stdout: withTotal,
      });
    }
    await expect(space.textstat([...files, '--config', 'missing.json'])).resolves.toEqual({
      status: 2,
      stderr: namedFailure('missing.json', 'does not exist. Supply the path of an existing file.'),
      stdout: '',
    });
    space.write(space.project, 'broken.toml', 'minBytes = ');
    await expect(space.textstat([...files, '-c', 'broken.toml'])).resolves.toEqual({
      status: 2,
      stderr: namedFailure(
        'broken.toml',
        'is not valid TOML at line 1, column 12. Correct its syntax, or supply another file.',
      ),
      stdout: '',
    });
    space.write(space.project, 'list.json', '[]');
    await expect(space.textstat([...files, '--config', 'list.json'])).resolves.toEqual({
      status: 2,
      stderr: namedFailure(
        'list.json',
        'does not hold a JSON object. Write its settings as one JSON object.',
      ),
      stdout: '',
    });
    const help = await space.textstat(['--config', 'missing.json', '--help']);
    expect(help).toMatchObject({ status: 0, stderr: '' });
    expect(help.stdout.startsWith('textstat')).toBe(true);
    // Every bound option is filled from argv, so no file is read and the bad name never surfaces.
    await expect(
      space.textstat([...files, '--config', 'missing.json', '--min-bytes', '0', '--total']),
    ).resolves.toEqual({ status: 0, stderr: '', stdout: withTotal });
  }),
);

test(
  '--no-config: a run reads no file, and --no-config beside --config fails with code 2',
  inWorkspace(async (space) => {
    space.write(space.project, '.textstat.toml', 'total = true\n');
    space.write(space.home, '.textstat.toml', 'minBytes = 5\n');
    await expect(space.textstat([...files, '--no-config'])).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
    rmSync(join(space.project, '.textstat.toml'));
    await expect(space.textstat([...files, '--no-config'])).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
    space.write(space.project, 'pinned.json', json({ total: true }));
    await expect(space.textstat([...files, '--no-config', '-c', 'pinned.json'])).resolves.toEqual({
      status: 2,
      stderr: `textstat: Options "--config" and "--no-config" cannot be used together. Supply only one of them.\n${hint}`,
      stdout: '',
    });
  }),
);

test(
  "Mixed groups: -tc reads -t as the root's total and -c as the configuration plugin's --config",
  inWorkspace(async (space) => {
    space.write(space.project, 'pinned.toml', 'minBytes = 5\n');
    await expect(space.textstat(['-tc', 'pinned.toml', ...files])).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: filteredTotal,
    });
    await expect(space.textstat(['-tcpinned.toml', ...files])).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: filteredTotal,
    });
  }),
);

test(
  'Discovered files: a missing file is silent, and a broken one warns once and the run exits 0',
  inWorkspace(async (space) => {
    await expect(space.textstat(files)).resolves.toEqual({ status: 0, stderr: '', stdout: both });
    mkdirSync(join(space.project, '.textstat.json'));
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: skipped(
        '.textstat.json',
        'could not be read, so this run reads no configuration. Make it readable, or remove it.',
      ),
      stdout: both,
    });
    rmSync(join(space.project, '.textstat.json'), { recursive: true });
    const broken: readonly (readonly [string, string])[] = [
      ['', invalidJson('line 1, column 1')],
      ['{"minBytes": ', invalidJson('line 1, column 14')],
      ['[5]', notObject],
    ];
    for (const [content, clause] of broken) {
      space.write(space.project, '.textstat.json', content);
      await expect(space.textstat(files)).resolves.toEqual({
        status: 0,
        stderr: skipped('.textstat.json', clause),
        stdout: both,
      });
    }
    rmSync(join(space.project, '.textstat.json'));
    const home = space.write(space.home, '.textstat.json', 'null');
    const help = await space.textstat(['--help']);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe(skipped(home, notObject));
    expect(help.stdout.startsWith('textstat')).toBe(true);
  }),
);

test(
  'Formats: TOML, YAML, an extensionless file, .textstat.conf, and JSON with comments each fill under a file that names them',
  inWorkspace(async (space) => {
    const formats: readonly (readonly [string, string])[] = [
      ['.textstat.toml', 'minBytes = 5\ntotal = true\n'],
      ['.textstat.yaml', 'minBytes: 5\ntotal: true\n'],
      ['.textstatrc', json({ minBytes: 5, total: true })],
      ['.textstat.conf', json({ minBytes: 5, total: true })],
      [
        '.textstat.json',
        '{\n  // Skip empty files.\n  "minBytes": 5,\n  /* Sum the rows. */ "total": true,\n}\n',
      ],
    ];
    for (const [file, content] of formats) {
      space.write(space.project, file, content);
      expect(received(await space.app({ file }))).toEqual({
        ...fixtureDefaults,
        'min-bytes': 5,
        total: true,
      });
    }
    // A --config file reads by its extension.
    await expect(space.textstat([...files, '--config', '.textstat.yaml'])).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: filteredTotal,
    });
  }),
);

test(
  'Formats: with .textstat.toml and .textstat.json in one directory, the TOML file answers and one warning prints',
  inWorkspace(async (space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    space.write(space.project, '.textstat.json', json({ total: true }));
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr:
        '⚠ Skipped .textstat.json: .textstat.toml matches the same pattern first. Keep one of the files, and remove the others.\n',
      stdout: filtered,
    });
  }),
);

/** The text that marks the one bundle chunk holding each parser package's code. */
const parserMarkers = { toml: 'Squirrel Chat', yaml: 'YAMLParseError' };

/**
 * A copy of the built bundle under a directory of its own, without the chunk that holds each
 * parser named. Exactly one chunk holds each parser's code. Answers the copy's entry point.
 */
function strippedBundle(
  space: Workspace,
  name: string,
  removed: readonly (keyof typeof parserMarkers)[],
): URL {
  const bundle = join(space.root, name);
  cpSync(fileURLToPath(new URL('../dist', import.meta.url)), bundle, { recursive: true });
  const chunks = readdirSync(bundle).map((chunk) => ({
    chunk,
    text: readFileSync(join(bundle, chunk), 'utf8'),
  }));
  for (const parser of removed) {
    const holding = chunks.filter(({ text }) => text.includes(parserMarkers[parser]));
    expect(holding).toHaveLength(1);
    for (const { chunk } of holding) {
      rmSync(join(bundle, chunk));
    }
  }
  return pathToFileURL(join(bundle, 'main.js'));
}

test(
  'Formats: a run whose file is JSON loads neither parser, and each format loads only its own',
  inWorkspace(async (space) => {
    const env = { HOME: space.home };
    const runBundle = (bundle: URL, argv: string[] = []) =>
      invoke(bundle, [...files, ...argv], { cwd: space.project, env });
    const neither = strippedBundle(space, 'neither', ['toml', 'yaml']);
    space.write(space.project, '.textstat.json', json({ minBytes: 5 }));
    expect(runBundle(neither)).toEqual({ status: 0, stderr: '', stdout: filtered });
    // The same copy fails to load its source on a TOML file, so the removed chunks held a parser.
    rmSync(join(space.project, '.textstat.json'));
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    expect(runBundle(neither)).toEqual({
      status: 1,
      stderr: 'textstat: Something went wrong.\n',
      stdout: '',
    });
    // A TOML run loads no YAML parser, and a YAML run no TOML parser.
    expect(runBundle(strippedBundle(space, 'toml-only', ['yaml']))).toEqual({
      status: 0,
      stderr: '',
      stdout: filtered,
    });
    space.write(space.project, 'settings.yaml', 'minBytes: 5\n');
    expect(
      runBundle(strippedBundle(space, 'yaml-only', ['toml']), ['--config', 'settings.yaml']),
    ).toEqual({ status: 0, stderr: '', stdout: filtered });
  }),
);

test(
  'Formats: broken TOML and YAML files warn when discovered and fail with code 2 when named',
  inWorkspace(async (space) => {
    const yamlFaults: readonly (readonly [string, string | undefined])[] = [
      ['minBytes: [', 'line 1, column 12'],
      ['', undefined],
      ['minBytes: 1\n---\nminBytes: 2\n', 'line 2, column 1'],
      ['minBytes: !!binary aGk=\n', 'line 1, column 11'],
    ];
    space.write(space.project, '.textstat.toml', 'minBytes = ');
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: skipped('.textstat.toml', invalidToml('line 1, column 12')),
      stdout: both,
    });
    await expect(space.textstat([...files, '--config', '.textstat.toml'])).resolves.toMatchObject({
      status: 2,
      stderr: namedFailure(
        '.textstat.toml',
        'is not valid TOML at line 1, column 12. Correct its syntax, or supply another file.',
      ),
    });
    for (const [content, at] of yamlFaults) {
      space.write(space.project, '.textstat.yaml', content);
      await expect(space.app({ file: '.textstat.yaml' })).resolves.toMatchObject({
        status: 0,
        stderr: skipped('.textstat.yaml', at === undefined ? notMapping : invalidYaml(at)),
      });
      await expect(space.textstat([...files, '--config', '.textstat.yaml'])).resolves.toMatchObject(
        {
          status: 2,
          stderr: namedFailure(
            '.textstat.yaml',
            at === undefined
              ? 'does not hold a YAML mapping. Write its settings as one YAML mapping.'
              : `is not valid YAML at ${at}. Correct its syntax, or supply another file.`,
          ),
        },
      );
    }
  }),
);

test(
  'Values: a number fills as its text, and a value the option cannot take fills nothing and fails nothing',
  inWorkspace(async (space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: filtered,
    });
    space.write(space.project, '.textstat.toml', 'total = "yes"\n');
    await expect(space.textstat(files)).resolves.toEqual({ status: 0, stderr: '', stdout: both });
    space.write(space.project, '.textstat.toml', '[minBytes]\nmax = 5\n');
    await expect(space.textstat(files)).resolves.toEqual({ status: 0, stderr: '', stdout: both });
    space.write(space.project, 'settings.yaml', 'total: no\n');
    await expect(space.textstat([...files, '--config', 'settings.yaml'])).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
  }),
);

test(
  'Values: a multiple option reads an array, and a TOML date and time fill as written',
  inWorkspace(async (space) => {
    const toml = { file: '.textstat.toml' };
    space.write(space.project, '.textstat.toml', 'fields = ["a", 2]\n');
    expect(received(await space.app(toml))).toEqual({ ...fixtureDefaults, field: ['a', '2'] });
    space.write(space.project, '.textstat.toml', 'fields = []\n');
    expect(received(await space.app(toml))).toEqual(fixtureDefaults);
    space.write(space.project, '.textstat.toml', 'fields = ["a", {}]\n');
    expect(received(await space.app(toml))).toEqual(fixtureDefaults);
    for (const note of ['1979-05-27', '1979-05-27 07:32:00', '07:32:00.5']) {
      space.write(space.project, '.textstat.toml', `note = ${note}\n`);
      expect(received(await space.app(toml))).toEqual({ ...fixtureDefaults, note });
    }
  }),
);

test(
  'Paths: a path that meets a non-object leaves the option to its default, and a bad path throws at the call',
  inWorkspace(async (space) => {
    space.write(space.project, '.textstat.json', json({ limits: 5 }));
    expect(received(await space.app(undefined))).toEqual(fixtureDefaults);
    const { stdout } = await space.app(undefined, [], { FIXTURE_PATH: 'a..b' });
    expect(stdout).toBe('DeclarationError: @loomcli/core/invalid-extension-value\n');
  }),
);

test(
  'Escaping: a control character in a --config path prints as its escape',
  inWorkspace(async (space) => {
    const escape = String.fromCodePoint(27);
    const named = `esc${escape}ape`;
    const { stderr } = await space.textstat([...files, '--config', named]);
    expect(stderr).toBe(
      namedFailure(
        String.raw`esc\u001bape`,
        'does not exist. Supply the path of an existing file.',
      ),
    );
  }),
);

test(
  'Edges: a bad file pattern throws from configuration() under its rule',
  inWorkspace(async (space) => {
    const cases: readonly (readonly [Settings, string])[] = [
      [{ file: '/etc/textstat.json' }, '@loomcli/plugins/config/file-path'],
      [{ file: '*.json' }, '@loomcli/plugins/config/file-pattern'],
      [{ file: '.textstat.{toml,ini}' }, '@loomcli/plugins/config/file-pattern'],
    ];
    for (const [settings, rule] of cases) {
      const { stdout } = await space.app(settings);
      expect(stdout).toBe(`DeclarationError: ${rule}\n`);
    }
  }),
);

test(
  'Edges: a byte order mark reads, and two values the options cannot take fill nothing and print nothing',
  inWorkspace(async (space) => {
    space.write(
      space.project,
      '.textstat.json',
      `${String.fromCodePoint(65_279)}${json({ minBytes: 5 })}`,
    );
    await expect(space.textstat(files)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: filtered,
    });
    space.write(space.project, '.textstat.json', json({ minBytes: {}, total: 'yes' }));
    await expect(space.textstat(files)).resolves.toEqual({ status: 0, stderr: '', stdout: both });
  }),
);

test(
  'Edges: a source InputError reaches an InputError view override, and a local structure fault outranks it',
  inWorkspace(async (space) => {
    const { stderr } = await space.app(undefined, ['--config', 'missing.json'], {
      FIXTURE_VIEWS: 'input',
    });
    expect(stderr).toBe(
      `${json([
        {
          input: { global: true, kind: 'option', name: 'config' },
          issues: [
            { message: 'File "missing.json" does not exist. Supply the path of an existing file.' },
          ],
          reason: 'invalid',
          spelling: '--config',
        },
      ])}\n`,
    );
    await expect(
      space.textstat([...files, '--config', 'missing.json', '--metric']),
    ).resolves.toEqual({
      status: 2,
      stderr: `textstat: Option "--metric" requires a value. Supply a value after "--metric".\n${hint}`,
      stdout: '',
    });
  }),
);
