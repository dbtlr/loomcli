import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/sources/invoke.mjs', import.meta.url);

/**
 * One run of the fixture. `full` installs the configuration, log, and help plugins; `plain` leaves
 * the configuration source out, so every binding value in the graph is inert.
 */
function run(argv: string[], env: Record<string, string | undefined> = {}, scenario = 'full') {
  return invoke(fixture, [scenario, 'run', ...argv], { env });
}

/** The one stdout line that starts with a label, such as the action's or the source's. */
function line(stdout: string, label: string): string | undefined {
  return stdout.split('\n').find((entry) => entry.startsWith(`${label}:`));
}

/** Settings the fixture source answers from, keyed by the binding value an option carries. */
function settings(values: Record<string, unknown>): { FIXTURE_SETTINGS: string } {
  return { FIXTURE_SETTINGS: JSON.stringify(values) };
}

test('argv wins over the environment, the environment over the source, the source over the default', () => {
  const both = { FIXTURE_LIMIT: '2', ...settings({ 'limits.bytes': '3' }) };
  expect(line(run(['--limit', '1'], both).stdout, 'root')).toBe('root:{"limit":"1"}');
  expect(line(run([], both).stdout, 'root')).toBe('root:{"limit":"2"}');
  expect(line(run([], { ...both, FIXTURE_LIMIT: '' }).stdout, 'root')).toBe('root:{"limit":"3"}');
  expect(run([])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nroot:{"limit":"10"}\nresolved:0\n',
  });
});

test('a value filled from the environment is supplied in every sense', () => {
  const filled = run(['count'], { FIXTURE_FILE: 'a.txt', FIXTURE_MAX: '7' }, 'plain');
  // The required option passes, and the validateOmitted schema receives the filled value.
  expect(filled).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      'schema:file:{"supplied":"a.txt","value":"a.txt"}',
      'count:{"limit":"10","max":"7","file":"a.txt","total":false,"quiet":true,"color":false}',
      'resolved:0',
      '',
    ].join('\n'),
  });
  // The action cannot tell the environment from the flag.
  expect(run(['count', '--max', '7', '--file', 'a.txt'], {}, 'plain')).toEqual(filled);
});

test.each([
  ['true', true],
  ['1', true],
  ['FALSE', false],
  ['0', false],
])('%s fills a Boolean option with %s under every polarity', (value, expected) => {
  const env = { FIXTURE_COLOR: value, FIXTURE_QUIET: value, FIXTURE_TOTAL: value };
  const result = run(['count', '--max', '1'], env, 'plain');
  expect(result.status).toBe(0);
  expect(line(result.stdout, 'count')).toBe(
    `count:{"limit":"10","max":"1","file":"none","total":${expected},"quiet":${expected},"color":${expected}}`,
  );
});

test('a Boolean variable outside the grammar is a usage failure naming the variable', () => {
  expect(run(['count', '--max', '1'], { FIXTURE_TOTAL: 'yes' }, 'plain')).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--total" (from FIXTURE_TOTAL): Use true, false, 1, or 0.\n',
    stdout: 'schema:file:{}\nresolved:2\n',
  });
  // A negative-only option is named by the one spelling an operator types for it.
  expect(run(['count', '--max', '1'], { FIXTURE_QUIET: ' true' }, 'plain').stderr).toBe(
    'Invalid input: Option "--no-quiet" (from FIXTURE_QUIET): Use true, false, 1, or 0.\n',
  );
});

test('problems report the globals, then a rejected plugin variable, then the local options', () => {
  const env = { FIXTURE_LIMIT: 'many', FIXTURE_TOTAL: 'yes', FIXTURE_VERBOSE: 'yes' };
  expect(run(['count', '--max', 'x'], env, 'plain').stderr).toBe(
    [
      'Invalid input: Option "--limit" (from FIXTURE_LIMIT): Supply a whole number.',
      'Option "--verbose" (from FIXTURE_VERBOSE): Use true, false, 1, or 0.',
      'Option "--max": Supply a whole number.',
      'Option "--total" (from FIXTURE_TOTAL): Use true, false, 1, or 0.',
      '',
    ].join('\n'),
  );
});

test('NO_COLOR keeps its presence rule while an option bound to it reads the grammar', () => {
  const terminal = { FIXTURE_TTY: '1', FORCE_COLOR: undefined, TERM: 'xterm-256color' };
  const paint = (env: Record<string, string | undefined>) =>
    line(run(['paint'], { ...terminal, ...env }, 'plain').stdout, 'paint');
  expect(paint({ NO_COLOR: undefined })).toBe('paint:false:\u001b[31mX\u001b[39m');
  expect(paint({ NO_COLOR: 'false' })).toBe('paint:false:X');
  expect(paint({ NO_COLOR: '1' })).toBe('paint:true:X');
});

