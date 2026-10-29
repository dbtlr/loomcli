// Acceptance plan: see examples/textstat/tests/configuration.test.ts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, DeclarationError, InputError, override } from '@loomcli/core';
import type { InvocationValues, Plugin, StandardSchemaV1 } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import type { ConfigurationSettings } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { mockProcess } from '@loomcli/testing';
import { number, object, optional } from 'valibot';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { dropUntilPasses } from '../src/config/drop.js';
import { isRecord } from '../src/plain-data.js';
import { inspected as inspectGraph, invoked, run as runInProcess } from './fixtures/config-run.ts';
import type { Declared, SchemaName, Settings } from './fixtures/config-run.ts';
import { settingsFault } from './fixtures/config-settings.ts';

/**
 * The fixture for the two cases that keep a process: one proves the run never reads the process's
 * own working directory, and one proves the YAML reader leaves the real process's debug variables
 * alone. Every other case runs in this process on a mock process (ADR-0107).
 */
const processFixture = new URL('fixtures/config-process.mjs', import.meta.url);

/** What a case reads back: the status the run set, and what it wrote. */
interface Result {
  readonly status: number | null | undefined;
  readonly stderr: string;
  readonly stdout: string;
}

/** The key under which a test's environment carries the plugin's settings, typed. */
const settingsKey = Symbol('settings');

/** A test's environment, which may also carry the settings the plugin is installed with. */
type Overrides = Record<string, string | undefined> & { [settingsKey]?: Settings };

/** The names of the environment entries that configure the fixture application, not the run. */
const fixtureNames = new Set([
  'FIXTURE_CWD',
  'FIXTURE_LIMIT_PATH',
  'FIXTURE_LOUD',
  'FIXTURE_PROVIDED',
  'FIXTURE_SCHEMA',
  'FIXTURE_TTY',
  'FIXTURE_VIEWS',
]);

/** The schema a case names, which must be one the fixture declares. */
function schemaNamed(name: string): SchemaName {
  const known: readonly SchemaName[] = ['loose', 'refined', 'topRefined', 'typed'];
  const found = known.find((entry) => entry === name);
  if (found === undefined) {
    throw new Error(`The fixture declares no schema named ${name}.`);
  }
  return found;
}

/**
 * Splits a test's environment into what configures the fixture application and what is the run's
 * whole environment. A `FIXTURE_` name in the first group is never visible to the run.
 */
function split(env: Overrides) {
  const entries = Object.entries(env);
  const own = Object.fromEntries(entries.filter(([name]) => !fixtureNames.has(name)));
  const {
    FIXTURE_CWD,
    FIXTURE_LIMIT_PATH,
    FIXTURE_LOUD,
    FIXTURE_PROVIDED,
    FIXTURE_SCHEMA,
    FIXTURE_TTY,
    FIXTURE_VIEWS,
  } = env;
  const { [settingsKey]: installed } = env;
  const declared: Declared = {
    ...(FIXTURE_LIMIT_PATH === undefined ? {} : { limitPath: FIXTURE_LIMIT_PATH }),
    ...(FIXTURE_LOUD === undefined ? {} : { loud: true }),
    ...(FIXTURE_PROVIDED === undefined ? {} : { provided: true }),
    ...(FIXTURE_SCHEMA === undefined ? {} : { schema: schemaNamed(FIXTURE_SCHEMA) }),
    ...(installed === undefined ? {} : { settings: installed }),
    ...(FIXTURE_VIEWS === undefined ? {} : { view: FIXTURE_VIEWS }),
  };
  return {
    declared,
    env: own,
    ...(FIXTURE_CWD === undefined ? {} : { cwd: FIXTURE_CWD }),
    ...(FIXTURE_TTY === undefined ? {} : { columns: Number(FIXTURE_TTY) }),
  };
}

/**
 * One temporary workspace per test: a project directory the host's `cwd` points at, and a home
 * directory `HOME` points at. A run reads only its mock process, so a file the plugin finds was
 * resolved against `host.cwd` and nothing else.
 */
interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  /** A directory the spawned process starts in, which is not the run's `cwd`. */
  readonly elsewhere: string;
  /** Runs the fixture application with `HOME` pointed at the home directory. */
  run(argv: string[], env?: Overrides): Promise<Result>;
  /** What the run writes to stdout. */
  stdout(argv: string[], env?: Overrides): Promise<string>;
  /** What the run writes to stderr. */
  stderr(argv: string[], env?: Overrides): Promise<string>;
  /** Runs the same case as a process whose own working directory is the temporary root. */
  spawn(argv: string[], env?: Overrides): ReturnType<typeof invoke>;
  /** Writes one file, creating its directories, and answers its path. */
  write(relative: string, content: string, base?: string): string;
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'loom-config-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const elsewhere = join(root, 'elsewhere');
  for (const directory of [project, home, elsewhere]) {
    mkdirSync(directory);
  }
  const run = (argv: string[], env: Overrides = {}) =>
    runInProcess({ argv, ...split({ FIXTURE_CWD: project, HOME: home, ...env }) });
  return {
    elsewhere,
    home,
    project,
    root,
    run,
    spawn: (argv, env = {}) =>
      invoke(processFixture, argv, {
        cwd: elsewhere,
        env: {
          FIXTURE_CWD: project,
          HOME: home,
          ...env,
          ...(env[settingsKey] === undefined
            ? {}
            : { FIXTURE_SETTINGS: JSON.stringify(env[settingsKey]) }),
        },
      }),
    stderr: async (argv, env = {}) => {
      const { stderr } = await run(argv, env);
      return stderr;
    },
    stdout: async (argv, env = {}) => {
      const { stdout } = await run(argv, env);
      return stdout;
    },
    write: (relative, content, base = project) => {
      const path = join(base, relative);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
  };
}

/** Runs one test body in a fresh workspace and removes it afterward. */
function inWorkspace(body: (space: Workspace) => void | Promise<void>): () => Promise<void> {
  return async () => {
    const space = workspace();
    try {
      await body(space);
    } finally {
      rmSync(space.root, { force: true, recursive: true });
    }
  };
}

/** Pairs of strings a test walks, such as a file and its content. */
type Pairs = readonly (readonly [string, string])[];

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** The environment that installs the plugin with one settings object. */
function settings(value: Settings): Overrides {
  return { [settingsKey]: value };
}

/** The options the action received, parsed from the one line it prints. */
function received(stdout: string): unknown {
  const line = stdout.split('\n').find((entry) => entry.startsWith('root:'));
  expect(line).toBeDefined();
  return JSON.parse(line?.slice('root:'.length) ?? '');
}

/** Every value the action receives when nothing supplies one, help's global option included. */
const defaults = { fields: [], help: false, limit: '10', quiet: true, total: false, verbose: 0 };

/** The line help adds under every usage failure, since the fixture installs it. */
const helpHint = 'Run "app --help" to see the usage.\n';

/** The failure the named file prints for one clause and its fix. */
function namedFailure(path: string, clause: string): string {
  return `app: Option "--config": File "${path}" ${clause}\n${helpHint}`;
}

/** The warning a discovered file prints for one clause and its fix. */
function skipped(file: string, clause: string): string {
  return `⚠ Skipped ${file}: the file ${clause}\n`;
}

/** The warning a directory with several present candidates prints. */
function several(files: string, chosen: string): string {
  return `⚠ Skipped ${files}: ${chosen} matches the same pattern first. Keep one of the files, and remove the others.\n`;
}

/** The `-v` lines a value the option cannot take writes, one per line given. */
function wrong(...lines: string[]): string {
  return lines.map((line) => `› ${line}\n`).join('');
}

/** The environment of a run that shows `-v` lines: it installs the fixture's verbose mark. */
const loudEnv: Overrides = { FIXTURE_LOUD: '1' };

const invalidJson =
  'is not valid JSON, so this run reads no configuration. Correct its syntax, or remove it.';
const notObject =
  'does not hold a JSON object, so this run reads no configuration. Write its settings as one JSON object, or remove it.';
const invalidToml =
  'is not valid TOML, so this run reads no configuration. Correct its syntax, or remove it.';
const invalidYaml =
  'is not valid YAML, so this run reads no configuration. Correct its syntax, or remove it.';
const notMapping =
  'does not hold a YAML mapping, so this run reads no configuration. Write its settings as one YAML mapping, or remove it.';

test(
  'with no settings the plugin reads .<app>.json in the working directory, then in the home directory',
  inWorkspace(async (space) => {
    const silent = await space.run([]);
    expect(silent).toMatchObject({ status: 0, stderr: '' });
    expect(received(silent.stdout)).toEqual(defaults);
    space.write('.app.json', json({ title: 'home' }), space.home);
    expect(received(await space.stdout([]))).toEqual({ ...defaults, title: 'home' });
    // A file in the working directory hides the home file entirely, so the home title is not read.
    space.write('.app.json', json({ limits: { bytes: '1' } }));
    expect(received(await space.stdout([]))).toEqual({ ...defaults, limit: '1' });
  }),
);

test(
  'the lookup never reads the process working directory',
  inWorkspace((space) => {
    space.write('.app.json', json({ title: 'process' }), space.elsewhere);
    expect(received(space.spawn([], { HOME: undefined }).stdout)).toEqual(defaults);
  }),
);

test(
  'the walk reads a parent directory, and no lookup expands a ~ path',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ title: 'parent' }));
    const nested = join(space.project, 'nested');
    mkdirSync(nested);
    expect(received(await space.stdout([], { FIXTURE_CWD: nested, HOME: undefined }))).toEqual({
      ...defaults,
      title: 'parent',
    });
    await expect(space.run(['--config', '~/.app.json'])).resolves.toMatchObject({
      status: 2,
      stderr: namedFailure('~/.app.json', 'does not exist. Supply the path of an existing file.'),
    });
  }),
);

