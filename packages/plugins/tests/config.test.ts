import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/config-run.mjs', import.meta.url);
const settingsFixture = new URL('fixtures/config-settings.mjs', import.meta.url);

/**
 * One temporary workspace per test: a project directory the host's `cwd` points at, and one
 * directory for each home variable, `HOME` and `USERPROFILE`. The child's own working directory
 * is the temporary root, so a file the plugin finds was resolved against `host.cwd` and nothing
 * else.
 */
interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  readonly profile: string;
  /** Runs the fixture with each home variable pointed at its own directory. */
  run(argv: string[], env?: Record<string, string | undefined>): ReturnType<typeof invoke>;
  /** Writes one file, creating its directories, and answers its path. */
  write(relative: string, content: string, base?: string): string;
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'loom-config-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const profile = join(root, 'profile');
  for (const directory of [project, home, profile]) {
    mkdirSync(directory);
  }
  return {
    home,
    profile,
    project,
    root,
    run: (argv, env = {}) =>
      invoke(fixture, ['run', ...argv], {
        cwd: root,
        env: { FIXTURE_CWD: project, HOME: home, USERPROFILE: profile, ...env },
      }),
    write: (relative, content, base = project) => {
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

/** Pairs of strings a test walks, such as a file and its content. */
type Pairs = readonly (readonly [string, string])[];

function json(value: unknown): string {
  return JSON.stringify(value);
}

/** The environment that installs the plugin with one settings object. */
function settings(value: unknown): Record<string, string> {
  return { FIXTURE_SETTINGS: JSON.stringify(value) };
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

/** The failure a wrong value prints. */
function wrong(clause: string): string {
  return `app: ${clause}\n${helpHint}`;
}

const invalidJson = 'is not valid JSON. Correct its syntax, or remove it.';
const notObject =
  'does not hold a JSON object. Write its settings as one JSON object, or remove it.';
const invalidToml = 'is not valid TOML. Correct its syntax, or remove it.';
const invalidYaml = 'is not valid YAML. Correct its syntax, or remove it.';
const notMapping =
  'does not hold a YAML mapping. Write its settings as one YAML mapping, or remove it.';

test(
  'with no settings the plugin reads .<app>.json in the working directory, then in the home directory',
  inWorkspace((space) => {
    const silent = space.run([]);
    expect(silent).toMatchObject({ status: 0, stderr: '' });
    expect(received(silent.stdout)).toEqual(defaults);
    space.write('.app.json', json({ title: 'home' }), space.home);
    expect(received(space.run([]).stdout)).toEqual({ ...defaults, title: 'home' });
    // A file in the working directory hides the home file entirely, so the home title is not read.
    space.write('.app.json', json({ limits: { bytes: '1' } }));
    expect(received(space.run([]).stdout)).toEqual({ ...defaults, limit: '1' });
  }),
);

test(
  'the lookup never reads the process working directory, a parent directory, or a ~ path',
  inWorkspace((space) => {
    space.write('.app.json', json({ title: 'process' }), space.root);
    expect(received(space.run([], { HOME: undefined }).stdout)).toEqual(defaults);
    space.write('.app.json', json({ title: 'parent' }));
    const nested = join(space.project, 'nested');
    mkdirSync(nested);
    expect(received(space.run([], { FIXTURE_CWD: nested, HOME: undefined }).stdout)).toEqual(
      defaults,
    );
    expect(space.run(['--config', '~/.app.json'])).toMatchObject({
      status: 2,
      stderr: namedFailure('~/.app.json', 'does not exist. Supply the path of an existing file.'),
    });
  }),
);

test(
  'the home directory is USERPROFILE on win32 and HOME elsewhere, and an unset, empty, or relative one is none',
  inWorkspace((space) => {
    space.write('.app.json', json({ title: 'home' }), space.home);
    space.write('.app.json', json({ title: 'profile' }), space.profile);
    expect(received(space.run([]).stdout)).toMatchObject({ title: 'home' });
    expect(received(space.run([], { FIXTURE_PLATFORM: 'win32' }).stdout)).toMatchObject({
      title: 'profile',
    });
    // A relative home names a directory under the working directory, which the plugin never reads.
    space.write('home/.app.json', json({ title: 'relative' }));
    for (const home of [undefined, '', 'home']) {
      expect(received(space.run([], { HOME: home }).stdout)).toEqual(defaults);
      expect(
        received(space.run([], { FIXTURE_PLATFORM: 'win32', USERPROFILE: home }).stdout),
      ).toEqual(defaults);
    }
  }),
);

test(
  'a broken file in the working directory warns and the home file answers, and a home that is the working directory is read once',
  inWorkspace((space) => {
    space.write('.app.json', '{');
    space.write('.app.json', json({ title: 'home' }), space.home);
    const result = space.run([]);
    expect(result).toMatchObject({ status: 0, stderr: skipped('.app.json', invalidJson) });
    expect(received(result.stdout)).toEqual({ ...defaults, title: 'home' });
    for (const home of [space.project, `${space.project}/`]) {
      const once = space.run([], { HOME: home });
      expect(once).toMatchObject({ status: 0, stderr: skipped('.app.json', invalidJson) });
      expect(received(once.stdout)).toEqual(defaults);
    }
  }),
);

test(
  '--config names the one file a run reads, and a bad named file fails the run',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: { bytes: '2' } }));
    space.write('.app.json', json({ total: true }), space.home);
    space.write('pinned.json', json({ title: 'pinned' }));
    expect(received(space.run(['--config', 'pinned.json']).stdout)).toEqual({
      ...defaults,
      config: 'pinned.json',
      title: 'pinned',
    });
    // The named path is no pattern, so its braces are part of the name, and it reads as JSON.
    space.write('.app.{toml,json}', json({ title: 'braces' }));
    expect(received(space.run(['--config', '.app.{toml,json}']).stdout)).toMatchObject({
      title: 'braces',
    });
    expect(space.run(['--config', 'missing.json'])).toEqual({
      status: 2,
      stderr: namedFailure('missing.json', 'does not exist. Supply the path of an existing file.'),
      stdout: 'resolved:2\n',
    });
    space.write('broken.json', '{');
    expect(space.run(['--config', 'broken.json'])).toEqual({
      status: 2,
      stderr: namedFailure(
        'broken.json',
        'is not valid JSON. Correct its syntax, or supply another file.',
      ),
      stdout: 'resolved:2\n',
    });
    space.write('list.json', '[]');
    expect(space.run(['--config', 'list.json'])).toEqual({
      status: 2,
      stderr: namedFailure(
        'list.json',
        'does not hold a JSON object. Write its settings as one JSON object.',
      ),
      stdout: 'resolved:2\n',
    });
    mkdirSync(join(space.project, 'dir.json'));
    expect(space.run(['--config', 'dir.json']).stderr).toBe(
      namedFailure('dir.json', 'could not be read. Supply a file this process can read.'),
    );
    // The takeover reports nothing, and a run that needs no value reads no file.
    const help = space.run(['--config', 'missing.json', '--help']);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe('');
    const filled = space.run([
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
      title: 't',
      total: true,
      verbose: 1,
    });
  }),
);