test('a plugin option filled from the environment activates its middleware, with false as well', () => {
  expect(line(run([], { FIXTURE_VERBOSE: '1' }, 'plain').stdout, 'log')).toBe(
    'log:{"verbose":true}',
  );
  expect(line(run([], { FIXTURE_VERBOSE: 'false' }, 'plain').stdout, 'log')).toBe(
    'log:{"verbose":false}',
  );
  expect(run([], {}, 'plain')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'root:{"limit":"10"}\nresolved:0\n',
  });
});

test('a bad variable and a failing source report nothing under --help', () => {
  expect(run(['--help'], { FIXTURE_LIMIT: 'many' }, 'plain')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help\nresolved:0\n',
  });
  expect(run(['--help'], { FIXTURE_SOURCE: 'throw' })).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nhelp\nresolved:0\n',
  });
  expect(run([], { FIXTURE_LIMIT: 'many' }, 'plain')).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--limit" (from FIXTURE_LIMIT): Supply a whole number.\n',
    stdout: 'resolved:2\n',
  });
  expect(run([], { FIXTURE_SOURCE: 'throw' })).toEqual({
    status: 1,
    stderr:
      'Internal error: Plugin "@fixture/config" failed in its configuration source: the settings file is locked.\n',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nresolved:1\n',
  });
});

test('the source is never loaded when every bound option is already filled', () => {
  expect(run(['--limit', '1'], { FIXTURE_LEVEL: 'info', FIXTURE_LOADER: 'throws' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'log:{"level":"info","verbose":false}\nroot:{"limit":"1"}\nresolved:0\n',
  });
});

test('a Boolean variable outside the grammar keeps the source unloaded', () => {
  // `total` is unfilled and configuration-bound, but its environment fault removes it from requests.
  expect(
    run(['count', '--max', '1', '--limit', '1'], {
      FIXTURE_LEVEL: 'info',
      FIXTURE_LOADER: 'throws',
      FIXTURE_TOTAL: 'yes',
    }),
  ).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--total" (from FIXTURE_TOTAL): Use true, false, 1, or 0.\n',
    stdout: 'schema:file:{}\nlog:{"level":"info","verbose":false}\nresolved:2\n',
  });
});

test('a source answers a multiple option with a list, and an empty string fills', () => {
  const result = run(['select'], settings({ fields: ['a', 'b'], title: '' }));
  expect(result.status).toBe(0);
  expect(line(result.stdout, 'source')).toBe(
    'source:{"options":{"config":"fixture.json"},"requests":["limit","level","fields","title"]}',
  );
  expect(line(result.stdout, 'select')).toBe('select:{"limit":"10","fields":["a","b"],"title":""}');
});

test('an empty list still reports the required message of a required multiple option', () => {
  expect(run(['select'], settings({ fields: [] })).stderr).toBe(
    'Invalid input: Option "--fields" (from fields in fixture.json) is required. Supply at least one value.\n',
  );
});

test('a failure on a filled value names its source, and an argv message is unchanged', () => {
  expect(run([], { FIXTURE_LIMIT: 'many' }, 'plain').stderr).toBe(
    'Invalid input: Option "--limit" (from FIXTURE_LIMIT): Supply a whole number.\n',
  );
  expect(run([], settings({ 'limits.bytes': 'many' })).stderr).toBe(
    'Invalid input: Option "--limit" (from limits.bytes in fixture.json): Supply a whole number.\n',
  );
  expect(run(['--limit', 'many'], {}, 'plain').stderr).toBe(
    'Invalid input: Option "--limit": Supply a whole number.\n',
  );
  expect(run(['select'], settings({ fields: ['a', ''] })).stderr).toBe(
    'Invalid input: Option "--fields" (from fields in fixture.json) at 1: Supply a field name.\n',
  );
});

test('with a local parse fault, a plugin option still fills and activates and a local one does not', () => {
  expect(run(['count', '--bogus'], { FIXTURE_TOTAL: '1', FIXTURE_VERBOSE: '1' })).toEqual({
    status: 2,
    stderr:
      'Invalid input: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nlog:{"verbose":true}\nresolved:2\n',
  });
  expect(run(['cache'], { FIXTURE_VERBOSE: '1' }, 'plain')).toEqual({
    status: 2,
    stderr: 'Invalid input: Command "cache" requires a subcommand. Use one of: clear.\n',
    stdout: 'log:{"verbose":true}\nresolved:2\n',
  });
});