test(
  'the home directory is HOME, and an unset, empty, or relative one is none',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ title: 'home' }), space.home);
    expect(received(await space.stdout([]))).toMatchObject({ title: 'home' });
    // A relative home names a directory under the working directory, which the plugin never reads.
    space.write('home/.app.json', json({ title: 'relative' }));
    for (const home of [undefined, '', 'home']) {
      expect(received(await space.stdout([], { HOME: home }))).toEqual(defaults);
    }
  }),
);

test(
  'a broken file in the working directory warns and no later location answers, and a home that is the working directory is read once',
  inWorkspace(async (space) => {
    space.write('.app.json', '{');
    space.write('.app.json', json({ title: 'home' }), space.home);
    const result = await space.run([]);
    expect(result).toMatchObject({ status: 0, stderr: skipped('.app.json', invalidJson) });
    expect(received(result.stdout)).toEqual(defaults);
    for (const home of [space.project, `${space.project}/`]) {
      const once = await space.run([], { HOME: home });
      expect(once).toMatchObject({ status: 0, stderr: skipped('.app.json', invalidJson) });
      expect(received(once.stdout)).toEqual(defaults);
    }
  }),
);

test(
  '--config names the one file a run reads, and a bad named file fails the run',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ limits: { bytes: '2' } }));
    space.write('.app.json', json({ total: true }), space.home);
    space.write('pinned.json', json({ title: 'pinned' }));
    expect(received(await space.stdout(['--config', 'pinned.json']))).toEqual({
      ...defaults,
      config: 'pinned.json',
      title: 'pinned',
    });
    // The named path is no pattern, so its braces are part of the name, and it reads as JSON.
    space.write('.app.{toml,json}', json({ title: 'braces' }));
    expect(received(await space.stdout(['--config', '.app.{toml,json}']))).toMatchObject({
      title: 'braces',
    });
    await expect(space.run(['--config', 'missing.json'])).resolves.toEqual({
      status: 2,
      stderr: namedFailure('missing.json', 'does not exist. Supply the path of an existing file.'),
      stdout: 'resolved:2\n',
    });
    space.write('broken.json', '{');
    await expect(space.run(['--config', 'broken.json'])).resolves.toEqual({
      status: 2,
      stderr: namedFailure(
        'broken.json',
        'is not valid JSON. Correct its syntax, or supply another file.',
      ),
      stdout: 'resolved:2\n',
    });
    space.write('list.json', '[]');
    await expect(space.run(['--config', 'list.json'])).resolves.toEqual({
      status: 2,
      stderr: namedFailure(
        'list.json',
        'does not hold a JSON object. Write its settings as one JSON object.',
      ),
      stdout: 'resolved:2\n',
    });
    mkdirSync(join(space.project, 'dir.json'));
    await expect(space.stderr(['--config', 'dir.json'])).resolves.toBe(
      namedFailure('dir.json', 'could not be read. Supply a file this process can read.'),
    );
    // The takeover reports nothing, and a run that needs no value reads no file.
    const help = await space.run(['--config', 'missing.json', '--help']);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe('');
    const filled = await space.run([
      '--config',
      'missing.json',
      '--level',
      'x',
      '--limit',
      '1',
      '--total',
      '--no-quiet',
      '--fields',
      'a',
      '--title',
      't',
      '--owner',
      'o',
      '-v',
      '--backup',
      '--root',
      '/r',
    ]);
    expect(filled).toMatchObject({ status: 0, stderr: '' });
    expect(received(filled.stdout)).toEqual({
      backup: 'simple',
      config: 'missing.json',
      fields: ['a'],
      help: false,
      level: 'x',
      limit: '1',
      owner: 'o',
      quiet: false,
      root: '/r',
      title: 't',
      total: true,
      verbose: 1,
    });
  }),
);

test(
  'short gives --config a short spelling, and with none --config has no short spelling',
  inWorkspace(async (space) => {
    space.write('pinned.json', json({ title: 'pinned' }));
    expect(received(await space.stdout(['-c', 'pinned.json'], settings({ short: 'c' })))).toEqual({
      ...defaults,
      config: 'pinned.json',
      title: 'pinned',
    });
    await expect(space.stderr(['-c', 'missing.json'], settings({ short: 'c' }))).resolves.toBe(
      namedFailure('missing.json', 'does not exist. Supply the path of an existing file.'),
    );
    const { status } = await space.run(['-c', 'pinned.json']);
    expect(status).toBe(2);
  }),
);

test(
  'a discovered file that is missing is silent, and one that is broken warns once and is skipped',
  inWorkspace(async (space) => {
    mkdirSync(join(space.project, '.app.json'));
    const directory = await space.run([]);
    expect(directory).toMatchObject({
      status: 0,
      stderr: skipped(
        '.app.json',
        'could not be read, so this run reads no configuration. Make it readable, or remove it.',
      ),
    });
    expect(received(directory.stdout)).toEqual(defaults);
    rmSync(join(space.project, '.app.json'), { recursive: true });
    const broken: Pairs = [
      ['', invalidJson],
      ['{"limits": ', invalidJson],
      ['[1]', notObject],
    ];
    for (const [content, clause] of broken) {
      space.write('.app.json', content);
      await expect(space.run([])).resolves.toMatchObject({
        status: 0,
        stderr: skipped('.app.json', clause),
      });
    }
    rmSync(join(space.project, '.app.json'));
    const home = space.write('.app.json', 'true', space.home);
    const result = await space.run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe(skipped(home, notObject));
    expect(result.stdout.startsWith('app')).toBe(true);
    // A file under a missing directory, or under a file in place of a directory, is silent.
    await expect(space.stderr([], settings({ file: 'absent/.app.json' }))).resolves.toBe('');
    writeFileSync(join(space.project, 'plain'), 'a file, not a directory');
    await expect(space.stderr([], settings({ file: 'plain/.app.json' }))).resolves.toBe('');
  }),
);

test(
  'the extension chooses the parser, as written, for a discovered file and the named file',
  inWorkspace(async (space) => {
    const values = { limits: { bytes: '5' }, total: true };
    const filled = { ...defaults, limit: '5', total: true };
    const formats: Pairs = [
      ['.app.toml', 'total = true\n[limits]\nbytes = "5"\n'],
      ['.app.yaml', 'total: true\nlimits:\n  bytes: "5"\n'],
      ['.app.yml', 'total: true\nlimits: { bytes: "5" }\n'],
      ['.apprc', json(values)],
      ['.app.conf', json(values)],
      ['config.cfg', json(values)],
    ];
    for (const [file, content] of formats) {
      space.write(file, content);
      const discovered = await space.run([], settings({ file }));
      expect(discovered).toMatchObject({ status: 0, stderr: '' });
      expect(received(discovered.stdout)).toEqual(filled);
      expect(received(await space.stdout(['--config', file]))).toEqual({
        ...filled,
        config: file,
      });
    }
    // An extension compares as written, so .TOML reads as JSON.
    space.write('.app.TOML', 'total = true\n');
    await expect(space.stderr([], settings({ file: '.app.TOML' }))).resolves.toBe(
      skipped('.app.TOML', invalidJson),
    );
    // A leading dot starts the name, so .toml is a name with no extension and reads as JSON.
    space.write('.toml', 'total = true\n');
    await expect(space.stderr([], settings({ file: '.toml' }))).resolves.toBe(
      skipped('.toml', invalidJson),
    );
  }),
);

test(
  'the first present candidate is read, and every later present one is skipped unread with one warning first',
  inWorkspace(async (space) => {
    const any = settings({ file: '.app.*' });
    space.write('.app.json', json({ title: 'json' }));
    await expect(space.run([], any)).resolves.toMatchObject({ status: 0, stderr: '' });
    space.write('.app.yml', 'title: yml\n');
    const yml = await space.run([], any);
    expect(yml.stderr).toBe(several('.app.json', '.app.yml'));
    expect(received(yml.stdout)).toMatchObject({ title: 'yml' });
    // A skipped candidate is never read, so a broken one adds no warning of its own.
    space.write('.app.json', '{');
    space.write('.app.yaml', 'title: [');
    space.write('.app.toml', 'title = "toml"\n');
    const toml = await space.run([], any);
    expect(toml.stderr).toBe(several('.app.yaml, .app.yml, .app.json', '.app.toml'));
    expect(received(toml.stdout)).toMatchObject({ title: 'toml' });
    // A broken first candidate is never replaced by a later one, and no later location answers.
    space.write('.app.toml', 'title = ');
    space.write('.app.json', json({ title: 'home' }), space.home);
    const broken = await space.run([], any);
    expect(broken.stderr).toBe(
      `${several('.app.yaml, .app.yml, .app.json', '.app.toml')}${skipped('.app.toml', invalidToml)}`,
    );
    expect(received(broken.stdout)).toEqual(defaults);
  }),
);

test(
  'a brace list orders its candidates as listed, a repeated extension counting at its first position',
  inWorkspace(async (space) => {
    space.write('.app.toml', 'title = "toml"\n');
    space.write('.app.json', json({ title: 'json' }));
    const listed = await space.run([], settings({ file: '.app.{json,toml,json}' }));
    expect(listed.stderr).toBe(several('.app.toml', '.app.json'));
    expect(received(listed.stdout)).toMatchObject({ title: 'json' });
    const literal = await space.run([], settings({ file: '.app.toml' }));
    expect(literal).toMatchObject({ status: 0, stderr: '' });
    expect(received(literal.stdout)).toMatchObject({ title: 'toml' });
  }),
);

test(
  'a file in the working directory shows as file names it, and one in the home directory as its full path',
  inWorkspace(async (space) => {
    const nested = settings({ file: '.app/config.{yaml,json}' });
    space.write('.app/config.yaml', 'limits: { bytes: many }\n');
    // A wrong value in the file falls back to the default, and only -v names the drop.
    await expect(space.stderr([], nested)).resolves.toBe('');
    rmSync(join(space.project, '.app'), { recursive: true });
    const yaml = space.write('.app/config.yaml', 'limits: { bytes: many }\n', space.home);
    const json5 = space.write('.app/config.json', '{}', space.home);
    const result = await space.run([], nested);
    expect(result.stderr).toBe(several(json5, yaml));
  }),
);

