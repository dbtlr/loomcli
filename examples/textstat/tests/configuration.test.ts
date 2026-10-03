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

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/main.js', import.meta.url);
const hostFixture = new URL('fixtures/config-host.mjs', import.meta.url);
const appFixture = new URL('fixtures/config-app.mjs', import.meta.url);

/**
 * One temporary workspace per test: the project directory textstat runs in, with two files to
 * count, and the directories `HOME` and `USERPROFILE` point at.
 */
interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  readonly profile: string;
  /** The built application, run in the project directory with each home variable set. */
  textstat(argv: string[], env?: Record<string, string | undefined>): ReturnType<typeof invoke>;
  /** The built application under a `win32` host, run from the temporary root. */
  windows(argv: string[]): ReturnType<typeof invoke>;
  /**
   * An application named textstat, built from public APIs, that installs the plugin with the
   * settings given, or with none, and prints the options it receives.
   */
  app(
    settings: unknown,
    argv?: string[],
    env?: Record<string, string | undefined>,
  ): ReturnType<typeof invoke>;
  /** Writes one file under a base directory, creating its directories, and answers its path. */
  write(base: string, relative: string, content: string): string;
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'loom-textstat-config-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const profile = join(root, 'profile');
  for (const directory of [project, home, profile]) {
    mkdirSync(directory);
  }
  writeFileSync(join(project, 'one.txt'), 'hello\n');
  writeFileSync(join(project, 'two.txt'), 'é');
  const variables = { HOME: home, USERPROFILE: profile };
  return {
    app: (settings, argv = [], env = {}) =>
      invoke(
        appFixture,
        [settings === undefined ? 'none' : JSON.stringify(settings), project, ...argv],
        { cwd: root, env: { ...variables, ...env } },
      ),
    home,
    profile,
    project,
    root,
    textstat: (argv, env = {}) =>
      invoke(main, argv, { cwd: project, env: { ...variables, ...env } }),
    windows: (argv) =>
      invoke(hostFixture, ['win32', project, ...argv], { cwd: root, env: variables }),
    write: (base, relative, content) => {
      const path = join(base, relative);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
  };
}

/** Runs one test body in a fresh workspace and removes it afterward. */
function inWorkspace(body: (space: Workspace) => void): () => void {
  return () => {
    const space = workspace();
    try {
      body(space);
    } finally {
      rmSync(space.root, { force: true, recursive: true });
    }
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** The options the fixture application received, parsed from the one line it prints. */
function received(result: ReturnType<typeof invoke>): unknown {
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

/** The failure one wrong value prints, then the help hint. */
function wrong(line: string): string {
  return `textstat: ${line}\n${hint}`;
}

const files = ['one.txt', 'two.txt'];
const both = 'COUNT  SOURCE\n    6  one.txt\n    2  two.txt\n';
const filtered = 'COUNT  SOURCE\n    6  one.txt\n';
const withTotal = `${both}    8  total\n`;
const filteredTotal = `${filtered}    6  total\n`;

const invalidJson = 'is not valid JSON. Correct its syntax, or remove it.';
const invalidToml = 'is not valid TOML. Correct its syntax, or remove it.';
const invalidYaml = 'is not valid YAML. Correct its syntax, or remove it.';
const notObject =
  'does not hold a JSON object. Write its settings as one JSON object, or remove it.';
const notMapping =
  'does not hold a YAML mapping. Write its settings as one YAML mapping, or remove it.';
const fixtureDefaults = { field: [], limit: 'none', 'min-bytes': 0, total: false };

test(
  'Lookup: textstat reads .textstat.toml in the working directory, then in the home directory each platform names',
  inWorkspace((space) => {
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: both });
    space.write(space.home, '.textstat.toml', 'minBytes = 5\n');
    space.write(space.profile, '.textstat.toml', 'total = true\n');
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: filtered });
    expect(space.windows(files)).toEqual({
      status: 0,
      stderr: '',
      stdout: `${withTotal}resolved:0\n`,
    });
    // A file in the working directory hides the home file, so its minBytes is not read.
    space.write(space.project, '.textstat.toml', 'total = true\n');
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: withTotal });
    // A broken file in the working directory warns, and the home file answers.
    space.write(space.project, '.textstat.toml', 'total = ');
    expect(space.textstat(files)).toEqual({
      status: 0,
      stderr: skipped('.textstat.toml', invalidToml),
      stdout: filtered,
    });
    rmSync(join(space.project, '.textstat.toml'));
    rmSync(join(space.home, '.textstat.toml'));
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: both });
  }),
);