test(
  'short gives --config a short spelling, and with none --config has no short spelling',
  inWorkspace((space) => {
    space.write('pinned.json', json({ title: 'pinned' }));
    expect(received(space.run(['-c', 'pinned.json'], settings({ short: 'c' })).stdout)).toEqual({
      ...defaults,
      config: 'pinned.json',
      title: 'pinned',
    });
    expect(space.run(['-c', 'missing.json'], settings({ short: 'c' })).stderr).toBe(
      namedFailure('missing.json', 'does not exist. Supply the path of an existing file.'),
    );
    expect(space.run(['-c', 'pinned.json']).status).toBe(2);
  }),
);

test(
  'a discovered file that is missing is silent, and one that is broken warns once and is skipped',
  inWorkspace((space) => {
    mkdirSync(join(space.project, '.app.json'));
    const directory = space.run([]);
    expect(directory).toMatchObject({
      status: 0,
      stderr: skipped('.app.json', 'could not be read. Make it readable, or remove it.'),
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
      expect(space.run([])).toMatchObject({ status: 0, stderr: skipped('.app.json', clause) });
    }
    rmSync(join(space.project, '.app.json'));
    const home = space.write('.app.json', 'true', space.home);
    const result = space.run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe(skipped(home, notObject));
    expect(result.stdout.startsWith('app')).toBe(true);
    // A file under a missing directory, or under a file in place of a directory, is silent.
    expect(space.run([], settings({ file: 'absent/.app.json' })).stderr).toBe('');
    writeFileSync(join(space.project, 'plain'), 'a file, not a directory');
    expect(space.run([], settings({ file: 'plain/.app.json' })).stderr).toBe('');
  }),
);

test(
  'the extension chooses the parser, as written, for a discovered file and the named file',
  inWorkspace((space) => {
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
      const discovered = space.run([], settings({ file }));
      expect(discovered).toMatchObject({ status: 0, stderr: '' });
      expect(received(discovered.stdout)).toEqual(filled);
      expect(received(space.run(['--config', file]).stdout)).toEqual({ ...filled, config: file });
    }
    // An extension compares as written, so .TOML reads as JSON.
    space.write('.app.TOML', 'total = true\n');
    expect(space.run([], settings({ file: '.app.TOML' })).stderr).toBe(
      skipped('.app.TOML', invalidJson),
    );
    // A leading dot starts the name, so .toml is a name with no extension and reads as JSON.
    space.write('.toml', 'total = true\n');
    expect(space.run([], settings({ file: '.toml' })).stderr).toBe(skipped('.toml', invalidJson));
  }),
);