test(
  'a TOML integer beyond the safe range fills a string option with its exact digits and a count with the nearest number',
  inWorkspace(async (space) => {
    space.write(
      '.app.toml',
      'title = "kept"\nverbose = 123456789012345678\n[limits]\nbytes = 123456789012345678\n',
    );
    const result = await space.run([], settings({ file: '.app.toml' }));
    expect(result.stderr).toBe('');
    expect(received(result.stdout)).toEqual({
      ...defaults,
      limit: '123456789012345678',
      title: 'kept',
      verbose: Number(123_456_789_012_345_678n),
    });
  }),
);

test(
  'a TOML number fills as JSON writes it, and a date or time as written',
  inWorkspace(async (space) => {
    const toml = settings({ file: '.app.toml' });
    space.write(
      '.app.toml',
      [
        'title = 1979-05-27T07:32:00-08:00',
        'fields = [1979-05-27 07:32:00, 1979-05-27, 07:32:00.5, 1979-05-27t07:32:00.999999z, 5_000, 0x1F, 1.0]',
        '[limits]',
        'bytes = 9_007_199_254_740_991',
        '',
      ].join('\n'),
    );
    expect(received(await space.stdout([], toml))).toEqual({
      ...defaults,
      fields: [
        '1979-05-27 07:32:00',
        '1979-05-27',
        '07:32:00.5',
        '1979-05-27t07:32:00.999999z',
        '5000',
        '31',
        '1',
      ],
      limit: '9007199254740991',
      title: '1979-05-27T07:32:00-08:00',
    });
    // Date text in a string, a comment, or a key stays what it is.
    space.write(
      '.app.toml',
      [
        'title = "1979-05-27 07:32:00" # 07:32:00',
        String.raw`fields = ['''x 1979-05-27''', """a 07:32:00"""", "b \" 07:32:00", """c \""" 07:32:00""", 07:32:00]`,
        '[1979-05-27]',
        'bytes = 5',
        '',
      ].join('\n'),
    );
    expect(
      received(await space.stdout([], { ...toml, FIXTURE_LIMIT_PATH: '1979-05-27.bytes' })),
    ).toEqual({
      ...defaults,
      fields: ['x 1979-05-27', 'a 07:32:00"', 'b " 07:32:00', 'c """ 07:32:00', '07:32:00'],
      limit: '5',
      title: '1979-05-27 07:32:00',
    });
  }),
);

test(
  'a counted option takes a whole number of 0 or more, and any other value is ignored with a -v line',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ verbose: 3 }));
    expect(received(await space.stdout([]))).toEqual({ ...defaults, verbose: 3 });
    space.write('.app.json', json({ verbose: 0 }));
    expect(received(await space.stdout([]))).toEqual(defaults);
    expect(received(await space.stdout(['-v']))).toEqual({ ...defaults, verbose: 1 });
    for (const value of ['3', -1, 1.5, true]) {
      space.write('.app.json', json({ verbose: value }));
      await expect(space.run(['-L'], loudEnv)).resolves.toMatchObject({
        status: 0,
        stderr: wrong(
          'Ignored option "--verbose" from verbose in .app.json: Use a whole number of 0 or more.',
        ),
      });
    }
    const toml = settings({ file: '.app.toml' });
    space.write('.app.toml', 'verbose = 1_0\n');
    expect(received(await space.stdout([], toml))).toEqual({ ...defaults, verbose: 10 });
    space.write('.app.toml', 'verbose = 3.0\n');
    expect(received(await space.stdout([], toml))).toEqual({ ...defaults, verbose: 3 });
    const yaml = settings({ file: '.app.yaml' });
    space.write('.app.yaml', 'verbose: 0x3\n');
    expect(received(await space.stdout([], yaml))).toEqual({ ...defaults, verbose: 3 });
  }),
);

test(
  'a string option with an implied value takes a value by the string rule, never its implied value',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ backup: 'numbered' }));
    expect(received(await space.stdout([]))).toEqual({ ...defaults, backup: 'numbered' });
    expect(received(await space.stdout(['--backup']))).toEqual({
      ...defaults,
      backup: 'simple',
    });
    space.write('.app.json', json({ backup: true }));
    await expect(space.stderr(['-L'], loudEnv)).resolves.toBe(
      wrong('Ignored option "--backup" from backup in .app.json: Use a string or a number.'),
    );
  }),
);

test(
  'a TOML value the option cannot take is ignored with a -v line, and an invalid date is invalid TOML',
  inWorkspace(async (space) => {
    const toml = settings({ file: '.app.toml' });
    const cases: Pairs = [
      [
        'total = 1979-05-27\n',
        'Ignored option "--total" from total in .app.toml: Use true or false.',
      ],
      [
        'title = inf\n',
        'Ignored option "--title" from title in .app.toml: Use a string or a number.',
      ],
      [
        'title = nan\n',
        'Ignored option "--title" from title in .app.toml: Use a string or a number.',
      ],
      ['[title]\n', 'Ignored option "--title" from title in .app.toml: Use a string or a number.'],
      [
        'fields = [1, -inf]\n',
        'Ignored option "--fields" at 1 from fields in .app.toml: Use a string or a number.',
      ],
    ];
    for (const [content, line] of cases) {
      space.write('.app.toml', content);
      await expect(space.run(['-L'], { ...toml, ...loudEnv })).resolves.toMatchObject({
        status: 0,
        stderr: wrong(line),
      });
    }
    space.write('.app.toml', '');
    const empty = await space.run([], toml);
    expect(empty).toMatchObject({ status: 0, stderr: '' });
    expect(received(empty.stdout)).toEqual(defaults);
    for (const content of ['title = 1979-13-45\n', 'title = "open\n', 'a = 1\na = 2\n']) {
      space.write('.app.toml', content);
      await expect(space.stderr([], toml)).resolves.toBe(skipped('.app.toml', invalidToml));
      await expect(space.stderr(['--config', '.app.toml'])).resolves.toBe(
        namedFailure('.app.toml', 'is not valid TOML. Correct its syntax, or supply another file.'),
      );
    }
  }),
);

test(
  'a YAML file reads under the core schema, with aliases resolved',
  inWorkspace(async (space) => {
    const yaml = settings({ file: '.app.yaml' });
    space.write(
      '.app.yaml',
      [
        'total: True',
        'quiet: FALSE',
        'title: 2001-12-14',
        'log: { level: &level debug }',
        'fields: [*level, 0x1F, 1.0, no]',
        '',
      ].join('\n'),
    );
    expect(received(await space.stdout([], yaml))).toEqual({
      fields: ['debug', '31', '1', 'no'],
      help: false,
      level: 'debug',
      limit: '10',
      quiet: false,
      title: '2001-12-14',
      total: true,
      verbose: 0,
    });
  }),
);

test(
  'a YAML file that reuses one profile across many environments reads every alias',
  inWorkspace(async (space) => {
    const environments = Array.from({ length: 30 }, (_entry, index) => `  env${index}: *profile`);
    space.write(
      '.app.yaml',
      [
        'limits: &limits { bytes: 7 }',
        'profile: &profile',
        '  fetch: *limits',
        '  store: *limits',
        '  index: *limits',
        'environments:',
        ...environments,
        '',
      ].join('\n'),
    );
    const result = await space.run([], {
      ...settings({ file: '.app.yaml' }),
      FIXTURE_LIMIT_PATH: 'environments.env29.index.bytes',
    });
    expect(result.stderr).toBe('');
    expect(received(result.stdout)).toMatchObject({ limit: '7' });
  }),
);

test(
  'a YAML value the option cannot take is ignored with a -v line',
  inWorkspace(async (space) => {
    const yaml = settings({ file: '.app.yaml' });
    const cases: Pairs = [
      ['total: no\n', 'Ignored option "--total" from total in .app.yaml: Use true or false.'],
      ['total: on\n', 'Ignored option "--total" from total in .app.yaml: Use true or false.'],
      [
        'title: null\n',
        'Ignored option "--title" from title in .app.yaml: Use a string or a number.',
      ],
      ['title: ~\n', 'Ignored option "--title" from title in .app.yaml: Use a string or a number.'],
      ['title:\n', 'Ignored option "--title" from title in .app.yaml: Use a string or a number.'],
      [
        'title: .inf\n',
        'Ignored option "--title" from title in .app.yaml: Use a string or a number.',
      ],
      [
        'title: .nan\n',
        'Ignored option "--title" from title in .app.yaml: Use a string or a number.',
      ],
      [
        'title: { a: 1 }\n',
        'Ignored option "--title" from title in .app.yaml: Use a string or a number.',
      ],
    ];
    for (const [content, line] of cases) {
      space.write('.app.yaml', content);
      await expect(space.run(['-L'], { ...yaml, ...loudEnv })).resolves.toMatchObject({
        status: 0,
        stderr: wrong(line),
      });
    }
  }),
);

test(
  'a YAML file outside one core-schema document with unique keys is not valid YAML, and no parser warning prints',
  inWorkspace(async (space) => {
    const yaml = settings({ file: '.app.yaml' });
    const invalid = [
      'title: a\n---\ntitle: b\n',
      'title: a\ntitle: b\n',
      'title: !!binary aGVsbG8=\n',
      'title: !!timestamp 2001-12-14\n',
      'title: !local value\n',
      'title: !!set { a }\n',
      'title: [\n',
    ];
    for (const content of invalid) {
      space.write('.app.yaml', content);
      await expect(space.run([], yaml)).resolves.toMatchObject({
        status: 0,
        stderr: skipped('.app.yaml', invalidYaml),
      });
      await expect(space.stderr(['--config', '.app.yaml'])).resolves.toBe(
        namedFailure('.app.yaml', 'is not valid YAML. Correct its syntax, or supply another file.'),
      );
    }
    for (const content of ['', '# only a comment\n', '---\n', '- a\n', 'hello\n']) {
      space.write('.app.yaml', content);
      await expect(space.run([], yaml)).resolves.toMatchObject({
        status: 0,
        stderr: skipped('.app.yaml', notMapping),
      });
      await expect(space.stderr(['--config', '.app.yaml'])).resolves.toBe(
        namedFailure(
          '.app.yaml',
          'does not hold a YAML mapping. Write its settings as one YAML mapping.',
        ),
      );
    }
  }),
);

