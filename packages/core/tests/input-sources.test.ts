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

/**
 * The global option values every action and middleware reads when nothing else supplies them: the
 * application's `limit`, then the configuration plugin's `config` under `full`, then the log and
 * help plugins' options. An option whose value is undefined is absent from the printed JSON.
 */
const full = '"limit":"10","config":"fixture.json","verbose":false,"help":false';
const plain = '"limit":"10","verbose":false,"help":false';

/** One option's value in the JSON record one stdout line prints after its label. */
function valueOf(stdout: string, label: string, name: string): unknown {
  const printed = line(stdout, label)?.slice(label.length + 1);
  return printed === undefined ? undefined : JSON.parse(printed)[name];
}

/** Settings the fixture source answers from, keyed by the binding value an option carries. */
function settings(values: Record<string, unknown>): { FIXTURE_SETTINGS: string } {
  return { FIXTURE_SETTINGS: JSON.stringify(values) };
}

test('argv wins over the environment, the environment over the source, the source over the default', () => {
  const both = { FIXTURE_LIMIT: '2', ...settings({ 'limits.bytes': '3' }) };
  expect(valueOf(run(['--limit', '1'], both).stdout, 'root', 'limit')).toBe('1');
  expect(valueOf(run([], both).stdout, 'root', 'limit')).toBe('2');
  expect(valueOf(run([], { ...both, FIXTURE_LIMIT: '' }).stdout, 'root', 'limit')).toBe('3');
  expect(run([])).toEqual({
    status: 0,
    stderr: '',
    stdout: `source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nroot:{${full}}\nresolved:0\n`,
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
      `count:{${plain},"max":"7","file":"a.txt","total":false,"quiet":true,"color":false}`,
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
    `count:{${plain},"max":"1","file":"none","total":${expected},"quiet":${expected},"color":${expected}}`,
  );
});

test('a Boolean variable outside the grammar is a usage failure naming the variable', () => {
  expect(run(['count', '--max', '1'], { FIXTURE_TOTAL: 'yes' }, 'plain')).toEqual({
    status: 2,
    stderr: 'app: Option "--total" (from FIXTURE_TOTAL): Use true, false, 1, or 0.\n',
    stdout: 'schema:file:{}\nresolved:2\n',
  });
  // A negative-only option is named by the one spelling an operator types for it.
  expect(run(['count', '--max', '1'], { FIXTURE_QUIET: ' true' }, 'plain').stderr).toBe(
    'app: Option "--no-quiet" (from FIXTURE_QUIET): Use true, false, 1, or 0.\n',
  );
});

test("problems report the application's globals, then a plugin's, then the local options", () => {
  const env = { FIXTURE_LIMIT: 'many', FIXTURE_TOTAL: 'yes', FIXTURE_VERBOSE: 'yes' };
  expect(run(['count', '--max', 'x'], env, 'plain').stderr).toBe(
    [
      'app: Option "--limit" (from FIXTURE_LIMIT): Supply a whole number.',
      'app: Option "--verbose" (from FIXTURE_VERBOSE): Use true, false, 1, or 0.',
      'app: Option "--max": Supply a whole number.',
      'app: Option "--total" (from FIXTURE_TOTAL): Use true, false, 1, or 0.',
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

test("a plugin's option filled from the environment activates its middleware, with false as well", () => {
  expect(valueOf(run([], { FIXTURE_VERBOSE: '1' }, 'plain').stdout, 'log', 'verbose')).toBe(true);
  expect(valueOf(run([], { FIXTURE_VERBOSE: 'false' }, 'plain').stdout, 'log', 'verbose')).toBe(
    false,
  );
  expect(run([], {}, 'plain')).toEqual({
    status: 0,
    stderr: '',
    stdout: `root:{${plain}}\nresolved:0\n`,
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
    stderr: 'app: Option "--limit" (from FIXTURE_LIMIT): Supply a whole number.\n',
    stdout: 'resolved:2\n',
  });
  expect(run([], { FIXTURE_SOURCE: 'throw' })).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nresolved:1\n',
  });
});

/** The global values when argv fills `limit` and the environment fills `level`. */
const filled = '"limit":"1","config":"fixture.json","level":"info","verbose":false,"help":false';

test('the source is never loaded when every bound option is already filled', () => {
  expect(run(['--limit', '1'], { FIXTURE_LEVEL: 'info', FIXTURE_LOADER: 'throws' })).toEqual({
    status: 0,
    stderr: '',
    stdout: `log:{${filled}}\nroot:{${filled}}\nresolved:0\n`,
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
    stderr: 'app: Option "--total" (from FIXTURE_TOTAL): Use true, false, 1, or 0.\n',
    stdout: `schema:file:{}\nlog:{${filled}}\nresolved:2\n`,
  });
});

test('a source answers a multiple option with a list, and an empty string fills', () => {
  const result = run(['select'], settings({ fields: ['a', 'b'], title: '' }));
  expect(result.status).toBe(0);
  expect(line(result.stdout, 'source')).toBe(
    'source:{"options":{"config":"fixture.json"},"requests":["limit","level","fields","title"]}',
  );
  expect(line(result.stdout, 'select')).toBe(`select:{${full},"fields":["a","b"],"title":""}`);
});

test('an empty list still reports the required message of a required multiple option', () => {
  expect(run(['select'], settings({ fields: [] })).stderr).toBe(
    'app: Option "--fields" (from fields in fixture.json) is required. Supply at least one value.\n',
  );
});

test('a failure on a filled value names its source, and an argv message is unchanged', () => {
  expect(run([], { FIXTURE_LIMIT: 'many' }, 'plain').stderr).toBe(
    'app: Option "--limit" (from FIXTURE_LIMIT): Supply a whole number.\n',
  );
  expect(run([], settings({ 'limits.bytes': 'many' })).stderr).toBe(
    'app: Option "--limit" (from limits.bytes in fixture.json): Supply a whole number.\n',
  );
  expect(run(['--limit', 'many'], {}, 'plain').stderr).toBe(
    'app: Option "--limit": Supply a whole number.\n',
  );
  expect(run(['select'], settings({ fields: ['a', ''] })).stderr).toBe(
    'app: Option "--fields" (from fields in fixture.json) at 1: Supply a field name.\n',
  );
});

test("with a local parse fault, a plugin's option still fills and activates and a local one does not", () => {
  expect(run(['count', '--bogus'], { FIXTURE_TOTAL: '1', FIXTURE_VERBOSE: '1' })).toEqual({
    status: 2,
    stderr:
      'app: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
    stdout: `source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nlog:{${full.replace('"verbose":false', '"verbose":true')}}\nresolved:2\n`,
  });
  expect(run(['cache'], { FIXTURE_VERBOSE: '1' }, 'plain')).toEqual({
    status: 2,
    stderr: 'app: Command "cache" requires a subcommand. Use one of: clear.\n',
    stdout: `log:{${plain.replace('"verbose":false', '"verbose":true')}}\nresolved:2\n`,
  });
});

test("with a local parse fault, a global option's validator still runs and a rejection makes options null", () => {
  expect(run(['count', '--bogus', '--limit', 'many'], { FIXTURE_VERBOSE: '1' }, 'plain')).toEqual({
    status: 2,
    stderr:
      'app: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
    stdout: 'log:null\nresolved:2\n',
  });
});

test("the source's own options pass their validators before the call, which a rejection skips", () => {
  expect(run(['--config', 'settings.txt'])).toEqual({
    status: 2,
    stderr: 'app: Option "--config": Supply a JSON file.\n',
    stdout: 'resolved:2\n',
  });
  expect(run([], { FIXTURE_CONFIG_FILE: 'settings.txt', FIXTURE_VERBOSE: '1' })).toEqual({
    status: 2,
    stderr: 'app: Option "--config" (from FIXTURE_CONFIG_FILE): Supply a JSON file.\n',
    stdout: 'log:null\nresolved:2\n',
  });
  // A takeover reports nothing, and the source is still never called.
  expect(run(['--help', '--config', 'settings.txt'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help\nresolved:0\n',
  });
});

test("a rejected source option skips the source and reports with every other problem, the application's first", () => {
  const profiles = new URL('fixtures/sources/profiles.mjs', import.meta.url);
  expect(invoke(profiles, ['--size', 'zz', '--profile', 'nope'])).toEqual({
    status: 2,
    stderr: [
      'app: Option "--size": Expected a whole number.',
      'app: Option "--profile": Expected one of: dev, prod.',
      '',
    ].join('\n'),
    stdout: 'resolved:2\n',
  });
});

test('an option the skipped source would have filled reports no missing value', () => {
  const profiles = new URL('fixtures/sources/profiles.mjs', import.meta.url);
  expect(invoke(profiles, ['x', '--profile', 'nope', '--title', 't'])).toEqual({
    status: 2,
    stderr: 'app: Option "--profile": Expected one of: dev, prod.\n',
    stdout: 'resolved:2\n',
  });
});

test('a required option the skipped source was never asked about still reports as missing', () => {
  const profiles = new URL('fixtures/sources/profiles.mjs', import.meta.url);
  expect(invoke(profiles, ['x', '--profile', 'nope'])).toEqual({
    status: 2,
    stderr: [
      'app: Option "--profile": Expected one of: dev, prod.',
      'app: Option "--title" is required. Supply a value.',
      '',
    ].join('\n'),
    stdout: 'resolved:2\n',
  });
});

test("a source option's validator reads the same context as every other validator", () => {
  const argv = ['count', '--max', '7', '--limit', '3', '--config', 'other.json'];
  const result = run(argv, { FIXTURE_CONFIG_COUNT: 'context' });
  expect(line(result.stdout, 'schema:config')).toBe('schema:config:{"limit":"3","max":"7"}');
  expect(line(result.stdout, 'source')).toBe(
    'source:{"options":{"config":"other.json"},"requests":["level","total"]}',
  );
});

test("the source's own options meet their validator once per value", () => {
  const result = run(['--config', 'argv.json'], { FIXTURE_CONFIG_COUNT: '1' });
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      // The declared default, validated before any token is read.
      'schema:config:fixture.json',
      'schema:config:argv.json',
      'source:{"options":{"config":"argv.json"},"requests":["limit","level"]}',
      `root:{${full.replace('fixture.json', 'argv.json')}}`,
      'resolved:0',
      '',
    ].join('\n'),
  });
});

test('a local parse fault is reported ahead of a source fault', () => {
  const result = run(['count', '--bogus'], { FIXTURE_SOURCE: 'throw' });
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    'app: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
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
  expect(run([], env)).toMatchObject({ status: 1, stderr: 'app: Something went wrong.\n' });
  const result = run([], { ...env, FIXTURE_BUILD: 'development' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`\n\n${sentence}\n`);
});

test('an answer the answers rule rejects is a defect under the source answers rule', () => {
  const { stderr } = run([], { FIXTURE_BUILD: 'development', FIXTURE_SOURCE: 'not-record' });
  expect(stderr).toMatch(/^-- INVALID SOURCE ANSWERS -+ @loomcli\/core\/source-answers\n/u);
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
  expect(run(argv, settings(values))).toMatchObject({
    status: 1,
    stderr: 'app: Something went wrong.\n',
  });
  const result = run(argv, { ...settings(values), FIXTURE_BUILD: 'development' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`\n\nPlugin "@fixture/config" answered ${clause}\n`);
});

test.each(['sparse', 'hollow'])('a %s list answer is not an array of strings', (mode) => {
  const result = run(['select'], { FIXTURE_SOURCE: mode });
  expect(result).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
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

test('the source reads the graph inspect() returns, with each request a node inside it', () => {
  const result = run(['select'], { FIXTURE_SOURCE: 'context', ...settings({ fields: ['a'] }) });
  expect(result.status).toBe(0);
  expect(line(result.stdout, 'context')).toBe(
    'context:{"globals":[true,true,false,false],"name":"app","routed":true,"style":"function"}',
  );
});

test('a source warns through lanes.warn, ahead of a takeover, and an override reaches it', () => {
  const warned = 'Skipped a.json: the file is not valid JSON.\n';
  expect(run([], { FIXTURE_SOURCE: 'warn' })).toEqual({
    status: 0,
    stderr: `⚠ ${warned}`,
    stdout: `source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nroot:{${full}}\nresolved:0\n`,
  });
  expect(run(['--help'], { FIXTURE_SOURCE: 'warn' })).toEqual({
    status: 0,
    stderr: `⚠ ${warned}`,
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nhelp\nresolved:0\n',
  });
  expect(run([], { FIXTURE_SOURCE: 'warn', FIXTURE_VIEWS: 'warn' }).stderr).toBe(
    `warned: ${warned}`,
  );
});

test('an InputError from the resolver is a usage failure that replaces every other problem', () => {
  const failure = 'app: Option "--config": File "missing.json" does not exist.\n';
  expect(run([], { FIXTURE_SOURCE: 'input-error' })).toEqual({
    status: 2,
    stderr: failure,
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nresolved:2\n',
  });
  // The required --max is never validated once the source has raised its own problem.
  expect(run(['count'], { FIXTURE_SOURCE: 'input-error' })).toMatchObject({
    status: 2,
    stderr: failure,
  });
  expect(run(['--help'], { FIXTURE_SOURCE: 'input-error' })).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level"]}\nhelp\nresolved:0\n',
  });
  expect(run([], { FIXTURE_SOURCE: 'input-error', FIXTURE_VIEWS: 'input' }).stderr).toBe(
    '[{"input":{"global":true,"kind":"option","name":"config"},"issues":[{"message":"File \\"missing.json\\" does not exist."}],"reason":"invalid","spelling":"--config"}]\n',
  );
  expect(run(['count', '--bogus'], { FIXTURE_SOURCE: 'input-error' }).stderr).toBe(
    'app: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n',
  );
});

test('out.results() in a source is the results fault with the source as its subject', () => {
  const fault = 'app: Something went wrong.\n';
  expect(run(['count', '--max', '1'], { FIXTURE_SOURCE: 'results' })).toEqual({
    status: 1,
    stderr: fault,
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level","total"]}\nresolved:1\n',
  });
  // The results-lane fault reports once after the outcome, as a middleware's call does, a takeover included.
  expect(run(['count', '--max', '1', '--help'], { FIXTURE_SOURCE: 'results' })).toEqual({
    status: 1,
    stderr: fault,
    stdout:
      'source:{"options":{"config":"fixture.json"},"requests":["limit","level","total"]}\nhelp\nresolved:1\n',
  });
});

test.each([
  [
    { FIXTURE_SOURCE: 'input-error-getter' },
    'Plugin "@fixture/config" failed in its configuration source: Option "--limit": not from the resolver.',
  ],
  [
    { FIXTURE_SOURCE: 'declared-getter' },
    'Plugin "@fixture/config" failed in its configuration source: The settings registry is unavailable.',
  ],
  [
    { FIXTURE_SOURCE: 'declared-value-getter' },
    'Plugin "@fixture/config" failed in its configuration source: The settings registry is unavailable.',
  ],
])('%j stays a plugin fault with code 1', (env, sentence) => {
  expect(run([], env)).toMatchObject({ status: 1, stderr: 'app: Something went wrong.\n' });
  const result = run([], { ...env, FIXTURE_BUILD: 'development' });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`\n\n${sentence}\n`);
});

test.each(['declared', 'declared-sync'])(
  'a failure class the resolver raises in %s mode reports with its declared code',
  (mode) => {
    expect(run(['count'], { FIXTURE_SOURCE: mode })).toMatchObject({
      status: 69,
      stderr: 'The settings registry is unavailable.\n',
    });
    // The failure is held like any source fault, so a takeover reports nothing.
    expect(run(['--help'], { FIXTURE_SOURCE: mode })).toMatchObject({
      status: 0,
      stderr: '',
    });
  },
);

test.each([
  [{ FIXTURE_SOURCE: 'fatal' }, 'the source gave up\n'],
  [{ FIXTURE_SOURCE: 'result-error' }, 'app: Something went wrong.\n'],
])(
  'a core failure class the resolver raises in %j reports as itself with code 1',
  (env, stderr) => {
    expect(run([], env)).toMatchObject({ status: 1, stderr });
  },
);
