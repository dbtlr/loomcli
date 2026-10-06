import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/invoke.mjs', import.meta.url);

/** What the fixture reports for one pinned invocation, through each door. */
interface WedgeCase {
  argv: { code: number; stderr: string; stdout: string };
  named: { status: string; exitCode?: number; messages: string; output: string };
}

/** The fixture's JSON report for one scenario, with no color forced from the developer's shell. */
function report(scenario: string): string {
  const result = invoke(fixture, [scenario], { env: { FORCE_COLOR: undefined } });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/** The outcome fields the equivalence covers: what each stream received and the code. */
function asArgv({ named }: WedgeCase) {
  return {
    code: named.exitCode ?? 0,
    stderr: named.messages,
    stdout: named.output,
  };
}

test('run() with argv and invoke() with the same path and values write the same bytes and resolve the same code', () => {
  const wedge: WedgeCase[] = JSON.parse(report('wedge'));
  const cases = wedge.slice(0, 6);
  expect(cases.map((entry) => entry.argv.code)).toEqual([0, 0, 0, 0, 65, 65]);
  for (const entry of cases) {
    expect(asArgv(entry)).toEqual(entry.argv);
  }
});

test('a completed invocation reads completed and a failed one carries the code and the failure', () => {
  const wedge: WedgeCase[] = JSON.parse(report('wedge'));
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

test('an input problem names the option by its spelling under run() and by its declared name under invoke(), with no help hint', () => {
  const wedge: WedgeCase[] = JSON.parse(report('wedge'));
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

test('an unknown option suggests a declared name under invoke(), and neither the help nor the explain hint prints', () => {
  const wedge: WedgeCase[] = JSON.parse(report('wedge'));
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

test('an unknown path element lists the root children, an unknown argument names its key, and an alias routes', () => {
  const { alias, argument, unknown }: Names = JSON.parse(report('names'));
  expect(unknown).toMatchObject({
    exitCode: 2,
    messages:
      'jsonkit: Unknown command "nope". Use one of: doctor, completion, get, keys, select.\n',
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

test('help: true completes with the extended help page that --help prints', () => {
  const { help, helpArgv }: Names = JSON.parse(report('names'));
  expect(helpArgv).toMatchObject({ code: 0, stderr: '' });
  expect(helpArgv.stdout).toContain('EXAMPLES');
  expect(help).toEqual({ messages: '', output: helpArgv.stdout, status: 'completed' });
});

test('an invocation by name reads an empty stdin, so a document read from it is not valid JSON', () => {
  expect(JSON.parse(report('stdin'))).toMatchObject({
    exitCode: 65,
    messages: 'The document is not valid JSON. Correct its syntax, or supply another document.\n',
    output: '',
    status: 'failed',
  });
});