test(
  'an alias that names no preceding anchor, as a value or a key, is not valid YAML',
  inWorkspace(async (space) => {
    const yaml = settings({ file: '.app.yaml' });
    space.write('.app.yaml', 'title: home\n', space.home);
    const unresolved = [
      'defaults: &defaults 5\ntitle: *defualts\n',
      'title: *later\nlater: &later 1\n',
      '*nope : 1\ntitle: own\n',
    ];
    for (const content of unresolved) {
      space.write('.app.yaml', content);
      const discovered = await space.run([], yaml);
      expect(discovered).toMatchObject({ status: 0, stderr: skipped('.app.yaml', invalidYaml) });
      expect(received(discovered.stdout)).toEqual(defaults);
      await expect(space.run(['--config', '.app.yaml'])).resolves.toMatchObject({
        status: 2,
        stderr: namedFailure(
          '.app.yaml',
          'is not valid YAML. Correct its syntax, or supply another file.',
        ),
      });
    }
  }),
);

test(
  "yaml's debug variables print nothing while a YAML file is read, and keep their state",
  inWorkspace((space) => {
    const yaml = { ...settings({ file: '.app.yaml' }), FIXTURE_DEBUG_VARIABLES: '1' };
    space.write('.app.yaml', 'title: secret\n');
    // The action's line, with the options in declaration order, is all that reaches stdout.
    const expected =
      'root:{"help":false,"limit":"10","total":false,"quiet":true,"fields":[],"title":"secret","verbose":0}\nresolved:0\n';
    expect(space.spawn([], { ...yaml, LOG_STREAM: '1', LOG_TOKENS: '1' })).toEqual({
      status: 0,
      stderr: '',
      stdout: `${expected}debug:1,1\n`,
    });
    expect(space.spawn([], { ...yaml, LOG_STREAM: 'yes', LOG_TOKENS: undefined })).toEqual({
      status: 0,
      stderr: '',
      stdout: `${expected}debug:yes,absent\n`,
    });
  }),
);

test(
  'a leading byte order mark reads in every format, and an empty named file is not valid JSON',
  inWorkspace(async (space) => {
    const mark = String.fromCodePoint(65_279);
    const marked: Pairs = [
      ['.app.json', json({ title: 'bom' })],
      ['.app.toml', 'title = "bom"\n'],
      ['.app.yaml', 'title: bom\n'],
    ];
    for (const [file, content] of marked) {
      space.write(file, `${mark}${content}`);
      expect(received(await space.stdout([], settings({ file })))).toMatchObject({
        title: 'bom',
      });
    }
    space.write('empty.json', '');
    await expect(space.stderr(['--config', 'empty.json'])).resolves.toBe(
      namedFailure('empty.json', 'is not valid JSON. Correct its syntax, or supply another file.'),
    );
  }),
);

test(
  'a value follows the option type, and a value the option cannot take is ignored with one -v line each',
  inWorkspace(async (space) => {
    space.write(
      '.app.json',
      json({ fields: ['a', 2], limits: { bytes: 5 }, quiet: false, total: true }),
    );
    expect(received(await space.stdout([]))).toEqual({
      fields: ['a', '2'],
      help: false,
      limit: '5',
      quiet: false,
      total: true,
      verbose: 0,
    });
    const lines = async (content: string) => {
      space.write('.app.json', content);
      const result = await space.run(['-L'], loudEnv);
      expect(result.status).toBe(0);
      return result.stderr;
    };
    await expect(lines(json({ total: 'yes' }))).resolves.toBe(
      wrong('Ignored option "--total" from total in .app.json: Use true or false.'),
    );
    await expect(lines(json({ limits: { bytes: { max: 5 } } }))).resolves.toBe(
      wrong('Ignored option "--limit" from limits.bytes in .app.json: Use a string or a number.'),
    );
    await expect(lines(json({ quiet: 'no' }))).resolves.toBe(
      wrong('Ignored option "--no-quiet" from quiet in .app.json: Use true or false.'),
    );
    await expect(lines(json({ fields: 'a' }))).resolves.toBe(
      wrong(
        'Ignored option "--fields" from fields in .app.json: Use an array of strings or numbers.',
      ),
    );
    await expect(lines(json({ fields: ['a', {}, null] }))).resolves.toBe(
      wrong(
        'Ignored option "--fields" at 1 from fields in .app.json: Use a string or a number.',
        'Ignored option "--fields" at 2 from fields in .app.json: Use a string or a number.',
      ),
    );
    await expect(lines(json({ title: null }))).resolves.toBe(
      wrong('Ignored option "--title" from title in .app.json: Use a string or a number.'),
    );
    // An overflowing literal parses as Infinity, which is no JSON number.
    await expect(lines('{"title": 1e400, "fields": [-0, 1e21, -1e400]}')).resolves.toBe(
      wrong(
        'Ignored option "--fields" at 2 from fields in .app.json: Use a string or a number.',
        'Ignored option "--title" from title in .app.json: Use a string or a number.',
      ),
    );
    space.write('.app.json', '{"fields": [-0, 1e21]}');
    expect(received(await space.stdout([]))).toMatchObject({ fields: ['0', '1e+21'] });
  }),
);

test(
  'an empty array fills a multiple option, and a value the option cannot take falls through to its default',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ fields: [] }));
    expect(received(await space.stdout([]))).toEqual(defaults);
    space.write('.app.json', json({ limits: { bytes: true }, log: { level: 7 }, title: false }));
    const result = await space.run(['-L'], loudEnv);
    expect(result.status).toBe(0);
    expect(received(result.stdout)).toMatchObject({ level: '7', limit: '10' });
    expect(received(result.stdout)).not.toHaveProperty('title');
    expect(result.stderr).toBe(
      wrong(
        'Ignored option "--limit" from limits.bytes in .app.json: Use a string or a number.',
        'Ignored option "--title" from title in .app.json: Use a string or a number.',
      ),
    );
    expect(received(await space.stdout(['--limit', '1', '--title', 't']))).toMatchObject({
      level: '7',
    });
  }),
);

test(
  'a path that meets a missing key or a non-object leads to no value, and the option takes its default',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ limits: 5 }));
    expect(received(await space.stdout([]))).toMatchObject({ limit: '10' });
    space.write('.app.json', json({ limits: { size: '1' } }));
    expect(received(await space.stdout([]))).toMatchObject({ limit: '10' });
  }),
);

test(
  'a segment named after an Object.prototype member answers only from an own key',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ limits: { bytes: '1' } }));
    expect(received(await space.stdout([]))).not.toHaveProperty('owner');
    const owned: Pairs = [
      ['.app.json', json({ constructor: 'own' })],
      ['.app.toml', 'constructor = "own"\n'],
      ['.app.yaml', 'constructor: own\n'],
    ];
    for (const [file, content] of owned) {
      space.write(file, content);
      expect(received(await space.stdout([], settings({ file })))).toMatchObject({
        owner: 'own',
      });
    }
    // A YAML __proto__ key is an own key, which a request path reaches like any other.
    space.write('.app.yaml', '__proto__:\n  bytes: 7\n');
    const proto = await space.stdout([], {
      ...settings({ file: '.app.yaml' }),
      FIXTURE_LIMIT_PATH: '__proto__.bytes',
    });
    expect(received(proto)).toMatchObject({ limit: '7' });
  }),
);

test(
  'a bad path in the binding throws a declaration error at the call',
  inWorkspace(async (space) => {
    await expect(space.stdout([], { FIXTURE_LIMIT_PATH: 'a..b' })).resolves.toBe(
      'DeclarationError: The root Command option "limit" holds an invalid "@loomcli/plugins/config/input" value: Supply a dotted path of nonempty keys. Correct the value.\n',
    );
  }),
);

/*
 * An InputError's default text prints its message as data, so a nowrap frame would show its
 * delimiters there. The named file's failure and a wrong value's label leave the path unmarked,
 * and it prints whole on a pipe and on a narrow terminal alike.
 */
test(
  'a path with spaces in an input failure prints whole and unmarked on a pipe and a narrow terminal',
  inWorkspace(async (space) => {
    for (const env of [{}, { FIXTURE_TTY: '20' }]) {
      await expect(space.stderr(['--config', 'my configs/missing.json'], env)).resolves.toBe(
        namedFailure(
          'my configs/missing.json',
          'does not exist. Supply the path of an existing file.',
        ),
      );
      space.write('my configs/app.json', json({ limits: { bytes: 'x' } }));
      // The wrong value falls back to the default, so the run prints nothing.
      await expect(space.stderr(['--config', 'my configs/app.json'], env)).resolves.toBe('');
      rmSync(join(space.project, 'my configs'), { force: true, recursive: true });
    }
  }),
);

test(
  'a control character in a file path prints as its escape',
  inWorkspace(async (space) => {
    const escape = String.fromCodePoint(27);
    await expect(space.stderr(['--config', `esc${escape}ape`])).resolves.toBe(
      namedFailure(
        String.raw`esc\u001bape`,
        'does not exist. Supply the path of an existing file.',
      ),
    );
  }),
);

test('inspect() lists the --config option and the binding value on each bound option', () => {
  const graph = inspected({});
  expect(graph.globals.find((option: { name: string }) => option.name === 'config')).toMatchObject({
    description: 'Read configuration from this file alone.',
    short: null,
    type: 'string',
  });
  expect(
    graph.root.options.find((option: { name: string }) => option.name === 'limit')?.extensions,
  ).toEqual({ '@loomcli/plugins/config/input': { path: 'limits.bytes' } });
  expect(
    inspected(settings({ short: 'c' })).globals.find(
      (option: { name: string }) => option.name === 'config',
    ),
  ).toMatchObject({ short: '-c' });
});