test(
  'Lookup: config() with no settings reads .textstat.json',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 3\n');
    expect(received(space.app(undefined))).toEqual(fixtureDefaults);
    space.write(space.project, '.textstat.json', json({ minBytes: 5 }));
    expect(received(space.app(undefined))).toEqual({ ...fixtureDefaults, 'min-bytes': 5 });
  }),
);

test(
  'Precedence: TEXTSTAT_MIN_BYTES beats the file, and a flag beats both',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: filtered });
    expect(space.textstat(files, { TEXTSTAT_MIN_BYTES: '0' })).toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
    expect(space.textstat([...files, '--min-bytes', '0'], { TEXTSTAT_MIN_BYTES: '5' })).toEqual({
      status: 0,
      stderr: '',
      stdout: both,
    });
  }),
);

test(
  '--config: --config and -c name a file that answers alone, and a bad named file fails the run',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    space.write(space.project, 'pinned.json', json({ total: true }));
    for (const spelling of ['--config', '-c']) {
      expect(space.textstat([...files, spelling, 'pinned.json'])).toEqual({
        status: 0,
        stderr: '',
        stdout: withTotal,
      });
    }
    expect(space.textstat([...files, '--config', 'missing.json'])).toEqual({
      status: 2,
      stderr: namedFailure('missing.json', 'does not exist. Supply the path of an existing file.'),
      stdout: '',
    });
    space.write(space.project, 'broken.toml', 'minBytes = ');
    expect(space.textstat([...files, '-c', 'broken.toml'])).toEqual({
      status: 2,
      stderr: namedFailure(
        'broken.toml',
        'is not valid TOML. Correct its syntax, or supply another file.',
      ),
      stdout: '',
    });
    space.write(space.project, 'list.json', '[]');
    expect(space.textstat([...files, '--config', 'list.json'])).toEqual({
      status: 2,
      stderr: namedFailure(
        'list.json',
        'does not hold a JSON object. Write its settings as one JSON object.',
      ),
      stdout: '',
    });
    const help = space.textstat(['--config', 'missing.json', '--help']);
    expect(help).toMatchObject({ status: 0, stderr: '' });
    expect(help.stdout.startsWith('textstat')).toBe(true);
    // Every bound option is filled from argv, so no file is read and the bad name never surfaces.
    expect(
      space.textstat([...files, '--config', 'missing.json', '--min-bytes', '0', '--total']),
    ).toEqual({ status: 0, stderr: '', stdout: withTotal });
  }),
);

test(
  'Discovered files: a missing file is silent, and a broken one warns once and the run exits 0',
  inWorkspace((space) => {
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: both });
    mkdirSync(join(space.project, '.textstat.json'));
    expect(space.textstat(files)).toEqual({
      status: 0,
      stderr: skipped('.textstat.json', 'could not be read. Make it readable, or remove it.'),
      stdout: both,
    });
    rmSync(join(space.project, '.textstat.json'), { recursive: true });
    const broken: readonly (readonly [string, string])[] = [
      ['', invalidJson],
      ['{"minBytes": ', invalidJson],
      ['[5]', notObject],
    ];
    for (const [content, clause] of broken) {
      space.write(space.project, '.textstat.json', content);
      expect(space.textstat(files)).toEqual({
        status: 0,
        stderr: skipped('.textstat.json', clause),
        stdout: both,
      });
    }
    rmSync(join(space.project, '.textstat.json'));
    const home = space.write(space.home, '.textstat.json', 'null');
    const help = space.textstat(['--help']);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe(skipped(home, notObject));
    expect(help.stdout.startsWith('textstat')).toBe(true);
  }),
);

test(
  'Formats: TOML, YAML, an extensionless file, and .textstat.conf each fill under a file that names them',
  inWorkspace((space) => {
    const formats: readonly (readonly [string, string])[] = [
      ['.textstat.toml', 'minBytes = 5\ntotal = true\n'],
      ['.textstat.yaml', 'minBytes: 5\ntotal: true\n'],
      ['.textstatrc', json({ minBytes: 5, total: true })],
      ['.textstat.conf', json({ minBytes: 5, total: true })],
    ];
    for (const [file, content] of formats) {
      space.write(space.project, file, content);
      expect(received(space.app({ file }))).toEqual({
        ...fixtureDefaults,
        'min-bytes': 5,
        total: true,
      });
    }
    // A --config file reads by its extension.
    expect(space.textstat([...files, '--config', '.textstat.yaml'])).toEqual({
      status: 0,
      stderr: '',
      stdout: filteredTotal,
    });
  }),
);

