import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/config-run.mjs', import.meta.url);

/**
 * One temporary workspace per test: a project directory the host's `cwd` points at, and one
 * directory per variable the user file derives from. The child's own working directory is the
 * temporary root, so a file the plugin finds was resolved against `host.cwd` and nothing else.
 */
interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly home: string;
  readonly xdg: string;
  readonly appdata: string;
  /** Runs the fixture with each user-file variable pointed at its own directory. */
  run(
    scenario: string,
    argv: string[],
    env?: Record<string, string | undefined>,
  ): ReturnType<typeof invoke>;
  /** Writes one file, creating its directories, and answers its path. */
  write(relative: string, content: string, base?: string): string;
}

function workspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'loom-config-'));
  const project = join(root, 'project');
  const home = join(root, 'home');
  const xdg = join(root, 'xdg');
  const appdata = join(root, 'appdata');
  for (const directory of [project, home, xdg, appdata]) {
    mkdirSync(directory);
  }
  return {
    appdata,
    home,
    project,
    root,
    run: (scenario, argv, env = {}) =>
      invoke(fixture, [scenario, 'run', ...argv], {
        cwd: root,
        env: { APPDATA: appdata, FIXTURE_CWD: project, HOME: home, XDG_CONFIG_HOME: xdg, ...env },
      }),
    write: (relative, content, base = project) => {
      const path = join(base, relative);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
    xdg,
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

/** The options the action received, parsed from the one line it prints. */
function received(stdout: string): unknown {
  const line = stdout.split('\n').find((entry) => entry.startsWith('root:'));
  expect(line).toBeDefined();
  return JSON.parse(line?.slice('root:'.length) ?? '');
}

const defaults = { fields: [], limit: '10', quiet: true, total: false };

/** The failure the named file prints for one clause. */
function namedFailure(path: string, clause: string): string {
  return `Invalid input: Option "--config": File "${path}" ${clause}\n`;
}

/** The warning a discovered file prints for one clause. */
function skipped(file: string, clause: string): string {
  return `⚠ Skipped ${file}: the file ${clause}\n`;
}

/** The failure a wrong value prints. */
function wrong(clause: string): string {
  return `Invalid input: ${clause}\n`;
}

test(
  'the user file derives from the application name under each platform rule',
  inWorkspace((space) => {
    space.write('app/config.json', json({ limits: { bytes: '1' } }), space.xdg);
    space.write('.config/app/config.json', json({ limits: { bytes: '2' } }), space.home);
    space.write('app/config.json', json({ limits: { bytes: '3' } }), space.appdata);
    expect(received(space.run('none', []).stdout)).toEqual({ ...defaults, limit: '1' });
    expect(received(space.run('none', [], { XDG_CONFIG_HOME: '' }).stdout)).toEqual({
      ...defaults,
      limit: '2',
    });
    expect(received(space.run('none', [], { XDG_CONFIG_HOME: 'relative/xdg' }).stdout)).toEqual({
      ...defaults,
      limit: '2',
    });
    expect(received(space.run('none', [], { FIXTURE_PLATFORM: 'win32' }).stdout)).toEqual({
      ...defaults,
      limit: '3',
    });
    // With no variable to derive it from, there is no user file.
    expect(
      received(space.run('none', [], { HOME: undefined, XDG_CONFIG_HOME: undefined }).stdout),
    ).toEqual(defaults);
    expect(
      received(space.run('none', [], { APPDATA: undefined, FIXTURE_PLATFORM: 'win32' }).stdout),
    ).toEqual(defaults);
    // A relative HOME resolves against the host's working directory, and the label shows the full path.
    const relative = space.write('home/.config/app/config.json', json({ limits: { bytes: 'x' } }));
    expect(space.run('none', [], { HOME: 'home', XDG_CONFIG_HOME: '' }).stderr).toBe(
      `Invalid input: Option "--limit" (from limits.bytes in ${relative}): Supply a whole number.\n`,
    );
  }),
);

test(
  'files answer key by key, the first listed winning and the user file last',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: { bytes: '1' } }));
    space.write('shared/app.json', json({ limits: { bytes: '2' }, title: 'shared' }));
    space.write('app/config.json', json({ limits: { bytes: '3' }, total: true }), space.xdg);
    expect(received(space.run('project', []).stdout)).toEqual({
      ...defaults,
      limit: '1',
      title: 'shared',
      total: true,
    });
    expect(received(space.run('project', [], { FIXTURE_LIMIT: '4' }).stdout)).toMatchObject({
      limit: '4',
    });
    expect(
      received(space.run('project', ['--limit', '5'], { FIXTURE_LIMIT: '4' }).stdout),
    ).toMatchObject({ limit: '5' });
  }),
);