test(
  'the first present candidate is read, and every later present one is skipped unread with one warning first',
  inWorkspace((space) => {
    const any = settings({ file: '.app.*' });
    space.write('.app.json', json({ title: 'json' }));
    expect(space.run([], any)).toMatchObject({ status: 0, stderr: '' });
    space.write('.app.yml', 'title: yml\n');
    const yml = space.run([], any);
    expect(yml.stderr).toBe(several('.app.json', '.app.yml'));
    expect(received(yml.stdout)).toMatchObject({ title: 'yml' });
    // A skipped candidate is never read, so a broken one adds no warning of its own.
    space.write('.app.json', '{');
    space.write('.app.yaml', 'title: [');
    space.write('.app.toml', 'title = "toml"\n');
    const toml = space.run([], any);
    expect(toml.stderr).toBe(several('.app.yaml, .app.yml, .app.json', '.app.toml'));
    expect(received(toml.stdout)).toMatchObject({ title: 'toml' });
    // A broken first candidate is never replaced by a later one, and the lookup goes on to home.
    space.write('.app.toml', 'title = ');
    space.write('.app.json', json({ title: 'home' }), space.home);
    const broken = space.run([], any);
    expect(broken.stderr).toBe(
      `${several('.app.yaml, .app.yml, .app.json', '.app.toml')}${skipped('.app.toml', invalidToml)}`,
    );
    expect(received(broken.stdout)).toMatchObject({ title: 'home' });
  }),
);

test(
  'a brace list orders its candidates as listed, a repeated extension counting at its first position',
  inWorkspace((space) => {
    space.write('.app.toml', 'title = "toml"\n');
    space.write('.app.json', json({ title: 'json' }));
    const listed = space.run([], settings({ file: '.app.{json,toml,json}' }));
    expect(listed.stderr).toBe(several('.app.toml', '.app.json'));
    expect(received(listed.stdout)).toMatchObject({ title: 'json' });
    const literal = space.run([], settings({ file: '.app.toml' }));
    expect(literal).toMatchObject({ status: 0, stderr: '' });
    expect(received(literal.stdout)).toMatchObject({ title: 'toml' });
  }),
);

test(
  'a file in the working directory shows as file names it, and one in the home directory as its full path',
  inWorkspace((space) => {
    const nested = settings({ file: '.app/config.{yaml,json}' });
    space.write('.app/config.yaml', 'limits: { bytes: many }\n');
    expect(space.run([], nested).stderr).toBe(
      wrong('Option "--limit" (from limits.bytes in .app/config.yaml): Supply a whole number.'),
    );
    rmSync(join(space.project, '.app'), { recursive: true });
    const yaml = space.write('.app/config.yaml', 'limits: { bytes: many }\n', space.home);
    const json5 = space.write('.app/config.json', '{}', space.home);
    const result = space.run([], nested);
    expect(result.stderr).toBe(
      `${several(json5, yaml)}${wrong(`Option "--limit" (from limits.bytes in ${yaml}): Supply a whole number.`)}`,
    );
  }),
);