test(
  'Formats: with .textstat.toml and .textstat.json in one directory, the TOML file answers and one warning prints',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    space.write(space.project, '.textstat.json', json({ total: true }));
    expect(space.textstat(files)).toEqual({
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
  inWorkspace((space) => {
    const env = { HOME: space.home, USERPROFILE: space.profile };
    const run = (bundle: URL, argv: string[] = []) =>
      invoke(bundle, [...files, ...argv], { cwd: space.project, env });
    const neither = strippedBundle(space, 'neither', ['toml', 'yaml']);
    space.write(space.project, '.textstat.json', json({ minBytes: 5 }));
    expect(run(neither)).toEqual({ status: 0, stderr: '', stdout: filtered });
    // The same copy fails to load its source on a TOML file, so the removed chunks held a parser.
    rmSync(join(space.project, '.textstat.json'));
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    expect(run(neither)).toEqual({
      status: 1,
      stderr: 'textstat: Something went wrong.\n',
      stdout: '',
    });
    // A TOML run loads no YAML parser, and a YAML run no TOML parser.
    expect(run(strippedBundle(space, 'toml-only', ['yaml']))).toEqual({
      status: 0,
      stderr: '',
      stdout: filtered,
    });
    space.write(space.project, 'settings.yaml', 'minBytes: 5\n');
    expect(
      run(strippedBundle(space, 'yaml-only', ['toml']), ['--config', 'settings.yaml']),
    ).toEqual({ status: 0, stderr: '', stdout: filtered });
  }),
);

test(
  'Formats: broken TOML and YAML files warn when discovered and fail with code 2 when named',
  inWorkspace((space) => {
    const yamlFaults = [
      'minBytes: [',
      '',
      'minBytes: 1\n---\nminBytes: 2\n',
      'minBytes: !!binary aGk=\n',
    ];
    space.write(space.project, '.textstat.toml', 'minBytes = ');
    expect(space.textstat(files)).toEqual({
      status: 0,
      stderr: skipped('.textstat.toml', invalidToml),
      stdout: both,
    });
    expect(space.textstat([...files, '--config', '.textstat.toml'])).toMatchObject({
      status: 2,
      stderr: namedFailure(
        '.textstat.toml',
        'is not valid TOML. Correct its syntax, or supply another file.',
      ),
    });
    for (const content of yamlFaults) {
      space.write(space.project, '.textstat.yaml', content);
      const empty = content === '';
      expect(space.app({ file: '.textstat.yaml' })).toMatchObject({
        status: 0,
        stderr: skipped('.textstat.yaml', empty ? notMapping : invalidYaml),
      });
      expect(space.textstat([...files, '--config', '.textstat.yaml'])).toMatchObject({
        status: 2,
        stderr: namedFailure(
          '.textstat.yaml',
          empty
            ? 'does not hold a YAML mapping. Write its settings as one YAML mapping.'
            : 'is not valid YAML. Correct its syntax, or supply another file.',
        ),
      });
    }
  }),
);

test(
  'Values: a number fills as its text, and a value the option cannot take is a wrong value',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.toml', 'minBytes = 5\n');
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: filtered });
    space.write(space.project, '.textstat.toml', 'total = "yes"\n');
    expect(space.textstat(files)).toEqual({
      status: 2,
      stderr: wrong('Option "--total" (from total in .textstat.toml): Use true or false.'),
      stdout: '',
    });
    space.write(space.project, '.textstat.toml', '[minBytes]\nmax = 5\n');
    expect(space.textstat(files)).toEqual({
      status: 2,
      stderr: wrong(
        'Option "--min-bytes" (from minBytes in .textstat.toml): Use a string or a number.',
      ),
      stdout: '',
    });
    space.write(space.project, 'settings.yaml', 'total: no\n');
    expect(space.textstat([...files, '--config', 'settings.yaml'])).toEqual({
      status: 2,
      stderr: wrong('Option "--total" (from total in settings.yaml): Use true or false.'),
      stdout: '',
    });
  }),
);