test(
  'a failure on a filled value names the file that answered, the user file by its full path',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: { bytes: 'many' } }));
    expect(space.run('project', [])).toEqual({
      status: 2,
      stderr:
        'Invalid input: Option "--limit" (from limits.bytes in .app.json): Supply a whole number.\n',
      stdout: 'resolved:2\n',
    });
    const user = space.write('app/config.json', json({ limits: { bytes: 'lots' } }), space.xdg);
    expect(space.run('none', []).stderr).toBe(
      `Invalid input: Option "--limit" (from limits.bytes in ${user}): Supply a whole number.\n`,
    );
  }),
);

test(
  '--config names the one file a run reads, and a bad named file fails the run',
  inWorkspace((space) => {
    space.write('app/config.json', json({ limits: { bytes: '1' }, total: true }), space.xdg);
    space.write('.app.json', json({ limits: { bytes: '2' } }));
    space.write('pinned.json', json({ title: 'pinned' }));
    expect(received(space.run('project', ['--config', 'pinned.json']).stdout)).toEqual({
      ...defaults,
      title: 'pinned',
    });
    expect(space.run('project', ['--config', 'missing.json'])).toEqual({
      status: 2,
      stderr: namedFailure('missing.json', 'does not exist.'),
      stdout: 'resolved:2\n',
    });
    space.write('broken.json', '{');
    expect(space.run('project', ['--config', 'broken.json'])).toEqual({
      status: 2,
      stderr: namedFailure('broken.json', 'is not valid JSON.'),
      stdout: 'resolved:2\n',
    });
    space.write('list.json', '[]');
    expect(space.run('project', ['--config', 'list.json'])).toEqual({
      status: 2,
      stderr: namedFailure('list.json', 'does not hold a JSON object.'),
      stdout: 'resolved:2\n',
    });
    mkdirSync(join(space.project, 'dir.json'));
    expect(space.run('project', ['--config', 'dir.json']).stderr).toBe(
      namedFailure('dir.json', 'could not be read.'),
    );
    // The takeover reports nothing, and a run that needs no value reads no file.
    const help = space.run('project', ['--config', 'missing.json', '--help']);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe('');
    const filled = space.run('project', [
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
    ]);
    expect(filled).toMatchObject({ status: 0, stderr: '' });
    expect(received(filled.stdout)).toEqual({
      fields: ['a'],
      level: 'x',
      limit: '1',
      owner: 'o',
      quiet: false,
      title: 't',
      total: true,
    });
  }),
);