test('a local parse fault is reported ahead of a source fault', () => {
  const result = run(['count', '--bogus'], { FIXTURE_SOURCE: 'throw' });
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    'Invalid input: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
  );
});

test.each([
  [
    { FIXTURE_LOADER: 'throws' },
    'Loading plugin "@fixture/config" failed: the loader threw before it could import',
  ],
  [
    { FIXTURE_SOURCE: 'import-fails' },
    'Loading plugin "@fixture/config" failed: the source module failed to evaluate',
  ],
  [
    { FIXTURE_LOADER: 'no-default' },
    'Loading plugin "@fixture/config" failed: the module exports no default source function.',
  ],
  [
    { FIXTURE_SOURCE: 'throw' },
    'Plugin "@fixture/config" failed in its configuration source: the settings file is locked.',
  ],
  [
    { FIXTURE_REASON: 'The settings file is locked.', FIXTURE_SOURCE: 'throw' },
    'Plugin "@fixture/config" failed in its configuration source: The settings file is locked.',
  ],
  [
    { FIXTURE_SOURCE: 'not-record' },
    'Plugin "@fixture/config" returned configuration answers that are not a record.',
  ],
  [
    { FIXTURE_SOURCE: 'unrequested' },
    'Plugin "@fixture/config" answered option "port", which core did not request.',
  ],
  [
    settings({ 'limits.bytes': 5 }),
    'Plugin "@fixture/config" answered option "limit" with a value that is not a string.',
  ],
  [
    { FIXTURE_SOURCE: 'bad-label', ...settings({ 'limits.bytes': '5' }) },
    'Plugin "@fixture/config" answered option "limit" with an answer that is not { value, label }.',
  ],
  [
    { FIXTURE_SOURCE: 'bare', ...settings({ 'limits.bytes': '5' }) },
    'Plugin "@fixture/config" answered option "limit" with an answer that is not { value, label }.',
  ],
  [
    { FIXTURE_SOURCE: 'record-getter' },
    'Plugin "@fixture/config" failed in its configuration source: the answers record threw.',
  ],
  [
    { FIXTURE_SOURCE: 'label-getter' },
    'Plugin "@fixture/config" failed in its configuration source: the answer label threw.',
  ],
])('a source fault %j reports its sentence with code 1', (env, sentence) => {
  const result = run([], env);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(`Internal error: ${sentence}\n`);
});

test.each([
  [['count', '--max', '1'], { total: 'yes' }, 'option "total" with a value that is not a Boolean.'],
  [['select'], { fields: 'a' }, 'option "fields" with a value that is not an array of strings.'],
  [
    ['select'],
    { fields: ['a', 1] },
    'option "fields" with a value that is not an array of strings.',
  ],
])('an answer of the wrong type for %j names the type the option takes', (argv, values, clause) => {
  const result = run(argv, settings(values));
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(`Internal error: Plugin "@fixture/config" answered ${clause}\n`);
});

test.each(['sparse', 'hollow'])('a %s list answer is not an array of strings', (mode) => {
  const result = run(['select'], { FIXTURE_SOURCE: mode });
  expect(result).toEqual({
    status: 1,
    stderr:
      'Internal error: Plugin "@fixture/config" answered option "fields" with a value that is not an array of strings.\n',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level","fields","title"]}\nresolved:1\n',
  });
});

test('a run cancelled before it starts loads no source and calls none', () => {
  const env = { FIXTURE_LOADER: 'recording' };
  expect(invoke(fixture, ['full', 'cancelled'], { env })).toEqual({
    status: 130,
    stderr: '',
    stdout: 'resolved:130\n',
  });
});

test('an abort while the source loads calls no resolver and dispatches nothing', () => {
  const env = { FIXTURE_LOADER: 'aborts' };
  expect(invoke(fixture, ['full', 'cancel'], { env })).toEqual({
    status: 130,
    stderr: '',
    stdout: 'loader:called\nresolved:130\n',
  });
});

test('a variable named after an Object.prototype member is unset in a plain-object env', () => {
  expect(run(['inherited'], {}, 'plain')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'inherited:undefined:false\nresolved:0\n',
  });
});

test('an abort during the source call awaits it and dispatches nothing', () => {
  expect(invoke(fixture, ['full', 'cancel'], { env: { FIXTURE_SOURCE: 'cancel' } })).toEqual({
    status: 130,
    stderr: '',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nsource:settled\nresolved:130\n',
  });
});