/** The inspected graph of the fixture application, with the settings an environment names. */
function inspected(env: Overrides) {
  return inspectGraph(split(env).declared);
}

/** The fault a `configuration()` call throws for the settings, or `"returned"` when it returns. */
function callFault(value?: Settings): unknown {
  return settingsFault(value);
}

const pathFault = {
  correction: 'Supply a relative path such as .textstat.toml, with no empty, ., or .. segment.',
  findings: [{ call: 'configuration', mark: '0.file' }],
  rule: '@loomcli/plugins/config/file-path',
  sentence: 'Plugin "@loomcli/plugins/config" file is not a relative path.',
};

const globFault = {
  correction:
    'Write the name literally, and use * or a brace list only as the whole text after its last dot.',
  findings: [{ call: 'configuration', mark: '0.file' }],
  rule: '@loomcli/plugins/config/file-pattern',
  sentence:
    'Plugin "@loomcli/plugins/config" file holds glob syntax other than an extension of * or a brace list.',
};

const listFault = {
  correction: 'List only json, toml, yaml, or yml in the braces, or use * for any of them.',
  findings: [{ call: 'configuration', mark: '0.file' }],
  rule: '@loomcli/plugins/config/file-pattern',
  sentence: 'Plugin "@loomcli/plugins/config" file lists an extension the plugin cannot read.',
};

test.each([
  [''],
  ['/etc/textstat.json'],
  [String.raw`\textstat.json`],
  ['C:textstat.json'],
  [String.raw`c:\textstat.json`],
  ['a//b.json'],
  ['a/'],
  ['./.textstat.json'],
  ['a/../b.json'],
  [String.raw`a\.\b.json`],
  ['..'],
  ['/*.json'],
])('configuration({ file: %j }) throws the file-path fault at its call', (file) => {
  expect(callFault({ file })).toEqual(pathFault);
});

test.each([
  ['*.json'],
  ['.text*.json'],
  ['dir*/.textstat.json'],
  ['{a,b}/.textstat.json'],
  ['.textstat.t*'],
  ['.textstat.?'],
  ['.textstat.[jt]son'],
  ['.textstat.{toml,ya*ml}'],
  ['.textstat.{toml,yaml'],
  ['.textstat.{toml}x'],
  ['*'],
  ['.*'],
  ['.textstat.{toml,y.ml}'],
])('configuration({ file: %j }) throws the glob fault of the file-pattern rule', (file) => {
  expect(callFault({ file })).toEqual(globFault);
});

test.each([
  ['.textstat.{toml,ini}'],
  ['.textstat.{toml,}'],
  ['.textstat.{}'],
  ['.textstat.{TOML}'],
])(
  'configuration({ file: %j }) throws the extension-list fault of the file-pattern rule',
  (file) => {
    expect(callFault({ file })).toEqual(listFault);
  },
);

test('configuration() judges the path before the pattern', () => {
  expect(callFault({ file: 'a/../*.json' })).toEqual(pathFault);
});

test.each([
  [undefined],
  [{}],
  [{ short: 'c' }],
  [{ file: '.textstat.json' }],
  [{ file: '.norn/config.toml' }],
  [{ file: 'dir\\.textstat.*' }],
  [{ file: '.textstat.{toml,yaml,yml,json}' }],
  [{ file: '.textstat.{json,json}' }],
  [{ file: '.textstat.conf' }],
  [{ file: '.textstatrc' }],
  [{ file: `.text${String.fromCodePoint(8232)}stat.json` }],
] satisfies [Settings | undefined][])('configuration(%j) returns its plugin', (value) => {
  expect(callFault(value)).toBe('returned');
});

/** The outcome the fixture prints when it runs the root by name with these values. */
function invokedRoot(
  space: Workspace,
  values: InvocationValues,
  env: Overrides = {},
): Promise<unknown> {
  return invoked({
    ...split({ FIXTURE_CWD: space.project, HOME: space.home, ...env }),
    values,
  });
}

test(
  'in an invocation by name, a value the file holds that the option cannot take names its option by declared name at -v',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ limits: { bytes: true } }));
    await expect(invokedRoot(space, { options: { loud: 1 } }, loudEnv)).resolves.toMatchObject({
      messages:
        '› Ignored option "limit" from limits.bytes in .app.json: Use a string or a number.\n',
      status: 'completed',
    });
  }),
);

test(
  'in an invocation by name, a named file that cannot be used names the config option by its declared name',
  inWorkspace(async (space) => {
    await expect(
      invokedRoot(space, { options: { config: 'missing.json' } }, { FIXTURE_VIEWS: 'input' }),
    ).resolves.toEqual({
      exitCode: 2,
      messages: `${json([
        {
          input: { global: true, kind: 'option', name: 'config' },
          issues: [
            { message: 'File "missing.json" does not exist. Supply the path of an existing file.' },
          ],
          reason: 'invalid',
          spelling: 'config',
        },
      ])}\n`,
      output: '',
      status: 'failed',
    });
  }),
);

/** The notice line a run with no file writes, as `out.info` prints it. */
function notice(file: string): string {
  return `ℹ Found no configuration file. Create ${file} to configure app.\n`;
}

/** A nested directory under a base, created, for a run to start in. */
function nest(base: string, ...segments: string[]): string {
  const directory = join(base, ...segments);
  mkdirSync(directory, { recursive: true });
  return directory;
}

test(
  'the walk ends at the home directory, which it includes, when the start is inside home',
  inWorkspace(async (space) => {
    const start = nest(space.home, 'work', 'deep');
    // A file above home is never read.
    space.write('.app.json', json({ title: 'above' }), space.root);
    await expect(space.run([], { FIXTURE_CWD: start })).resolves.toMatchObject({ stderr: '' });
    expect(received(await space.stdout([], { FIXTURE_CWD: start }))).toEqual(defaults);
    // The home file answers from a start inside home, and a nearer ancestor wins over it.
    space.write('.app.json', json({ title: 'home' }), space.home);
    expect(received(await space.stdout([], { FIXTURE_CWD: start }))).toEqual({
      ...defaults,
      title: 'home',
    });
    space.write('.app.json', json({ title: 'work' }), join(space.home, 'work'));
    expect(received(await space.stdout([], { FIXTURE_CWD: start }))).toEqual({
      ...defaults,
      title: 'work',
    });
    // Nothing merges: the nearer file's missing keys stay at their defaults.
    space.write('.app.json', json({ total: true }), space.home);
    space.write('.app.json', json({ title: 'work' }), join(space.home, 'work'));
    expect(received(await space.stdout([], { FIXTURE_CWD: start }))).toEqual({
      ...defaults,
      title: 'work',
    });
  }),
);

test(
  'the walk ends at the root when the start is outside home, and the home file answers after it',
  inWorkspace(async (space) => {
    const start = nest(space.project, 'a', 'b');
    space.write('.app.json', json({ title: 'ancestor' }), space.root);
    expect(received(await space.stdout([], { FIXTURE_CWD: start }))).toEqual({
      ...defaults,
      title: 'ancestor',
    });
    rmSync(join(space.root, '.app.json'));
    space.write('.app.json', json({ title: 'home' }), space.home);
    expect(received(await space.stdout([], { FIXTURE_CWD: start }))).toEqual({
      ...defaults,
      title: 'home',
    });
    // A home that is empty or relative is no home directory, so the walk is all there is.
    for (const home of ['', 'home']) {
      expect(received(await space.stdout([], { FIXTURE_CWD: start, HOME: home }))).toEqual(
        defaults,
      );
    }
  }),
);

test(
  'a file found in an ancestor shows as its full path, a file in the working directory as file names it',
  inWorkspace(async (space) => {
    const start = nest(space.project, 'a');
    // A value the option cannot take is named at -v, so its label reaches stderr.
    const found = space.write('.app.json', json({ limits: { bytes: {} } }));
    const result = await space.run(['-L'], { ...loudEnv, FIXTURE_CWD: start });
    expect(result.stderr).toBe(
      wrong(`Ignored option "--limit" from limits.bytes in ${found}: Use a string or a number.`),
    );
    const near = space.write('.app.json', json({ limits: { bytes: {} } }), start);
    await expect(space.stderr(['-L'], { ...loudEnv, FIXTURE_CWD: start })).resolves.toBe(
      wrong(`Ignored option "--limit" from limits.bytes in .app.json: Use a string or a number.`),
    );
    expect(near).toBe(join(start, '.app.json'));
  }),
);

test(
  'a broken file in an ancestor, the home directory, or the user folder warns once and no later location answers',
  inWorkspace(async (space) => {
    const start = nest(space.project, 'a');
    const broken = space.write('.app.json', '{', space.project);
    space.write('.app.json', json({ title: 'home' }), space.home);
    space.write('.config/app/config.json', json({ title: 'user' }), space.home);
    const ancestor = await space.run([], { FIXTURE_CWD: start });
    expect(ancestor.stderr).toBe(skipped(broken, invalidJson));
    expect(received(ancestor.stdout)).toEqual(defaults);
    rmSync(broken);
    const homeFile = space.write('.app.json', 'true', space.home);
    const home = await space.run([], { FIXTURE_CWD: start });
    expect(home.stderr).toBe(skipped(homeFile, notObject));
    expect(received(home.stdout)).toEqual(defaults);
    rmSync(homeFile);
    const user = space.write('.config/app/config.json', '[', space.home);
    const last = await space.run([], { FIXTURE_CWD: start });
    expect(last.stderr).toBe(skipped(user, invalidJson));
    expect(received(last.stdout)).toEqual(defaults);
  }),
);

