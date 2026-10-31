// Acceptance plan: see packages/core/tests/invoke.test.ts.

import { expect, test } from 'vite-plus/test';

import { report } from './fixtures/invoke.js';

/** What the fixture reports for one pinned invocation, through each door. */
interface WedgeCase {
  argv: { code: number; stderr: string; stdout: string };
  named: { status: string; exitCode?: number; messages: string; output: string };
}

/** The outcome fields the equivalence covers: what each stream received and the code. */
function asArgv({ named }: WedgeCase) {
  return {
    code: named.exitCode ?? 0,
    stderr: named.messages,
    stdout: named.output,
  };
}

test('run() with argv and invoke() with the same path and values write the same bytes and resolve the same code', async () => {
  const wedge: WedgeCase[] = JSON.parse(await report('wedge'));
  const cases = wedge.slice(0, 6);
  expect(cases.map((entry) => entry.argv.code)).toEqual([0, 0, 0, 0, 65, 65]);
  for (const entry of cases) {
    expect(asArgv(entry)).toEqual(entry.argv);
  }
});

test('a completed invocation reads completed and a failed one carries the code and the failure', async () => {
  const wedge: WedgeCase[] = JSON.parse(await report('wedge'));
  expect(wedge[0]?.named.status).toBe('completed');
  expect(wedge[4]?.named).toMatchObject({
    exitCode: 65,
    failure: { name: 'PathNotFoundError' },
    form: {
      code: 'path-not-found',
      exitCode: 65,
      hints: [],
      message: 'Path not found: "missing". Run jsonkit keys to list the keys at the root.',
    },
    status: 'failed',
  });
});

test('an input problem names the option by its spelling under run() and by its declared name under invoke(), with no help hint', async () => {
  const wedge: WedgeCase[] = JSON.parse(await report('wedge'));
  const entry = wedge[6];
  expect(entry?.argv).toEqual({
    code: 2,
    stderr:
      'jsonkit: Option "--field" at 0: Expected a nonempty value.\nRun "jsonkit select --help" to see the usage.\n',
    stdout: '',
  });
  expect(entry && asArgv(entry)).toEqual({
    code: 2,
    stderr: 'jsonkit: Option "field" at 0: Expected a nonempty value.\n',
    stdout: '',
  });
});

test('an unknown option suggests a declared name under invoke(), and neither the help nor the explain hint prints', async () => {
  const wedge: WedgeCase[] = JSON.parse(await report('wedge'));
  const entry = wedge[7];
  expect(entry?.argv).toEqual({
    code: 2,
    stderr: [
      'jsonkit: Unknown option "--verbos". Did you mean "--verbose"?',
      'Run "jsonkit --help" to see the usage.',
      'Run "jsonkit --explain" to explain this command.',
      '',
    ].join('\n'),
    stdout: '',
  });
  expect(entry && asArgv(entry)).toEqual({
    code: 2,
    stderr: 'jsonkit: Unknown option "verbos". Did you mean "verbose"?\n',
    stdout: '',
  });
});

/** What the fixture reports for the naming scenarios. */
interface Names {
  alias: WedgeCase['named'];
  argument: WedgeCase['named'];
  help: WedgeCase['named'];
  helpArgv: WedgeCase['argv'];
  unknown: WedgeCase['named'];
}

test('an unknown path element lists the root children, an unknown argument names its key, and an alias routes', async () => {
  const { alias, argument, unknown }: Names = JSON.parse(await report('names'));
  expect(unknown).toMatchObject({
    exitCode: 2,
    messages:
      'jsonkit: Unknown command "nope". Use one of: doctor, completion, mcp, manpage, get, keys, select, stats.\n',
    status: 'failed',
  });
  expect(argument).toMatchObject({
    exitCode: 2,
    messages:
      'jsonkit: Command "get" declares no argument "pth". Supply the name of a declared argument.\n',
    status: 'failed',
  });
  expect(alias).toEqual({ messages: '', output: 'name\na\nb\nuser\n', status: 'completed' });
});

test('help: true completes with the extended help page that --help prints', async () => {
  const { help, helpArgv }: Names = JSON.parse(await report('names'));
  expect(helpArgv).toMatchObject({ code: 0, stderr: '' });
  expect(helpArgv.stdout).toContain('EXAMPLES');
  expect(help).toEqual({ messages: '', output: helpArgv.stdout, status: 'completed' });
});

test('an invocation by name requires a file because content stdin is unavailable', async () => {
  expect(JSON.parse(await report('stdin'))).toMatchObject({
    exitCode: 2,
    messages: 'jsonkit: Option "file": Expected at least 1 readable source.\n',
    output: '',
    status: 'failed',
  });
});

test('invoke() with the color plugin installed captures plain text under FORCE_COLOR, even naming color', async () => {
  const outcome: { output: string; status: string } = JSON.parse(await report('color'));
  expect(outcome.status).toBe('completed');
  expect(outcome.output).toContain(
    '      --[no-]color  Turn color on or off, overriding NO_COLOR.\n',
  );
  expect(outcome.output).not.toContain('\u001b');
});