test(
  'a TOML number fills as JSON writes it, a large integer as its exact digits, and a date or time as written',
  inWorkspace((space) => {
    const toml = settings({ file: '.app.toml' });
    space.write(
      '.app.toml',
      [
        'title = 1979-05-27T07:32:00-08:00',
        'fields = [1979-05-27 07:32:00, 1979-05-27, 07:32:00.5, 1979-05-27t07:32:00.999999z, 5_000, 0x1F, 1.0, -9223372036854775808]',
        '[limits]',
        'bytes = 12345678901234567890',
        '',
      ].join('\n'),
    );
    expect(received(space.run([], toml).stdout)).toEqual({
      ...defaults,
      fields: [
        '1979-05-27 07:32:00',
        '1979-05-27',
        '07:32:00.5',
        '1979-05-27t07:32:00.999999z',
        '5000',
        '31',
        '1',
        '-9223372036854775808',
      ],
      limit: '12345678901234567890',
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
      received(space.run([], { ...toml, FIXTURE_LIMIT_PATH: '1979-05-27.bytes' }).stdout),
    ).toEqual({
      ...defaults,
      fields: ['x 1979-05-27', 'a 07:32:00"', 'b " 07:32:00', 'c """ 07:32:00', '07:32:00'],
      limit: '5',
      title: '1979-05-27 07:32:00',
    });
  }),
);

test(
  'a counted option takes a whole number of 0 or more, and any other value is a wrong value',
  inWorkspace((space) => {
    space.write('.app.json', json({ verbose: 3 }));
    expect(received(space.run([]).stdout)).toEqual({ ...defaults, verbose: 3 });
    space.write('.app.json', json({ verbose: 0 }));
    expect(received(space.run([]).stdout)).toEqual(defaults);
    expect(received(space.run(['-v']).stdout)).toEqual({ ...defaults, verbose: 1 });
    for (const value of ['3', -1, 1.5, true]) {
      space.write('.app.json', json({ verbose: value }));
      expect(space.run([])).toEqual({
        status: 2,
        stderr: wrong(
          'Option "--verbose" (from verbose in .app.json): Use a whole number of 0 or more.',
        ),
        stdout: 'resolved:2\n',
      });
    }
    const toml = settings({ file: '.app.toml' });
    space.write('.app.toml', 'verbose = 1_0\n');
    expect(received(space.run([], toml).stdout)).toEqual({ ...defaults, verbose: 10 });
    const yaml = settings({ file: '.app.yaml' });
    space.write('.app.yaml', 'verbose: 0x3\n');
    expect(received(space.run([], yaml).stdout)).toEqual({ ...defaults, verbose: 3 });
  }),
);

test(
  'a string option with an implied value takes a value by the string rule, never its implied value',
  inWorkspace((space) => {
    space.write('.app.json', json({ backup: 'numbered' }));
    expect(received(space.run([]).stdout)).toEqual({ ...defaults, backup: 'numbered' });
    expect(received(space.run(['--backup']).stdout)).toEqual({ ...defaults, backup: 'simple' });
    space.write('.app.json', json({ backup: true }));
    expect(space.run([]).stderr).toBe(
      wrong('Option "--backup" (from backup in .app.json): Use a string or a number.'),
    );
  }),
);

test(
  'a TOML value the option cannot take is a wrong value, and an invalid date is invalid TOML',
  inWorkspace((space) => {
    const toml = settings({ file: '.app.toml' });
    const cases: Pairs = [
      ['total = 1979-05-27\n', 'Option "--total" (from total in .app.toml): Use true or false.'],
      ['title = inf\n', 'Option "--title" (from title in .app.toml): Use a string or a number.'],
      ['title = nan\n', 'Option "--title" (from title in .app.toml): Use a string or a number.'],
      ['[title]\n', 'Option "--title" (from title in .app.toml): Use a string or a number.'],
      [
        'fields = [1, -inf]\n',
        'Option "--fields" (from fields in .app.toml) at 1: Use a string or a number.',
      ],
    ];
    for (const [content, line] of cases) {
      space.write('.app.toml', content);
      expect(space.run([], toml)).toMatchObject({ status: 2, stderr: wrong(line) });
    }
    space.write('.app.toml', '');
    const empty = space.run([], toml);
    expect(empty).toMatchObject({ status: 0, stderr: '' });
    expect(received(empty.stdout)).toEqual(defaults);
    for (const content of ['title = 1979-13-45\n', 'title = "open\n', 'a = 1\na = 2\n']) {
      space.write('.app.toml', content);
      expect(space.run([], toml).stderr).toBe(skipped('.app.toml', invalidToml));
      expect(space.run(['--config', '.app.toml']).stderr).toBe(
        namedFailure('.app.toml', 'is not valid TOML. Correct its syntax, or supply another file.'),
      );
    }
  }),
);

test(
  'a YAML file reads under the core schema, with aliases resolved and a non-string key as its text',
  inWorkspace((space) => {
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
    expect(received(space.run([], yaml).stdout)).toEqual({
      fields: ['debug', '31', '1', 'no'],
      help: false,
      level: 'debug',
      limit: '10',
      quiet: false,
      title: '2001-12-14',
      total: true,
      verbose: 0,
    });
    for (const [key, path] of [
      ['0x1F', '0x1F'],
      ['true', 'true'],
      ['~', '~'],
    ]) {
      space.write('.app.yaml', `${key}: 7\n`);
      expect(received(space.run([], { ...yaml, FIXTURE_LIMIT_PATH: path }).stdout)).toMatchObject({
        limit: '7',
      });
    }
  }),
);

test(
  'a YAML value the option cannot take is a wrong value',
  inWorkspace((space) => {
    const yaml = settings({ file: '.app.yaml' });
    const cases: Pairs = [
      ['total: no\n', 'Option "--total" (from total in .app.yaml): Use true or false.'],
      ['total: on\n', 'Option "--total" (from total in .app.yaml): Use true or false.'],
      ['title: null\n', 'Option "--title" (from title in .app.yaml): Use a string or a number.'],
      ['title: ~\n', 'Option "--title" (from title in .app.yaml): Use a string or a number.'],
      ['title:\n', 'Option "--title" (from title in .app.yaml): Use a string or a number.'],
      ['title: .inf\n', 'Option "--title" (from title in .app.yaml): Use a string or a number.'],
      ['title: .nan\n', 'Option "--title" (from title in .app.yaml): Use a string or a number.'],
      [
        'title: { a: 1 }\n',
        'Option "--title" (from title in .app.yaml): Use a string or a number.',
      ],
    ];
    for (const [content, line] of cases) {
      space.write('.app.yaml', content);
      expect(space.run([], yaml)).toMatchObject({ status: 2, stderr: wrong(line) });
    }
  }),
);

test(
  'a YAML file outside one core-schema document with unique scalar keys is not valid YAML, and no parser warning prints',
  inWorkspace((space) => {
    const yaml = settings({ file: '.app.yaml' });
    const invalid = [
      'title: a\n---\ntitle: b\n',
      'title: a\ntitle: b\n',
      '1: a\n"1": b\n',
      'title: !!binary aGVsbG8=\n',
      'title: !!timestamp 2001-12-14\n',
      'title: !local value\n',
      'title: !!set { a }\n',
      '? { a: 1 }\n: 2\n',
      '[a, b]: 1\n',
      'base: &base { a: 1 }\n*base : 2\n',
      'title: [\n',
    ];
    for (const content of invalid) {
      space.write('.app.yaml', content);
      expect(space.run([], yaml)).toMatchObject({
        status: 0,
        stderr: skipped('.app.yaml', invalidYaml),
      });
      expect(space.run(['--config', '.app.yaml']).stderr).toBe(
        namedFailure('.app.yaml', 'is not valid YAML. Correct its syntax, or supply another file.'),
      );
    }
    for (const content of ['', '# only a comment\n', '---\n', '- a\n', 'hello\n']) {
      space.write('.app.yaml', content);
      expect(space.run([], yaml)).toMatchObject({
        status: 0,
        stderr: skipped('.app.yaml', notMapping),
      });
      expect(space.run(['--config', '.app.yaml']).stderr).toBe(
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
  inWorkspace((space) => {
    const yaml = settings({ file: '.app.yaml' });
    space.write('.app.yaml', 'title: home\n', space.home);
    const unresolved = [
      'defaults: &defaults 5\ntitle: *defualts\n',
      'title: *later\nlater: &later 1\n',
      '*nope : 1\ntitle: own\n',
    ];
    for (const content of unresolved) {
      space.write('.app.yaml', content);
      const discovered = space.run([], yaml);
      expect(discovered).toMatchObject({ status: 0, stderr: skipped('.app.yaml', invalidYaml) });
      expect(received(discovered.stdout)).toEqual({ ...defaults, title: 'home' });
      expect(space.run(['--config', '.app.yaml'])).toMatchObject({
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
    expect(space.run([], { ...yaml, LOG_STREAM: '1', LOG_TOKENS: '1' })).toEqual({
      status: 0,
      stderr: '',
      stdout: `${expected}debug:1,1\n`,
    });
    expect(space.run([], { ...yaml, LOG_STREAM: 'yes', LOG_TOKENS: undefined })).toEqual({
      status: 0,
      stderr: '',
      stdout: `${expected}debug:yes,absent\n`,
    });
  }),
);

test(
  'a leading byte order mark reads in every format, and an empty named file is not valid JSON',
  inWorkspace((space) => {
    const mark = String.fromCodePoint(65_279);
    const marked: Pairs = [
      ['.app.json', json({ title: 'bom' })],
      ['.app.toml', 'title = "bom"\n'],
      ['.app.yaml', 'title: bom\n'],
    ];
    for (const [file, content] of marked) {
      space.write(file, `${mark}${content}`);
      expect(received(space.run([], settings({ file })).stdout)).toMatchObject({ title: 'bom' });
    }
    space.write('empty.json', '');
    expect(space.run(['--config', 'empty.json']).stderr).toBe(
      namedFailure('empty.json', 'is not valid JSON. Correct its syntax, or supply another file.'),
    );
  }),
);

test(
  'a key that holds a right-to-left override is escaped wherever a diagnostic quotes it',
  inWorkspace((space) => {
    const key = `li\u{202e}mits`;
    const path = { FIXTURE_LIMIT_PATH: `${key}.bytes` };
    space.write('.app.json', JSON.stringify({ [key]: { bytes: { max: 5 } } }));
    expect(space.run([], path).stderr).toBe(
      wrong(
        String.raw`Option "--limit" (from li\u202emits.bytes in .app.json): Use a string or a number.`,
      ),
    );
    space.write('.app.json', JSON.stringify({ [key]: { bytes: 'abc' } }));
    expect(space.run([], path).stderr).toBe(
      wrong(
        String.raw`Option "--limit" (from li\u202emits.bytes in .app.json): Supply a whole number.`,
      ),
    );
  }),
);

test(
  'a value follows the option type, and a wrong value is a usage failure naming the file',
  inWorkspace((space) => {
    space.write(
      '.app.json',
      json({ fields: ['a', 2], limits: { bytes: 5 }, quiet: false, total: true }),
    );
    expect(received(space.run([]).stdout)).toEqual({
      fields: ['a', '2'],
      help: false,
      limit: '5',
      quiet: false,
      total: true,
      verbose: 0,
    });
    space.write('.app.json', json({ total: 'yes' }));
    expect(space.run([])).toEqual({
      status: 2,
      stderr: wrong('Option "--total" (from total in .app.json): Use true or false.'),
      stdout: 'resolved:2\n',
    });
    space.write('.app.json', json({ limits: { bytes: { max: 5 } } }));
    expect(space.run([]).stderr).toBe(
      wrong('Option "--limit" (from limits.bytes in .app.json): Use a string or a number.'),
    );
    space.write('.app.json', json({ quiet: 'no' }));
    expect(space.run([]).stderr).toBe(
      wrong('Option "--no-quiet" (from quiet in .app.json): Use true or false.'),
    );
    space.write('.app.json', json({ fields: 'a' }));
    expect(space.run([]).stderr).toBe(
      wrong('Option "--fields" (from fields in .app.json): Use an array of strings or numbers.'),
    );
    space.write('.app.json', json({ fields: ['a', {}, null] }));
    expect(space.run([]).stderr).toBe(
      wrong(
        'Option "--fields" (from fields in .app.json) at 1: Use a string or a number.\napp: Option "--fields" (from fields in .app.json) at 2: Use a string or a number.',
      ),
    );
    space.write('.app.json', json({ title: null }));
    expect(space.run([]).stderr).toBe(
      wrong('Option "--title" (from title in .app.json): Use a string or a number.'),
    );
    // An overflowing literal parses as Infinity, which is no JSON number.
    space.write('.app.json', '{"title": 1e400, "fields": [-0, 1e21, -1e400]}');
    expect(space.run([]).stderr).toBe(
      wrong(
        'Option "--fields" (from fields in .app.json) at 2: Use a string or a number.\napp: Option "--title" (from title in .app.json): Use a string or a number.',
      ),
    );
    space.write('.app.json', '{"fields": [-0, 1e21]}');
    expect(received(space.run([]).stdout)).toMatchObject({ fields: ['0', '1e+21'] });
  }),
);

test(
  'an empty array fills a multiple option, and two wrong values print in request order, each line opening with the application name',
  inWorkspace((space) => {
    space.write('.app.json', json({ fields: [] }));
    expect(received(space.run([]).stdout)).toEqual(defaults);
    space.write('.app.json', json({ limits: { bytes: true }, log: { level: 7 }, title: false }));
    expect(space.run([]).stderr).toBe(
      [
        'app: Option "--limit" (from limits.bytes in .app.json): Use a string or a number.',
        'app: Option "--title" (from title in .app.json): Use a string or a number.',
        'Run "app --help" to see the usage.',
        '',
      ].join('\n'),
    );
    expect(received(space.run(['--limit', '1', '--title', 't']).stdout)).toMatchObject({
      level: '7',
    });
  }),
);

test(
  'a path that meets a missing key or a non-object leads to no value, and the option takes its default',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: 5 }));
    expect(received(space.run([]).stdout)).toMatchObject({ limit: '10' });
    space.write('.app.json', json({ limits: { size: '1' } }));
    expect(received(space.run([]).stdout)).toMatchObject({ limit: '10' });
  }),
);

test(
  'a segment named after an Object.prototype member answers only from an own key',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: { bytes: '1' } }));
    expect(received(space.run([]).stdout)).not.toHaveProperty('owner');
    const owned: Pairs = [
      ['.app.json', json({ constructor: 'own' })],
      ['.app.toml', 'constructor = "own"\n'],
      ['.app.yaml', 'constructor: own\n'],
    ];
    for (const [file, content] of owned) {
      space.write(file, content);
      expect(received(space.run([], settings({ file })).stdout)).toMatchObject({ owner: 'own' });
    }
    // A YAML __proto__ key is an own key, which a request path reaches like any other.
    space.write('.app.yaml', '__proto__:\n  bytes: 7\n');
    expect(
      received(
        space.run([], { ...settings({ file: '.app.yaml' }), FIXTURE_LIMIT_PATH: '__proto__.bytes' })
          .stdout,
      ),
    ).toMatchObject({ limit: '7' });
  }),
);

