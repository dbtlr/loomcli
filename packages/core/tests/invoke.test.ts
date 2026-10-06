import { expect, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/by-name.mjs', import.meta.url);

/** One outcome as the fixture prints it: the failure is reduced to its own enumerable fields. */
interface Outcome {
  status: 'cancelled' | 'completed' | 'failed';
  exitCode?: number;
  failure?: Record<string, unknown>;
  messages?: string;
  output?: string;
}

/** The fixture's JSON report for one scenario, under the build it names. */
function report(scenario: string, ...rest: string[]): string {
  const result = invoke(fixture, [scenario, ...rest], { env: { FORCE_COLOR: undefined } });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/** The values an echoing action printed for one completed outcome. */
function echoed(outcome: Outcome | undefined): unknown {
  expect(outcome?.status).toBe('completed');
  return JSON.parse(outcome?.output ?? '');
}

/** The fixture's lowering report, keyed by case. */
type Lowering = Record<
  'absent' | 'bound' | 'every' | 'missing' | 'single' | 'unlowerable' | 'unlowerableMore',
  Outcome
>;

test('each value lowers to the tokens argv would give, row by row', () => {
  const { every }: Lowering = JSON.parse(report('lowering'));
  expect(echoed(every)).toEqual({
    args: { files: ['a', '1'], target: 'x' },
    options: {
      backup: 'simple',
      color: false,
      flag: true,
      keep: false,
      name: 's',
      ratio: '0.5',
      tag: ['a', '2'],
      verbose: 3,
    },
  });
});

test('a single value on a collecting input is one occurrence, and a number reaches an unvalidated option as its String text', () => {
  const { single }: Lowering = JSON.parse(report('lowering'));
  expect(echoed(single)).toMatchObject({
    args: { files: ['f'], target: '7' },
    options: { color: true, name: '5', tag: ['one'] },
  });
});

test('false on a positive option, true on a negative option, 0 on a count, and an empty array are absence', () => {
  const { absent }: Lowering = JSON.parse(report('lowering'));
  expect(echoed(absent)).toEqual({
    args: { files: [], target: 't' },
    options: { color: false, flag: false, keep: true, tag: [], verbose: 0 },
  });
});

test('false on a positive option leaves a bound variable free to fill it', () => {
  const { bound }: Lowering = JSON.parse(report('lowering'));
  expect(echoed(bound)).toMatchObject({ options: { flag: true } });
});

test('an empty array on a required multiple option is the missing-input problem', () => {
  const { missing }: Lowering = JSON.parse(report('lowering'));
  expect(missing).toMatchObject({
    exitCode: 2,
    messages: 'probe: Option "item" is required. Supply at least one value.\n',
    status: 'failed',
  });
});

test('each unlowerable value is an invalid problem in authoring order whose issue says what the input takes', () => {
  const { unlowerable, unlowerableMore }: Lowering = JSON.parse(report('lowering'));
  expect(unlowerable).toMatchObject({
    exitCode: 2,
    failure: { name: 'InputError' },
    messages: [
      'probe: Argument "target": Use a string or a number.',
      'probe: Argument "files": Use a string, a number, or a list of them.',
      'probe: Option "name": Use a string or a number.',
      'probe: Option "ratio": Use a string or a number.',
      'probe: Option "color": Use true or false.',
      'probe: Option "backup": Use a string, a number, or true.',
      'probe: Option "verbose": Use a whole number of 0 or more.',
      'probe: Option "tag": Use a string, a number, or a list of them.',
      '',
    ].join('\n'),
    status: 'failed',
  });
  expect(unlowerableMore).toMatchObject({
    exitCode: 2,
    messages: [
      'probe: Argument "target": Use a string or a number.',
      'probe: Option "name": Use a string or a number.',
      'probe: Option "ratio": Use a string or a number.',
      'probe: Option "flag": Use true or false.',
      'probe: Option "verbose": Use a whole number of 0 or more.',
      '',
    ].join('\n'),
  });
});

/** The fixture's naming report. */
interface Names {
  byName: Outcome;
  group: Outcome;
  hidden: Outcome;
  seen: unknown[];
  source: Outcome;
  sourceArgv: { code: number; stderr: string };
  unknownArgument: Outcome;
  unknownOption: Outcome;
}

test('an argument binds by name, so a value never shifts into an earlier argument left out', () => {
  const { byName, seen }: Names = JSON.parse(report('names'));
  expect(seen).toEqual(['x']);
  expect(byName).toMatchObject({
    exitCode: 2,
    messages:
      'probe: Argument "first" requires a value. Supply a value for "first".\nprobe: Option "depth" is required. Supply a value.\n',
  });
});

test('every problem names an option by its declared name, a source problem included', () => {
  const { byName, source, sourceArgv }: Names = JSON.parse(report('names'));
  expect(byName.failure).toMatchObject({
    problems: [
      { reason: 'missing', spelling: 'first' },
      { reason: 'missing', spelling: 'depth' },
    ],
  });
  expect(sourceArgv.stderr).toBe(
    'probe: Option "--min-bytes" (from PROBE_MIN_BYTES): Expected a whole number of at least 0.\n',
  );
  expect(source).toMatchObject({
    exitCode: 2,
    messages:
      'probe: Option "min-bytes" (from PROBE_MIN_BYTES): Expected a whole number of at least 0.\n',
  });
});

test('an unknown option name and an unknown argument name report their by-name sentences with exit 2', () => {
  const { unknownArgument, unknownOption }: Names = JSON.parse(report('names'));
  expect(unknownOption).toMatchObject({
    exitCode: 2,
    failure: { name: 'UnknownOptionError', spelling: 'verbos' },
    messages: 'probe: Unknown option "verbos". Supply the name of a declared option.\n',
  });
  expect(unknownArgument).toMatchObject({
    exitCode: 2,
    failure: { accepted: 1, command: ['get'], extra: ['pth'], name: 'UnexpectedArgumentError' },
    messages:
      'probe: Command "get" declares no argument "pth". Supply the name of a declared argument.\n',
  });
});

test('the result reaches output, every other write reaches messages, all of it plain, on a host with no terminal or argv', () => {
  const result = invoke(fixture, ['capture'], { env: { FORCE_COLOR: '1' } });
  expect(result.status).toBe(0);
  const { plain, report: reported }: { plain: Outcome; report: Outcome } = JSON.parse(
    result.stdout,
  );
  expect(plain).toEqual({ messages: '', output: 'print\nrendered\n', status: 'completed' });
  expect(reported).toEqual({
    messages: [
      'print on a result Command',
      'ℹ info',
      '✔ success',
      '⚠ warn',
      '✘ error',
      'rendered',
      'ℹ {"argv":[],"terminal":{"stderr":{"isTTY":false},"stdin":{"isTTY":false},"stdout":{"isTTY":false}}}',
      '',
    ].join('\n'),
    output: '3\n',
    status: 'completed',
  });
});

/** The fixture's failure report. */
interface Failures {
  defect: Outcome;
  foreign: Outcome;
  lateFault: Outcome;
  noHandler: Outcome;
  received: { context: unknown; name: string }[];
  rejected: boolean | string;
}

test('the handler receives the translated failure, never the foreign throw, and maps it into the outcome', () => {
  const { foreign, received }: Failures = JSON.parse(report('failures'));
  expect(foreign).toEqual({
    exitCode: 1,
    failure: { mapped: 'The foreign call failed.' },
    messages: 'The foreign call failed.\n',
    output: '',
    status: 'failed',
  });
  expect(received[1]).toEqual({
    context: { application: 'probe', exitCode: 1, path: ['foreign'] },
    name: 'TranslatedError',
  });
});

test('a path ending at a group holds the missing subcommand, and a hidden Command routes', () => {
  const { group, hidden }: Names = JSON.parse(report('names'));
  expect(group).toMatchObject({
    exitCode: 2,
    messages: 'probe: Command "cache" requires a subcommand. Use one of: clear.\n',
  });
  expect(hidden).toEqual({ messages: '', output: 'purged\n', status: 'completed' });
});

test('a fault reported after a primary outcome that succeeded is the failure the handler receives', () => {
  const { lateFault }: Failures = JSON.parse(report('failures'));
  expect(lateFault).toEqual({
    exitCode: 1,
    failure: '@loomcli/core/next-misuse',
    messages: 'probe: Something went wrong.\n',
    output: '',
    status: 'failed',
  });
});

test('with no handler the outcome holds the failure itself', () => {
  const { noHandler }: Failures = JSON.parse(report('failures'));
  expect(noHandler.failure).toEqual({ isTranslated: true, message: 'The foreign call failed.' });
});

test('a defect writes the generic message in a distributed build and its diagnostic in a development one, and the handler receives the InternalError', () => {
  const distributed: Failures = JSON.parse(report('failures', 'distributed'));
  const development: Failures = JSON.parse(report('failures', 'development'));
  expect(distributed.defect.messages).toBe('probe: Something went wrong.\n');
  expect(development.defect.messages).toMatch(
    /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nthe action broke\n/u,
  );
  expect([distributed.received[0]?.name, development.received[0]?.name]).toEqual([
    'InternalError',
    'InternalError',
  ]);
});

test('a broken failure view resolves failed with exit 1', () => {
  const { foreign }: Failures = JSON.parse(report('failures', 'distributed', 'broken-view'));
  expect(foreign).toMatchObject({
    exitCode: 1,
    messages: 'The foreign call failed.\nprobe: Something went wrong.\n',
    status: 'failed',
  });
});

test('a handler that throws makes invoke reject with the same value', () => {
  const { rejected }: Failures = JSON.parse(report('failures'));
  expect(rejected).toBe(true);
});

/** The fixture's view report. */
type Views = Record<'assigned' | 'json' | 'noResult' | 'notString' | 'unknown', Outcome>;

test('view selects the starting view, and a middleware assignment after it wins', () => {
  const { assigned, json }: Views = JSON.parse(report('view'));
  expect(json).toEqual({ messages: '', output: '{"count":2}\n', status: 'completed' });
  expect(assigned).toEqual({ messages: '', output: 'count 2\n', status: 'completed' });
});

test.each([
  ['unknown', 'invoke() selected view "yaml", which Command "count" does not name.'],
  ['notString', 'invoke() selected a view that is not a string on Command "count".'],
  ['noResult', 'invoke() selected view "json" on Command "get", which declares no result.'],
] as const)('a %s view is the view-selection defect named for invoke()', (key, sentence) => {
  const views: Views = JSON.parse(report('view', 'development'));
  expect(views[key]).toMatchObject({ exitCode: 1, status: 'failed' });
  expect(views[key].messages).toMatch(
    /^-- INVALID VIEW SELECTION -+ @loomcli\/core\/view-selection/u,
  );
  expect(views[key].messages).toContain(`\n\n${sentence}\n`);
  expect(views[key].messages).toContain("\nSupply a view name the Command's result declares.\n");
});

test('a call from an action touches no process listener, exit status, or real stream, and its writes stay in the outcome', () => {
  const { code, stderr, stdout }: { code: number; stderr: string; stdout: string } = JSON.parse(
    report('isolation'),
  );
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
  expect(JSON.parse(stdout)).toEqual({
    after: { counts: [1, 1], exitCode: null },
    before: { counts: [1, 1], exitCode: null },
    outcome: {
      messages: '⚠ child message\n',
      output: 'child output\n{"argv":[],"counts":[1,1],"cwd":"/sentinel"}\n',
      status: 'completed',
    },
    real: { stderr: 0, stdout: 0 },
  });
});

test('app.invoke with a host override reads the four fields and nothing of the process', () => {
  expect(echoed(JSON.parse(report('host')))).toEqual({
    argv: [],
    cwd: '/virtual',
    env: { ONLY: 'x' },
    platform: 'plan9',
    reader: true,
    stdin: false,
    terminal: { stderr: { isTTY: false }, stdin: { isTTY: false }, stdout: { isTTY: false } },
  });
});

test('a SIGTERM to the parent run resolves its call in flight as cancelled with 143, and the handler is never reached', async () => {
  const running = start(fixture, ['sigterm']);
  await running.announced('ready');
  running.child.kill('SIGTERM');
  await expect(running.exit).resolves.toEqual({
    signal: null,
    status: 143,
    stderr: '',
    stdout: [
      'ready',
      '{"handled":[],"outcome":{"exitCode":143,"status":"cancelled"}}',
      '{"code":143}',
      '',
    ].join('\n'),
  });
});

test("an abort of the call's own signal resolves cancelled with 130 and never reaches the handler", () => {
  expect(invoke(fixture, ['own-abort'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'ready\n{"handled":[],"outcome":{"exitCode":130,"status":"cancelled"}}\n',
  });
});

test('a signal already aborted at the call runs no middleware and no action', () => {
  expect(JSON.parse(report('pre-aborted'))).toEqual({
    marks: [],
    outcome: { exitCode: 130, status: 'cancelled' },
  });
});

/** The four lines a chatty action writes under its label. */
function lines(label: string): string {
  return `${[0, 1, 2, 3].map((index) => `${label} ${String(index)}`).join('\n')}\n`;
}

test('two overlapping calls capture their own bytes, and an invoked action resolves its own nested call', () => {
  const { both, inner }: { both: Outcome; inner: Outcome } = JSON.parse(report('nesting'));
  expect(echoed(both)).toEqual({
    left: { messages: '', output: lines('left'), status: 'completed' },
    right: { messages: '', output: lines('right'), status: 'completed' },
  });
  expect(echoed(inner)).toEqual({ messages: '', output: lines('left'), status: 'completed' });
});

test("an action's call runs no lifecycle hook again, and each app.invoke runs every onCommandAttach once", () => {
  expect(JSON.parse(report('graph'))).toMatchObject({
    fromAction: '0\n',
    perBuild: 3,
    perCall: 3,
  });
});

test('app.invoke reports a build fault as a failed outcome with exit 1', () => {
  expect(JSON.parse(report('graph'))).toMatchObject({
    broken: { exitCode: 1, messages: 'probe: Something went wrong.\n', status: 'failed' },
  });
});

test("the failure view and the onFailure hook read invokedBy as 'argv' under run() and 'name' under invoke()", () => {
  expect(JSON.parse(report('invoked-by'))).toEqual({
    argv: 'Stopped. (argv)\n',
    named: 'Stopped. (name)\n',
    seen: [{ hook: 'argv' }, { hook: 'name' }],
  });
});

/** The fixture's call-shape report, keyed by the slot each call malforms. */
type Shapes = Record<string, Outcome & { failure: { sentence: string } }>;

test.each([
  ['path', 'invoke() received a path that is not an array of Command names.'],
  ['values', 'invoke() received values that are not an object.'],
  [
    'valuesKey',
    'invoke() received values that hold a key other than args, options, and passthrough.',
  ],
  ['args', 'invoke() received args that are not an object.'],
  ['options', 'invoke() received options that are not an object.'],
  ['passthrough', 'invoke() received a passthrough that is not an array of strings.'],
  ['signal', 'invoke() received a signal that is not an AbortSignal.'],
  ['failure', 'invoke() received a failure handler that is not a function.'],
  [
    'host',
    'invoke() received a host that holds a field other than env, cwd, platform, and readSource.',
  ],
])('a malformed %s reports invoke-options with exit 1, rendered by build', (slot, sentence) => {
  const distributed: Shapes = JSON.parse(report('shape', 'distributed'));
  const development: Shapes = JSON.parse(report('shape', 'development'));
  expect(distributed[slot]).toMatchObject({
    exitCode: 1,
    failure: { sentence },
    messages: 'probe: Something went wrong.\n',
    status: 'failed',
  });
  expect(development[slot]?.messages).toMatch(
    /^-- INVALID INVOKE OPTIONS -+ @loomcli\/core\/invoke-options\n\n/u,
  );
  expect(development[slot]?.messages).toContain(`\n\n${sentence}\n`);
});

/** The fixture's report of malformed calls that pass a failure handler. */
interface HandledShapes {
  action: Outcome;
  args: Outcome;
  options: Outcome;
  received: { context: unknown; identity: string }[];
  rejected: boolean | string;
  signal: Outcome;
}

/** A failed outcome whose failure the fixture's handler mapped to the defect's sentence. */
function mapped(sentence: string): Outcome {
  return {
    exitCode: 1,
    failure: { mapped: sentence },
    messages: 'probe: Something went wrong.\n',
    output: '',
    status: 'failed',
  };
}

test("a malformed slot's invoke-options defect reaches the caller's failure handler, from app.invoke and an action's invoke", () => {
  const handled: HandledShapes = JSON.parse(report('shape-handled'));
  expect(handled.args).toEqual(mapped('invoke() received args that are not an object.'));
  expect(handled.options).toEqual(mapped('invoke() received options that are not an object.'));
  expect(handled.signal).toEqual(mapped('invoke() received a signal that is not an AbortSignal.'));
  expect(JSON.parse(handled.action.output ?? '')).toEqual(
    mapped('invoke() received options that are not an object.'),
  );
  const context = { application: 'probe', exitCode: 1, path: [] };
  expect(handled.received).toEqual(
    Array.from({ length: 4 }, () => ({ context, identity: '@loomcli/core/invoke-options' })),
  );
  expect(handled.rejected).toBe(true);
});

test("a value lowered by name is recorded in a middleware's spellings under the option's reported spelling", () => {
  expect(echoed(JSON.parse(report('spellings')))).toEqual({
    loud: '--loud',
    quiet: '--no-quiet',
    tiny: '-t',
  });
});