test(
  'a discovered file that is missing is silent, and one that is broken warns once and is skipped',
  inWorkspace((space) => {
    const silent = space.run('project', []);
    expect(silent).toMatchObject({ status: 0, stderr: '' });
    expect(received(silent.stdout)).toEqual(defaults);
    mkdirSync(join(space.project, '.app.json'));
    space.write('shared/app.json', '');
    const user = space.write('app/config.json', json({ title: 'user' }), space.xdg);
    const warned = space.run('project', []);
    expect(warned).toMatchObject({
      status: 0,
      stderr: `${skipped('.app.json', 'could not be read.')}${skipped('shared/app.json', 'is not valid JSON.')}`,
    });
    expect(received(warned.stdout)).toEqual({ ...defaults, title: 'user' });
    rmSync(join(space.project, '.app.json'), { recursive: true });
    space.write('.app.json', '{"limits": ');
    space.write('shared/app.json', '[1]');
    writeFileSync(user, 'true');
    const result = space.run('project', ['--help']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe(
      `${skipped('.app.json', 'is not valid JSON.')}${skipped('shared/app.json', 'does not hold a JSON object.')}${skipped(user, 'does not hold a JSON object.')}`,
    );
    expect(result.stdout.startsWith('app')).toBe(true);
  }),
);

test(
  'a user file under a missing directory or a file in place of a directory is silent',
  inWorkspace((space) => {
    expect(space.run('none', [], { XDG_CONFIG_HOME: join(space.root, 'absent') }).stderr).toBe('');
    writeFileSync(join(space.xdg, 'app'), 'a file, not a directory');
    const result = space.run('none', []);
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(received(result.stdout)).toEqual(defaults);
  }),
);

test(
  'a value follows the option type, and a wrong value is a usage failure naming the file',
  inWorkspace((space) => {
    space.write(
      '.app.json',
      json({ fields: ['a', 2], limits: { bytes: 5 }, quiet: false, total: true }),
    );
    expect(received(space.run('project', []).stdout)).toEqual({
      fields: ['a', '2'],
      limit: '5',
      quiet: false,
      total: true,
    });
    space.write('.app.json', json({ total: 'yes' }));
    expect(space.run('project', [])).toEqual({
      status: 2,
      stderr: wrong('Option "--total" (from total in .app.json): Use true or false.'),
      stdout: 'resolved:2\n',
    });
    space.write('.app.json', json({ limits: { bytes: { max: 5 } } }));
    expect(space.run('project', []).stderr).toBe(
      wrong('Option "--limit" (from limits.bytes in .app.json): Use a string or a number.'),
    );
    space.write('.app.json', json({ quiet: 'no' }));
    expect(space.run('project', []).stderr).toBe(
      wrong('Option "--no-quiet" (from quiet in .app.json): Use true or false.'),
    );
    space.write('.app.json', json({ fields: 'a' }));
    expect(space.run('project', []).stderr).toBe(
      wrong('Option "--fields" (from fields in .app.json): Use an array of strings or numbers.'),
    );
    space.write('.app.json', json({ fields: ['a', {}, null] }));
    expect(space.run('project', []).stderr).toBe(
      wrong(
        'Option "--fields" (from fields in .app.json) at 1: Use a string or a number.\nOption "--fields" (from fields in .app.json) at 2: Use a string or a number.',
      ),
    );
    space.write('.app.json', json({ title: null }));
    expect(space.run('project', []).stderr).toBe(
      wrong('Option "--title" (from title in .app.json): Use a string or a number.'),
    );
    // An overflowing literal parses as Infinity, which is no JSON number.
    space.write('.app.json', '{"title": 1e400, "fields": [-0, 1e21, -1e400]}');
    expect(space.run('project', []).stderr).toBe(
      wrong(
        'Option "--fields" (from fields in .app.json) at 2: Use a string or a number.\nOption "--title" (from title in .app.json): Use a string or a number.',
      ),
    );
    space.write('.app.json', '{"fields": [-0, 1e21]}');
    expect(received(space.run('project', []).stdout)).toMatchObject({ fields: ['0', '1e+21'] });
  }),
);

test(
  'an empty array fills a multiple option, and two wrong values print in request order',
  inWorkspace((space) => {
    space.write('.app.json', json({ fields: [] }));
    space.write('app/config.json', json({ fields: ['user'] }), space.xdg);
    expect(received(space.run('project', []).stdout)).toEqual(defaults);
    space.write('.app.json', json({ limits: { bytes: true }, log: { level: 7 }, title: false }));
    expect(space.run('project', []).stderr).toBe(
      [
        'Invalid input: Option "--limit" (from limits.bytes in .app.json): Use a string or a number.',
        'Option "--title" (from title in .app.json): Use a string or a number.',
        '',
      ].join('\n'),
    );
    expect(received(space.run('project', ['--limit', '1', '--title', 't']).stdout)).toMatchObject({
      level: '7',
    });
  }),
);

test(
  'a path that meets a missing key or a non-object is not in that file, and the next answers',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: 5 }));
    space.write('shared/app.json', json({ limits: { bytes: '2' } }));
    expect(received(space.run('project', []).stdout)).toMatchObject({ limit: '2' });
    space.write('.app.json', json({ limits: { size: '1' } }));
    expect(received(space.run('project', []).stdout)).toMatchObject({ limit: '2' });
    // A later file's value for a path an earlier file answers is never read.
    space.write('.app.json', json({ limits: { bytes: '1' } }));
    space.write('shared/app.json', json({ limits: { bytes: [] } }));
    expect(received(space.run('project', []).stdout)).toMatchObject({ limit: '1' });
  }),
);

test(
  'a segment named after an Object.prototype member answers only from an own key',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: { bytes: '1' } }));
    expect(received(space.run('project', []).stdout)).not.toHaveProperty('owner');
    space.write('.app.json', json({ constructor: { name: 'own' } }));
    expect(received(space.run('project', []).stdout)).toMatchObject({ owner: 'own' });
  }),
);