test(
  'a wrong value problem carries whether the option is global, and reaches an InputError view',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: { bytes: false }, log: { level: true } }));
    expect(space.run([], { FIXTURE_VIEWS: 'input' }).stderr).toBe(
      `${JSON.stringify([
        {
          input: { global: true, kind: 'option', name: 'level' },
          issues: [{ message: 'Use a string or a number.' }],
          reason: 'invalid',
          spelling: '--level',
        },
        {
          input: { global: false, kind: 'option', name: 'limit' },
          issues: [{ message: 'Use a string or a number.' }],
          reason: 'invalid',
          spelling: '--limit',
        },
      ])}\n`,
    );
  }),
);

test(
  'a bad path in the binding throws a declaration error at the call',
  inWorkspace((space) => {
    expect(space.run([], { FIXTURE_LIMIT_PATH: 'a..b' }).stdout).toBe(
      'DeclarationError: The root Command option "limit" holds an invalid "@loomcli/plugins/config/input" value: Supply a dotted path of nonempty keys with no control character. Correct the value.\n',
    );
  }),
);

test(
  'a control character in a file path prints as its escape wherever the path leaves the plugin',
  inWorkspace((space) => {
    const escape = String.fromCodePoint(27);
    const escaped = String.raw`esc\u001bape`;
    expect(space.run(['--config', `esc${escape}ape`]).stderr).toBe(
      namedFailure(escaped, 'does not exist. Supply the path of an existing file.'),
    );
    space.write(`esc${escape}ape`, json({ limits: { bytes: 'x' } }));
    expect(space.run(['--config', `esc${escape}ape`]).stderr).toBe(
      `app: Option "--limit" (from limits.bytes in ${escaped}): Supply a whole number.\n${helpHint}`,
    );
    const home = join(space.root, `h${escape}ome`);
    const shownHome = join(space.root, String.raw`h\u001bome`);
    space.write('.app.json', '[]', home);
    expect(space.run([], { HOME: home }).stderr).toBe(
      skipped(join(shownHome, '.app.json'), notObject),
    );
    space.write('.app.toml', 'title = "toml"\n', home);
    expect(space.run([], { ...settings({ file: '.app.{toml,json}' }), HOME: home }).stderr).toBe(
      several(join(shownHome, '.app.json'), join(shownHome, '.app.toml')),
    );
    // A C1 control and a line separator escape too, and a style marker prints literally.
    const odd = `a${String.fromCodePoint(133)}b${String.fromCodePoint(8232)}c`;
    expect(space.run(['--config', odd]).stderr).toBe(
      namedFailure(
        String.raw`a\u0085b\u2028c`,
        'does not exist. Supply the path of an existing file.',
      ),
    );
    // A well-formed style frame, which an unescaped warning would read as styling and strip.
    const marked = `${String.fromCodePoint(57_344)}["style",[["foreground","red"]]]${String.fromCodePoint(57_345)}m${String.fromCodePoint(57_346)}`;
    const markedHome = join(space.root, `h${marked}ome`);
    space.write('.app.json', '[]', markedHome);
    expect(space.run([], { HOME: markedHome }).stderr).toBe(
      skipped(join(markedHome, '.app.json'), notObject),
    );
  }),
);