test(
  'the user file shows as its full path when host.cwd is the user folder',
  inWorkspace(async (space) => {
    const user = space.write('.config/app/config.json', '[', space.home);
    const result = await space.run([], { FIXTURE_CWD: join(space.home, '.config', 'app') });
    expect(result.stderr).toBe(skipped(user, invalidJson));
  }),
);

test(
  'the user file is config.<ext> under XDG_CONFIG_HOME, or under ~/.config when it is unset, empty, or relative',
  inWorkspace(async (space) => {
    const xdg = join(space.root, 'xdg');
    space.write('app/config.json', json({ title: 'xdg' }), xdg);
    space.write('.config/app/config.json', json({ title: 'dot-config' }), space.home);
    expect(received(await space.stdout([], { XDG_CONFIG_HOME: xdg }))).toEqual({
      ...defaults,
      title: 'xdg',
    });
    for (const value of [undefined, '', 'xdg']) {
      expect(received(await space.stdout([], { XDG_CONFIG_HOME: value }))).toEqual({
        ...defaults,
        title: 'dot-config',
      });
    }
    // With neither XDG_CONFIG_HOME nor a home directory there is no user file.
    expect(received(await space.stdout([], { HOME: '', XDG_CONFIG_HOME: undefined }))).toEqual(
      defaults,
    );
    // The walk and the home file come before the user file.
    space.write('.app.json', json({ title: 'home' }), space.home);
    expect(received(await space.stdout([], { XDG_CONFIG_HOME: xdg }))).toMatchObject({
      title: 'home',
    });
  }),
);

test(
  'each candidate of the pattern names one extension of the user file, and an extension named twice counts once',
  inWorkspace(async (space) => {
    const cases: Pairs = [
      ['.app.toml', 'config.toml'],
      ['.app.yaml', 'config.yaml'],
      ['.app.yml', 'config.yml'],
      ['.app.json', 'config.json'],
      ['.apprc', 'config.json'],
      ['.app.conf', 'config.json'],
    ];
    for (const [file, user] of cases) {
      const content = user.endsWith('json') ? '{"title":"u"}' : 'title: u\n';
      const path = space.write(`app/${user}`, content, space.root);
      const result = await space.run([], { ...settings({ file }), XDG_CONFIG_HOME: space.root });
      // YAML text is not TOML, so a TOML candidate that was read warns instead of answering.
      expect([result.stderr, received(result.stdout)]).toEqual(
        user.endsWith('toml')
          ? [skipped(path, invalidToml), defaults]
          : ['', { ...defaults, title: 'u' }],
      );
      rmSync(path);
    }
    // .app.{toml,json} looks for config.toml and then config.json; both present warns once.
    const toml = space.write('app/config.toml', 'title = "t"\n', space.root);
    const json5 = space.write('app/config.json', '{"title":"j"}', space.root);
    const both = await space.run([], {
      ...settings({ file: '.app.{toml,json,toml}' }),
      XDG_CONFIG_HOME: space.root,
    });
    expect(both.stderr).toBe(several(json5, toml));
    expect(received(both.stdout)).toMatchObject({ title: 't' });
  }),
);

test(
  'env names the one file a run reads from the environment, with no search',
  inWorkspace(async (space) => {
    const named = settings({ env: 'APP_CONFIG' });
    space.write('.app.json', json({ title: 'walk' }));
    space.write('chosen.json', json({ title: 'chosen' }));
    // A relative value resolves against the working directory, and the file wins over the walk.
    const set = await space.run([], { ...named, APP_CONFIG: 'chosen.json' });
    expect(set.stderr).toBe('');
    expect(received(set.stdout)).toEqual({ ...defaults, title: 'chosen' });
    // The value is no pattern, and its extension chooses the parser.
    space.write('weird.{toml,json}', json({ title: 'braces' }));
    expect(
      received(await space.stdout([], { ...named, APP_CONFIG: 'weird.{toml,json}' })),
    ).toMatchObject({ title: 'braces' });
    space.write('chosen.toml', 'title = "toml"\n');
    expect(received(await space.stdout([], { ...named, APP_CONFIG: 'chosen.toml' }))).toMatchObject(
      { title: 'toml' },
    );
    // --config comes first.
    space.write('flag.json', json({ title: 'flag' }));
    expect(
      received(
        await space.stdout(['--config', 'flag.json'], { ...named, APP_CONFIG: 'chosen.json' }),
      ),
    ).toMatchObject({ title: 'flag' });
    // An empty or unset variable is skipped.
    for (const value of [undefined, '']) {
      expect(received(await space.stdout([], { ...named, APP_CONFIG: value }))).toMatchObject({
        title: 'walk',
      });
    }
    // Without the setting the variable means nothing.
    expect(received(await space.stdout([], { APP_CONFIG: 'chosen.json' }))).toMatchObject({
      title: 'walk',
    });
  }),
);

test(
  'a variable naming a missing file is silent with no configuration, and one naming a broken file warns once',
  inWorkspace(async (space) => {
    const named = settings({ env: 'APP_CONFIG', notice: true });
    space.write('.app.json', json({ title: 'walk' }));
    space.write('.app.json', json({ title: 'home' }), space.home);
    const missing = await space.run([], { ...named, APP_CONFIG: 'missing.json' });
    expect(missing.stderr).toBe('');
    expect(received(missing.stdout)).toEqual(defaults);
    mkdirSync(join(space.project, 'missing'));
    const beneath = await space.run([], { ...named, APP_CONFIG: 'missing/none.json' });
    expect(beneath.stderr).toBe('');
    expect(received(beneath.stdout)).toEqual(defaults);
    space.write('broken.toml', 'title = ');
    const broken = await space.run([], { ...named, APP_CONFIG: 'broken.toml' });
    expect(broken.stderr).toBe(skipped('broken.toml', invalidToml));
    expect(received(broken.stdout)).toEqual(defaults);
  }),
);

test(
  'the directory option starts the walk there, leaves host.cwd alone, and yields to --config and the variable',
  inWorkspace(async (space) => {
    const other = nest(space.root, 'other', 'deep');
    space.write('.app.json', json({ title: 'other' }), join(space.root, 'other'));
    space.write('.app.json', json({ title: 'cwd' }));
    const named = settings({ directory: { name: 'project' } });
    const absolute = await space.run(['--project', other], named);
    expect(received(absolute.stdout)).toEqual({ ...defaults, project: other, title: 'other' });
    // A relative value resolves against host.cwd, and the walk climbs from it.
    const relative = await space.run(['--project', '../other/deep'], named);
    expect(received(relative.stdout)).toMatchObject({ title: 'other' });
    // A directory that does not exist starts the walk there and goes on through its ancestors.
    const absent = await space.run(['--project', join(other, 'nowhere', 'deeper')], named);
    expect(absent.stderr).toBe('');
    expect(received(absent.stdout)).toMatchObject({ title: 'other' });
    // Host.cwd is unchanged: a relative --config still resolves against it.
    space.write('flag.json', json({ title: 'flag' }));
    expect(
      received(await space.stdout(['--project', other, '--config', 'flag.json'], named)),
    ).toMatchObject({ title: 'flag' });
    space.write('var.json', json({ title: 'var' }));
    expect(
      received(
        await space.stdout(['--project', other], {
          ...settings({ directory: { name: 'project' }, env: 'APP_CONFIG' }),
          APP_CONFIG: 'var.json',
        }),
      ),
    ).toMatchObject({ title: 'var' });
    // Without the operator giving it, the start is host.cwd.
    expect(received(await space.stdout([], named))).toMatchObject({ title: 'cwd' });
  }),
);

test('the directory option is a global string option that is not a control, with its short and description', () => {
  const plain = inspected(settings({ directory: { name: 'project' } })).globals.find(
    (option: { name: string }) => option.name === 'project',
  );
  expect(plain).toMatchObject({
    control: false,
    description: 'Look for the configuration file from this directory.',
    short: null,
    type: 'string',
  });
  expect(plain?.env).toEqual([]);
  const described = inspected(
    settings({ directory: { description: 'The project.', name: 'project', short: 'p' } }),
  ).globals.find((option: { name: string }) => option.name === 'project');
  expect(described).toMatchObject({ description: 'The project.', short: '-p' });
  expect(inspected({}).globals.some((option: { name: string }) => option.name === 'project')).toBe(
    false,
  );
});

test(
  'notice writes one info line naming the first candidate in the start directory when nothing is found',
  inWorkspace(async (space) => {
    const on = settings({ notice: true });
    await expect(space.stderr([], on)).resolves.toBe(notice('.app.json'));
    // Off by default.
    await expect(space.stderr([])).resolves.toBe('');
    // The first candidate of the pattern, and the full path when the start is not host.cwd.
    await expect(
      space.stderr([], settings({ file: '.app.{yaml,json}', notice: true })),
    ).resolves.toBe(notice('.app.yaml'));
    const other = nest(space.root, 'other');
    await expect(
      space.stderr(
        ['--project', other],
        settings({ directory: { name: 'project' }, notice: true }),
      ),
    ).resolves.toBe(notice(join(other, '.app.json')));
    // A file found, a broken file, and a variable naming a missing file write none.
    space.write('.app.json', '{');
    await expect(space.stderr([], on)).resolves.toBe(skipped('.app.json', invalidJson));
    rmSync(join(space.project, '.app.json'));
    space.write('.app.json', '{}', space.home);
    await expect(space.stderr([], on)).resolves.toBe('');
    await expect(
      space.stderr([], {
        ...settings({ env: 'APP_CONFIG', notice: true }),
        APP_CONFIG: 'nope.json',
      }),
    ).resolves.toBe('');
    // A missing --config fails and writes no notice.
    await expect(space.stderr(['--config', 'nope.json'], on)).resolves.toBe(
      namedFailure('nope.json', 'does not exist. Supply the path of an existing file.'),
    );
  }),
);