test("the source's own options resolve before the call and are never requested", () => {
  const fromEnvironment = run([], { FIXTURE_CONFIG_FILE: 'other.json' });
  expect(line(fromEnvironment.stdout, 'source')).toBe(
    'source:{"options":{"config":"other.json"},"requests":["limit","level"]}',
  );
  const fromArgv = run(['--config', 'argv.json'], { FIXTURE_CONFIG_FILE: 'other.json' });
  expect(line(fromArgv.stdout, 'source')).toBe(
    'source:{"options":{"config":"argv.json"},"requests":["limit","level"]}',
  );
});

/** Each option's name beside the variable its node publishes. */
function envs(options: { env: unknown; name: string }[]) {
  return options.map((option) => [option.name, option.env]);
}

test('inspect() publishes env on bound and unbound options of every kind', () => {
  const graph = JSON.parse(invoke(fixture, ['full', 'inspect']).stdout);
  expect(envs(graph.globals)).toEqual([
    ['limit', 'FIXTURE_LIMIT'],
    ['config', 'FIXTURE_CONFIG_FILE'],
    ['level', 'FIXTURE_LEVEL'],
    ['verbose', 'FIXTURE_VERBOSE'],
    ['help', null],
  ]);
  const [count, select] = graph.root.children;
  expect(envs(count.options)).toEqual([
    ['max', 'FIXTURE_MAX'],
    ['file', 'FIXTURE_FILE'],
    ['total', 'FIXTURE_TOTAL'],
    ['quiet', 'FIXTURE_QUIET'],
    ['color', 'FIXTURE_COLOR'],
  ]);
  expect(envs(select.options)).toEqual([
    ['fields', null],
    ['title', null],
  ]);
});

/** Every input source declaration rule throws from the call or the attach that first proves it. */
function build(scenario: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/sources/build.mjs', import.meta.url), [scenario, mode]);
}

test.each([
  [
    'env-grammar',
    'Global option "limit" env "9LIMIT" is not a variable name. Use a letter or an underscore, then letters, digits, or underscores.',
  ],
  [
    'env-not-string',
    'Global option "limit" env is not a variable name. Use a letter or an underscore, then letters, digits, or underscores.',
  ],
  [
    'local-env-grammar',
    'Command "count" option "limit" env "LIMIT-X" is not a variable name. Use a letter or an underscore, then letters, digits, or underscores.',
  ],
  [
    'plugin-env-grammar',
    'Plugin "@loomcli/log" option "verbose" env "" is not a variable name. Use a letter or an underscore, then letters, digits, or underscores.',
  ],
  [
    'env-multiple',
    'Global option "field" is a multiple option and declares env. Remove env; a list comes from the configuration source.',
  ],
  [
    'plugin-env-multiple',
    'Plugin "@loomcli/log" option "tags" is a multiple option and declares env. Remove env; a list comes from the configuration source.',
  ],
  [
    'argument-env',
    'Command "get" argument "path" declares env, which applies to options alone. Remove it.',
  ],
  [
    'variable-twice',
    'Variable "TEXTSTAT_LIMIT" is bound by global option "limit" and Command "count" option "max". Bind each variable to one option.',
  ],
  [
    'root-variable-twice',
    'Variable "TEXTSTAT_LIMIT" is bound by global option "limit" and the root Command option "max". Bind each variable to one option.',
  ],
  [
    'variable-local-twice',
    'Variable "TEXTSTAT_LIMIT" is bound by Command "count" option "max" and Command "count" option "min". Bind each variable to one option.',
  ],
  [
    'variable-plugin-twice',
    'Variable "VERBOSE" is bound by global option "loud" and plugin "@loomcli/log" option "verbose". Bind each variable to one option.',
  ],
  [
    'second-source',
    'Plugin "@acme/yaml" declares a configuration source, which plugin "@acme/config" already declares. Install one source.',
  ],
  [
    'source-not-object',
    'Plugin "@acme/config" declares a source that is not an object. Supply { binding, load }.',
  ],
  [
    'binding-not-listed',
    'Plugin "@acme/config" declares a source binding that is not one of its extensions. Supply a descriptor the plugin lists under extensions.',
  ],
  [
    'binding-wrong-target',
    'Plugin "@acme/config" declares source binding "@acme/config/key", which applies to Commands. Supply an extension that applies to options.',
  ],
  [
    'source-no-load',
    'Plugin "@acme/config" declares a source with no load function. Supply load: () => import(\'./source.js\').',
  ],
  [
    'binding-own-option',
    'Plugin "@acme/config" option "config" carries its own source binding. Remove the value; the source\'s own options resolve before it loads.',
  ],
])('the declaration that makes %s wrong throws', (scenario, message) => {
  expect(build(scenario, 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `thrown:1: ${message}\n`,
  });
});

test('one variable bound on two sibling Commands is accepted', () => {
  expect(build('sibling-variable', 'inspect').stdout).toBe('inspected\n');
});