test(
  'Values: a multiple option reads an array, and a TOML date, time, and large integer fill as written',
  inWorkspace((space) => {
    const toml = { file: '.textstat.toml' };
    space.write(space.project, '.textstat.toml', 'fields = ["a", 2]\n');
    expect(received(space.app(toml))).toEqual({ ...fixtureDefaults, field: ['a', '2'] });
    space.write(space.project, '.textstat.toml', 'fields = []\n');
    expect(received(space.app(toml))).toEqual(fixtureDefaults);
    space.write(space.project, '.textstat.toml', 'fields = ["a", {}]\n');
    expect(space.app(toml)).toMatchObject({
      status: 2,
      stderr:
        'textstat: Option "--field" (from fields in .textstat.toml) at 1: Use a string or a number.\n',
    });
    for (const note of [
      '1979-05-27',
      '1979-05-27 07:32:00',
      '07:32:00.5',
      '12345678901234567890',
    ]) {
      space.write(space.project, '.textstat.toml', `note = ${note}\n`);
      expect(received(space.app(toml))).toEqual({ ...fixtureDefaults, note });
    }
  }),
);

test(
  'Paths: a path that meets a non-object leaves the option to its default, and a bad path throws at the call',
  inWorkspace((space) => {
    space.write(space.project, '.textstat.json', json({ limits: 5 }));
    expect(received(space.app(undefined))).toEqual(fixtureDefaults);
    expect(space.app(undefined, [], { FIXTURE_PATH: 'a..b' }).stdout).toBe(
      'DeclarationError: @loomcli/core/invalid-extension-value\n',
    );
  }),
);

test(
  'Escaping: a control character in a --config path and a home directory prints as its escape',
  inWorkspace((space) => {
    const escape = String.fromCodePoint(27);
    const named = `esc${escape}ape`;
    expect(space.textstat([...files, '--config', named]).stderr).toBe(
      namedFailure(
        String.raw`esc\u001bape`,
        'does not exist. Supply the path of an existing file.',
      ),
    );
    space.write(space.project, named, json({ minBytes: 'x' }));
    expect(space.textstat([...files, '--config', named]).stderr).toMatch(
      /^textstat: Option "--min-bytes" \(from minBytes in esc\\u001bape\): /u,
    );
    const home = join(space.root, `h${escape}ome`);
    space.write(home, '.textstat.json', '[]');
    expect(space.textstat(files, { HOME: home }).stderr).toBe(
      skipped(join(space.root, String.raw`h\u001bome`, '.textstat.json'), notObject),
    );
  }),
);

test(
  'Edges: a bad file pattern or short spelling throws from config() under its rule',
  inWorkspace((space) => {
    const cases: readonly (readonly [unknown, string])[] = [
      [{ file: '/etc/textstat.json' }, '@loomcli/plugins/config/file-path'],
      [{ file: '*.json' }, '@loomcli/plugins/config/file-pattern'],
      [{ file: '.textstat.{toml,ini}' }, '@loomcli/plugins/config/file-pattern'],
      [{ short: 'cc' }, '@loomcli/core/short-alias'],
    ];
    for (const [settings, rule] of cases) {
      expect(space.app(settings).stdout).toBe(`DeclarationError: ${rule}\n`);
    }
  }),
);

test(
  'Edges: a byte order mark reads, two wrong values print two lines, and the home label is a full path',
  inWorkspace((space) => {
    space.write(
      space.project,
      '.textstat.json',
      `${String.fromCodePoint(65_279)}${json({ minBytes: 5 })}`,
    );
    expect(space.textstat(files)).toEqual({ status: 0, stderr: '', stdout: filtered });
    space.write(space.project, '.textstat.json', json({ minBytes: {}, total: 'yes' }));
    expect(space.textstat(files)).toEqual({
      status: 2,
      stderr: [
        'textstat: Option "--min-bytes" (from minBytes in .textstat.json): Use a string or a number.',
        'textstat: Option "--total" (from total in .textstat.json): Use true or false.',
        hint,
      ].join('\n'),
      stdout: '',
    });
    rmSync(join(space.project, '.textstat.json'));
    const home = space.write(space.home, '.textstat.toml', 'minBytes = -1\n');
    expect(space.textstat(files).stderr).toContain(`(from minBytes in ${home})`);
  }),
);

test(
  'Edges: a source InputError reaches an InputError view override, and a local structure fault outranks it',
  inWorkspace((space) => {
    expect(
      space.app(undefined, ['--config', 'missing.json'], { FIXTURE_VIEWS: 'input' }).stderr,
    ).toBe(
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
    expect(space.textstat([...files, '--config', 'missing.json', '--metric'])).toEqual({
      status: 2,
      stderr: `textstat: Option "--metric" requires a value. Supply a value after "--metric".\n${hint}`,
      stdout: '',
    });
  }),
);