test(
  'a tmp folder under a directory that holds .git changes no result',
  inWorkspace(async (space) => {
    mkdirSync(join(space.root, '.git'));
    const start = nest(space.project, 'a');
    space.write('.app.json', json({ title: 'project' }), space.project);
    expect(received(await space.stdout([], { FIXTURE_CWD: start }))).toEqual({
      ...defaults,
      title: 'project',
    });
  }),
);

const variableFault = {
  correction:
    'Name a variable such as COLLECTOR_CONFIG: a letter or an underscore, then letters, digits, or underscores.',
  findings: [{ call: 'configuration', mark: '0.env' }],
  rule: '@loomcli/plugins/config/variable-name',
  sentence: 'Plugin "@loomcli/plugins/config" env is not a variable name.',
};

test.each([[''], ['1APP'], ['APP-CONFIG'], ['APP CONFIG'], ['APP=1'], ['É']])(
  'configuration({ env: %j }) throws the variable-name fault at its call',
  (env) => {
    expect(callFault({ env })).toEqual(variableFault);
  },
);

test('configuration() judges the file rules before the env rule', () => {
  expect(callFault({ env: '1', file: '/abs' })).toEqual(pathFault);
});

test.each([
  [{ env: 'APP_CONFIG' }],
  [{ env: '_x9' }],
  [{ notice: true }],
  [{ directory: { name: 'project' } }],
  [{ directory: { description: 'The project.', name: 'project', short: 'p' } }],
] satisfies [Settings][])('configuration(%j) returns its plugin', (value) => {
  expect(callFault(value)).toBe('returned');
});

test('the type rejects a directory named config, which would claim --config', () => {
  const rejected: Omit<ConfigurationSettings<StandardSchemaV1, 'config'>, 'schema'> = {
    // @ts-expect-error A directory option named config would claim the spelling --config.
    directory: { name: 'config' },
  };
  expect(rejected.directory?.name).toBe('config');
});

/** A run of the fixture with the schema it names, the provided value printed, and `-v` lines shown. */
function shown(schema: SchemaName, extra: Overrides = {}): Overrides {
  return { FIXTURE_LOUD: '1', FIXTURE_PROVIDED: '1', FIXTURE_SCHEMA: schema, ...extra };
}

/** The value the action read as provided.config, parsed from the one line it prints. */
function provided(stdout: string): unknown {
  const line = stdout.split('\n').find((entry) => entry.startsWith('config:'));
  expect(line).toBeDefined();
  return JSON.parse(line?.slice('config:'.length) ?? '');
}

test(
  'provided.config is the schema output for the passed file, and for an empty file when no file is found',
  inWorkspace(async (space) => {
    const none = await space.run([], shown('typed'));
    expect(none).toMatchObject({ status: 0, stderr: '' });
    expect(provided(none.stdout)).toEqual({ retries: 3 });
    space.write('.app.json', json({ mode: 'slow', title: 'abc', unknown: { value: 1 } }));
    const found = await space.run(['-L'], shown('typed'));
    expect(found.stderr).toBe('');
    // The default fills and the transform runs. A key the schema does not describe is never reported,
    // And this schema is a loose object, so it reaches the output.
    expect(provided(found.stdout)).toEqual({
      mode: 'slow',
      retries: 3,
      title: 'ABC',
      unknown: { value: 1 },
    });
  }),
);

test(
  'provided.config keeps a path as the file wrote it',
  inWorkspace(async (space) => {
    space.write(
      '.app.json',
      json({ root: '../out', sessions: { sources: [{ dir: './t', harness: 'a' }] } }),
    );
    const result = await space.run([], shown('typed'));
    expect(provided(result.stdout)).toEqual({
      retries: 3,
      root: '../out',
      sessions: { sources: [{ dir: './t', harness: 'a' }] },
    });
  }),
);

test(
  'a value the schema rejects is dropped and named at -v alone, and the rest of the file stays',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ mode: 'slow', updates: { interval: 'soon' } }));
    const quiet = await space.run([], shown('typed', { FIXTURE_LOUD: undefined }));
    expect(quiet).toMatchObject({ status: 0, stderr: '' });
    expect(provided(quiet.stdout)).toEqual({ mode: 'slow', retries: 3, updates: {} });
    const loudly = await space.run(['-L'], shown('typed'));
    expect(loudly.stderr).toBe(
      wrong(
        'Ignored updates.interval in .app.json: Invalid input: expected number, received string',
      ),
    );
    expect(provided(loudly.stdout)).toEqual({ mode: 'slow', retries: 3, updates: {} });
  }),
);

test(
  'a YAML anchor that refers to itself does not stop a run that drops a value',
  inWorkspace(async (space) => {
    space.write('.app.yaml', 'tree: &t\n  name: root\n  child: *t\nretries: many\n');
    const result = await space.run(['-L'], {
      ...loudEnv,
      ...settings({ file: '.app.yaml' }),
      FIXTURE_SCHEMA: 'typed',
    });
    // The printed value is not the schema's output, which holds the cycle and cannot be serialized.
    expect(result.status).toBe(0);
    expect(received(result.stdout)).toMatchObject({ limit: '10' });
    expect(result.stderr).toBe(
      wrong('Ignored retries in .app.yaml: Invalid input: expected number, received string'),
    );
  }),
);

/**
 * The paths a drop announces, in order. A drop that announces more than ten removals fails the
 * case, so a drop that never ends fails instead of hanging.
 */
async function dropCounted(schema: StandardSchemaV1, file: Record<string, unknown>) {
  const removed: unknown[] = [];
  const passed = await dropUntilPasses(schema, file, (removal) => {
    removed.push(removal.path);
    return removed.length > 10
      ? Promise.reject(new Error('The drop announced a removal more than ten times.'))
      : Promise.resolve();
  });
  return { file: passed.file, removed };
}

/** Two keys that hold one value, as a YAML alias makes them: `first: &s {name: hello}`, `second: *s`. */
function aliased(): Record<string, unknown> {
  const shared = { name: 'hello' };
  return { first: shared, second: shared };
}

test('a value an alias reaches is removed at the second path alone, once', async () => {
  const schema = z.looseObject({
    first: z.looseObject({ name: z.string().optional() }).optional(),
    second: z.looseObject({ name: z.number().optional() }).optional(),
  });
  const { file, removed } = await dropCounted(schema, aliased());
  expect(removed).toEqual([['second', 'name']]);
  expect(file).toEqual({ first: { name: 'hello' }, second: {} });
});

test('a value an alias reaches is removed at the first path alone, and the second keeps it', async () => {
  const schema = z.looseObject({
    first: z.looseObject({ name: z.number().optional() }).optional(),
    second: z.looseObject({ name: z.string().optional() }).optional(),
  });
  const { file, removed } = await dropCounted(schema, aliased());
  expect(removed).toEqual([['first', 'name']]);
  expect(file).toEqual({ first: {}, second: { name: 'hello' } });
});

test('a template anchor the schema does not check keeps its value when its alias loses it', async () => {
  const base = { port: 'wrong' };
  const schema = z.looseObject({
    defaults: z.unknown().optional(),
    server: z.object({ port: z.number().optional() }).optional(),
  });
  const { file, removed } = await dropCounted(schema, { defaults: base, server: base });
  expect(removed).toEqual([['server', 'port']]);
  expect(file).toEqual({ defaults: { port: 'wrong' }, server: {} });
});

test('a self-referencing value keeps its cycle after a drop elsewhere', async () => {
  const tree: Record<string, unknown> = { name: 'root' };
  tree.child = tree;
  const { file, removed } = await dropCounted(z.looseObject({ retries: z.number().optional() }), {
    retries: 'many',
    tree,
  });
  expect(removed).toEqual([['retries']]);
  const copied = file.tree;
  expect(copied).not.toBe(tree);
  expect(isRecord(copied) && copied.child).toBe(copied);
});

test(
  'a wrong value at a key falls back to the schema default',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ retries: 'many' }));
    const result = await space.run(['-L'], shown('typed'));
    expect(provided(result.stdout)).toEqual({ retries: 3 });
    expect(result.stderr).toBe(
      wrong('Ignored retries in .app.json: Invalid input: expected number, received string'),
    );
  }),
);

test(
  'an array item with a wrong or missing value is removed whole, and the array keeps its other items',
  inWorkspace(async (space) => {
    space.write(
      '.app.json',
      json({
        sessions: { sources: [{ dir: 1 }, { harness: 'b' }, { harness: 2 }, { harness: 'd' }] },
      }),
    );
    const result = await space.run(['-L'], shown('typed'));
    expect(provided(result.stdout)).toEqual({
      retries: 3,
      sessions: { sources: [{ harness: 'b' }, { harness: 'd' }] },
    });
    expect(result.stderr).toBe(
      wrong(
        'Ignored sessions.sources[0] in .app.json: Invalid input: expected string, received number',
        'Ignored sessions.sources[2] in .app.json: Invalid input: expected string, received number',
      ),
    );
  }),
);

test(
  'a wrong value inside a record removes that value, and the entry that then lacks a key goes the next round',
  inWorkspace(async (space) => {
    space.write(
      '.app.json',
      json({ owners: { alpha: { id: 1 }, beta: { extra: 1 }, gamma: { id: 'ok' } } }),
    );
    const result = await space.run(['-L'], shown('typed'));
    expect(provided(result.stdout)).toEqual({ owners: { gamma: { id: 'ok' } }, retries: 3 });
    expect(result.stderr).toBe(
      wrong(
        'Ignored owners.alpha.id in .app.json: Invalid input: expected string, received number',
        'Ignored owners.beta in .app.json: Invalid input: expected string, received undefined',
        'Ignored owners.alpha in .app.json: Invalid input: expected string, received undefined',
      ),
    );
  }),
);

test(
  'an issue with no path removes every key, and the file then passes as an empty file',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ mode: 'bad', other: 1 }));
    const result = await space.run(['-L'], shown('topRefined'));
    expect(result.stderr).toBe(wrong('Ignored every key in .app.json: Pick another mode.'));
    expect(provided(result.stdout)).toEqual({});
  }),
);