test(
  'a wrong value problem carries whether the option is global, and reaches an InputError view',
  inWorkspace((space) => {
    space.write('.app.json', json({ limits: { bytes: false }, log: { level: true } }));
    expect(space.run('project', [], { FIXTURE_VIEWS: 'input' }).stderr).toBe(
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
  'a bad path in the binding and bad settings throw declaration errors at the call',
  inWorkspace((space) => {
    expect(space.run('bad-path', []).stdout).toBe(
      'DeclarationError: The root Command option "limit" holds an invalid "@loomcli/plugins/config/input" value: Supply a dotted path of nonempty keys with no control character. Correct the value.\n',
    );
    expect(space.run('bad-entry', []).stdout).toBe(
      'DeclarationError: Plugin "@loomcli/plugins/config" file 1 is not a path. Supply a nonempty path with no control character.\n',
    );
    expect(space.run('bad-list', []).stdout).toBe(
      'DeclarationError: Plugin "@loomcli/plugins/config" files is not a list. Supply an array of paths.\n',
    );
    for (const scenario of ['not-object', 'list-settings']) {
      expect(space.run(scenario, []).stdout).toBe(
        'DeclarationError: Plugin "@loomcli/plugins/config" files is not a list. Supply an array of paths.\n',
      );
    }
    expect(space.run('control-entry', []).stdout).toBe(
      'DeclarationError: Plugin "@loomcli/plugins/config" file 0 is not a path. Supply a nonempty path with no control character.\n',
    );
  }),
);

test(
  'a file listed twice is read and warned about once, and an absolute path is used as written',
  inWorkspace((space) => {
    space.write('.app.json', '{');
    expect(space.run('twice', []).stderr).toBe(skipped('.app.json', 'is not valid JSON.'));
    const absolute = space.write(
      'elsewhere/settings.json',
      json({ title: 'absolute' }),
      space.root,
    );
    expect(
      received(space.run('absolute', [], { FIXTURE_ABSOLUTE: absolute }).stdout),
    ).toMatchObject({ title: 'absolute' });
  }),
);

test(
  'a leading byte order mark reads, and an empty named file is not valid JSON',
  inWorkspace((space) => {
    space.write('.app.json', `${String.fromCodePoint(65_279)}${json({ title: 'bom' })}`);
    expect(received(space.run('project', []).stdout)).toMatchObject({ title: 'bom' });
    space.write('empty.json', '');
    expect(space.run('project', ['--config', 'empty.json']).stderr).toBe(
      namedFailure('empty.json', 'is not valid JSON.'),
    );
  }),
);

test(
  'a control character in a file path prints as its escape wherever the path leaves the plugin',
  inWorkspace((space) => {
    const escape = String.fromCodePoint(27);
    const escaped = String.raw`esc\u001bape`;
    expect(space.run('project', ['--config', `esc${escape}ape`]).stderr).toBe(
      namedFailure(escaped, 'does not exist.'),
    );
    space.write(`esc${escape}ape`, json({ limits: { bytes: 'x' } }));
    expect(space.run('project', ['--config', `esc${escape}ape`]).stderr).toBe(
      `Invalid input: Option "--limit" (from limits.bytes in ${escaped}): Supply a whole number.\n`,
    );
    const xdg = join(space.root, `x${escape}dg`);
    space.write('app/config.json', '[]', xdg);
    expect(space.run('none', [], { XDG_CONFIG_HOME: xdg }).stderr).toBe(
      skipped(
        join(space.root, String.raw`x\u001bdg`, 'app', 'config.json'),
        'does not hold a JSON object.',
      ),
    );
    // A C1 control and a line separator escape too, and a style marker prints literally.
    const odd = `a${String.fromCodePoint(133)}b${String.fromCodePoint(8232)}c`;
    expect(space.run('project', ['--config', odd]).stderr).toBe(
      namedFailure(String.raw`a\u0085b\u2028c`, 'does not exist.'),
    );
    const marked = `${String.fromCodePoint(57_344)}1${String.fromCodePoint(57_345)}m${String.fromCodePoint(57_346)}`;
    const markedXdg = join(space.root, `x${marked}dg`);
    space.write('app/config.json', '[]', markedXdg);
    expect(space.run('none', [], { XDG_CONFIG_HOME: markedXdg }).stderr).toBe(
      skipped(join(markedXdg, 'app', 'config.json'), 'does not hold a JSON object.'),
    );
  }),
);

test(
  'inspect() lists the --config option and the binding value on each bound option',
  inWorkspace((space) => {
    const result = invoke(fixture, ['none', 'inspect'], { cwd: space.root });
    expect(result.status).toBe(0);
    const graph = JSON.parse(result.stdout);
    expect(
      graph.globals.find((option: { name: string }) => option.name === 'config'),
    ).toMatchObject({
      description: 'Read configuration from this file alone.',
      scope: 'plugin',
      type: 'string',
    });
    expect(
      graph.root.options.find((option: { name: string }) => option.name === 'limit').extensions,
    ).toEqual({ '@loomcli/plugins/config/input': { path: 'limits.bytes' } });
  }),
);