test(
  'inspect() lists the --config option and the binding value on each bound option',
  inWorkspace((space) => {
    const inspected = (env: Record<string, string>) => {
      const result = invoke(fixture, ['inspect'], { cwd: space.root, env });
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout);
    };
    const graph = inspected({});
    expect(
      graph.globals.find((option: { name: string }) => option.name === 'config'),
    ).toMatchObject({
      description: 'Read configuration from this file alone.',
      short: null,
      type: 'string',
    });
    expect(
      graph.root.options.find((option: { name: string }) => option.name === 'limit').extensions,
    ).toEqual({ '@loomcli/plugins/config/input': { path: 'limits.bytes' } });
    expect(
      inspected(settings({ short: 'c' })).globals.find(
        (option: { name: string }) => option.name === 'config',
      ),
    ).toMatchObject({ short: '-c' });
  }),
);

/** The fault a `config()` call throws for settings given as JSON, or `"returned"` when it returns. */
function callFault(value: unknown): unknown {
  const result = invoke(settingsFixture, value === undefined ? [] : [JSON.stringify(value)]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

const pathFault = {
  correction:
    'Supply a relative path such as .textstat.toml, with no control character and no empty, ., or .. segment.',
  findings: [{ call: 'config', mark: '0.file' }],
  rule: '@loomcli/plugins/config/file-path',
  sentence: 'Plugin "@loomcli/plugins/config" file is not a relative path.',
};

const globFault = {
  correction:
    'Write the name literally, and use * or a brace list only as the whole text after its last dot.',
  findings: [{ call: 'config', mark: '0.file' }],
  rule: '@loomcli/plugins/config/file-pattern',
  sentence:
    'Plugin "@loomcli/plugins/config" file holds glob syntax other than an extension of * or a brace list.',
};

const listFault = {
  correction: 'List only json, toml, yaml, or yml in the braces, or use * for any of them.',
  findings: [{ call: 'config', mark: '0.file' }],
  rule: '@loomcli/plugins/config/file-pattern',
  sentence: 'Plugin "@loomcli/plugins/config" file lists an extension the plugin cannot read.',
};

test.each([
  [7],
  [''],
  [null],
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
  [`.text${String.fromCodePoint(1)}stat.json`],
  [`.text${String.fromCodePoint(127)}stat.json`],
  ['/*.json'],
])('config({ file: %j }) throws the file-path fault at its call', (file) => {
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
])('config({ file: %j }) throws the glob fault of the file-pattern rule', (file) => {
  expect(callFault({ file })).toEqual(globFault);
});

test.each([
  ['.textstat.{toml,ini}'],
  ['.textstat.{toml,}'],
  ['.textstat.{}'],
  ['.textstat.{TOML}'],
])('config({ file: %j }) throws the extension-list fault of the file-pattern rule', (file) => {
  expect(callFault({ file })).toEqual(listFault);
});

test('config() judges the settings and short first, then the path, then the pattern', () => {
  expect(callFault(5)).toMatchObject({
    findings: [{ call: 'config', mark: '0' }],
    rule: '@loomcli/core/not-an-object',
  });
  expect(callFault({ file: '/*.json', short: 'cc' })).toMatchObject({
    findings: [{ call: 'config', mark: '0.short' }],
    rule: '@loomcli/core/short-alias',
  });
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
])('config(%j) returns its plugin', (value) => {
  expect(callFault(value)).toBe('returned');
});