test(
  'a schema that still rejects an empty file is the defect of the author, with code 1',
  inWorkspace(async (space) => {
    const sentence = 'The configuration schema rejects an empty file: Add present.';
    for (const content of [undefined, json({ other: 1 })]) {
      if (content !== undefined) {
        space.write('.app.json', content);
      }
      const result = await space.run([], shown('refined', { FIXTURE_PROVIDED: undefined }));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(sentence);
      expect(result.stderr).toContain('@loomcli/plugins/config/empty-file');
    }
    space.write('.app.json', json({ present: true }));
    await expect(space.run([], shown('refined'))).resolves.toMatchObject({ status: 0, stderr: '' });
  }),
);

test(
  'a linked option takes the file value, not the schema output, and a value the schema removed fills nothing',
  inWorkspace(async (space) => {
    space.write('.app.json', json({ title: 'abc' }));
    const kept = await space.run(['-L'], shown('typed'));
    expect(received(kept.stdout)).toMatchObject({ title: 'abc' });
    expect(provided(kept.stdout)).toMatchObject({ title: 'ABC' });
    space.write('.app.json', json({ title: 5 }));
    const dropped = await space.run(['-L'], shown('typed'));
    expect(received(dropped.stdout)).not.toHaveProperty('title');
    // The schema names the removal once, and the source names no second line for the same value.
    expect(dropped.stderr).toBe(
      wrong('Ignored title in .app.json: Invalid input: expected string, received number'),
    );
  }),
);

test(
  'a schema default never fills a linked option',
  inWorkspace(async (space) => {
    const result = await space.run([], shown('typed'));
    expect(received(result.stdout)).toEqual({ ...defaults, loud: 0 });
  }),
);

test(
  'a relative path in a linked option resolves against the directory of the file, and provided.config keeps it as written',
  inWorkspace(async (space) => {
    const found = space.write('.app.json', json({ root: 'out/dir' }), space.root);
    expect(found).toBe(join(space.root, '.app.json'));
    const walked = await space.run([], shown('typed'));
    expect(received(walked.stdout)).toMatchObject({ root: join(space.root, 'out', 'dir') });
    expect(provided(walked.stdout)).toMatchObject({ root: 'out/dir' });
    space.write('named.json', json({ root: 'out/dir' }), space.elsewhere);
    const named = await space.run(['--config', '../elsewhere/named.json'], shown('typed'));
    expect(received(named.stdout)).toMatchObject({ root: join(space.elsewhere, 'out', 'dir') });
    // An absolute path is the file's own, and the working directory never decides.
    space.write('.app.json', json({ root: '/abs/dir' }), space.project);
    const absolute = await space.run([], shown('typed'));
    expect(received(absolute.stdout)).toMatchObject({ root: '/abs/dir' });
  }),
);

test(
  'the source and the provider share one read, so a warning about a broken file prints once',
  inWorkspace(async (space) => {
    space.write('.app.json', '{');
    const result = await space.run([], shown('typed'));
    expect(result.stderr).toBe(skipped('.app.json', invalidJson));
    expect(provided(result.stdout)).toEqual({ retries: 3 });
  }),
);

test(
  'the provider reads the file when no linked option needs a value, and a run that opts in to nothing reads none',
  inWorkspace(async (space) => {
    space.write('.app.json', '{');
    const { plugin: installed, values } = configuration({ schema: z.object({}) });
    const reading = new Application('app', { plugins: [installed], uses: [values] }).action(
      ({ out }) => out.print('ran'),
    );
    const idle = new Application('app', { plugins: [installed] }).action(({ out }) =>
      out.print('ran'),
    );
    const read = mockProcess({ cwd: space.project, env: { HOME: space.home } });
    await reading.run({ process: read });
    expect(read.stderr.text).toBe(skipped('.app.json', invalidJson));
    const none = mockProcess({ cwd: space.project, env: { HOME: space.home } });
    await idle.run({ process: none });
    expect(none.stderr.text).toBe('');
    expect(none.stdout.text).toBe('ran\n');
  }),
);

test(
  'in an invocation by name, a named file the provider reads first names the config option by declared name',
  inWorkspace(async (space) => {
    const { plugin: installed, values } = configuration({ schema: z.object({}) });
    const reading = new Application('app', {
      plugins: [installed],
      uses: [values],
      views: [
        override(InputError, { render: (failure) => `${JSON.stringify(failure.problems)}\n` }),
      ],
    }).action(({ out }) => out.print('ran'));
    const outcome = await reading.invoke(
      [],
      { options: { config: 'missing.json' } },
      { process: mockProcess({ cwd: space.project, env: { HOME: space.home } }) },
    );
    expect(outcome).toMatchObject({
      messages: `${json([
        {
          input: { global: true, kind: 'option', name: 'config' },
          issues: [
            { message: 'File "missing.json" does not exist. Supply the path of an existing file.' },
          ],
          reason: 'invalid',
          spelling: 'config',
        },
      ])}\n`,
      status: 'failed',
    });
  }),
);

test(
  'a --config file that cannot be used fails the run from the provider as it does from the source',
  inWorkspace(async (space) => {
    const { plugin: installed, values } = configuration({ schema: z.object({}) });
    const reading = new Application('app', { plugins: [installed], uses: [values] }).action(
      ({ out }) => out.print('ran'),
    );
    const mock = mockProcess({
      argv: ['--config', 'missing.json'],
      cwd: space.project,
      env: { HOME: space.home },
    });
    await reading.run({ process: mock });
    expect(mock.exitCode).toBe(2);
    expect(mock.stderr.text).toContain(
      'Option "--config": File "missing.json" does not exist. Supply the path of an existing file.',
    );
  }),
);

/** The fault the graph build throws for an application that links one option into the schema. */
function linkFault(
  installed: Plugin,
  path: string,
  kind: 'boolean' | 'count' | 'multiple' | 'string' = 'string',
) {
  const base = new Application('app', { plugins: [installed] });
  const extensions = [configInput({ path })];
  const declared = {
    boolean: () => base.option('opt', { extensions, type: 'boolean' }),
    count: () => base.option('opt', { extensions, type: 'count' }),
    multiple: () => base.option('opt', { extensions, multiple: true, type: 'string' }),
    string: () => base.option('opt', { extensions, type: 'string' }),
  };
  const linked = declared[kind]().action(() => undefined);
  try {
    linked.inspect();
    return 'built';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return { correction: error.correction, rule: error.rule?.identity, sentence: error.sentence };
  }
}

const pathCorrection = 'Link a path the schema describes, or add the key to the schema.';
const typeCorrection =
  'Link a key that holds a value the option takes: a string or a number for a string option, a Boolean for a Boolean option, a whole number for a counted option, or an array for a multiple option.';

test('a link to a key the schema does not hold is a build fault, and a held key builds', () => {
  const schema = z.object({
    minBytes: z.number().optional(),
    updates: z.object({ channel: z.string().optional() }).optional(),
  });
  expect(linkFault(configuration({ schema }).plugin, 'maxBytes')).toEqual({
    correction: pathCorrection,
    rule: '@loomcli/plugins/config/link-path',
    sentence:
      'The root Command option "opt" links to maxBytes, which the configuration schema does not hold.',
  });
  expect(linkFault(configuration({ schema }).plugin, 'updates.stable')).toMatchObject({
    rule: '@loomcli/plugins/config/link-path',
  });
  expect(linkFault(configuration({ schema }).plugin, 'minBytes')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'updates.channel')).toBe('built');
});

test('a link to a value the option cannot take is a build fault in every branch of a union', () => {
  const schema = z.object({
    flag: z.boolean().optional(),
    list: z.array(z.string()).optional(),
    mixed: z.union([z.boolean(), z.string()]).optional(),
    sessions: z.object({ harness: z.string().optional() }).optional(),
    size: z.number().int().optional(),
    word: z.enum(['a', 'b']).optional(),
  });
  expect(linkFault(configuration({ schema }).plugin, 'sessions')).toEqual({
    correction: typeCorrection,
    rule: '@loomcli/plugins/config/link-type',
    sentence: 'The root Command option "opt" links to sessions, which holds an object.',
  });
  expect(linkFault(configuration({ schema }).plugin, 'flag')).toMatchObject({
    rule: '@loomcli/plugins/config/link-type',
  });
  expect(linkFault(configuration({ schema }).plugin, 'flag', 'boolean')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'size', 'count')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'list', 'multiple')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'word')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'size', 'multiple')).toMatchObject({
    rule: '@loomcli/plugins/config/link-type',
  });
  expect(linkFault(configuration({ schema }).plugin, 'mixed', 'boolean')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'mixed', 'count')).toMatchObject({
    rule: '@loomcli/plugins/config/link-type',
  });
});

test('a union member that lists the key is judged, and an open member that does not list it stops the check', () => {
  const listed = z.looseObject({ fast: z.boolean().optional() });
  const judged = z.object({ pick: z.union([listed, z.object({})]).optional() });
  expect(linkFault(configuration({ schema: judged }).plugin, 'pick.fast')).toMatchObject({
    rule: '@loomcli/plugins/config/link-type',
  });
  const unchecked = z.object({ pick: z.union([listed, z.looseObject({})]).optional() });
  expect(linkFault(configuration({ schema: unchecked }).plugin, 'pick.fast')).toBe('built');
});

test('a link into an open object, a record, an array, or a schema without a shape gets no check', () => {
  const schema = z.object({
    loose: z.looseObject({}).optional(),
    records: z.record(z.string(), z.string()).optional(),
    sources: z.array(z.object({ harness: z.string() })).optional(),
  });
  expect(linkFault(configuration({ schema }).plugin, 'loose.anything')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'records.any.name')).toBe('built');
  expect(linkFault(configuration({ schema }).plugin, 'sources.harness')).toBe('built');
  expect(
    linkFault(
      configuration({ schema: object({ minBytes: optional(number()) }) }).plugin,
      'nothing.here',
    ),
  ).toBe('built');
});
