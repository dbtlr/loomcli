// Acceptance plan: see packages/plugins/tests/manifest.test.ts.
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { findingsOf, ruleParts } from '../../../scripts/test-rules.js';
import { run as fixtureRun } from './fixtures/manifest-failures.js';
import { run as rulesRun } from './fixtures/manifest-rules-app.mjs';

/** A Command entry as these tests walk it: its name, failures, and children. */
interface Entry {
  readonly children: readonly Entry[];
  readonly failures: readonly unknown[];
  readonly name: string | null;
}

const entrySchema: z.ZodType<Entry> = z.lazy(() =>
  z.looseObject({
    children: z.array(entrySchema),
    failures: z.array(z.unknown()),
    name: z.string().nullable(),
  }),
);

const printedSchema = z.looseObject({
  command: entrySchema,
  exitCodes: z.record(z.string(), z.string()),
});

/** The document one invocation of the fixture application printed, parsed at the boundary. */
async function documentOf(argv: string[]) {
  const result = await fixtureRun(['app', ...argv]);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return { document: printedSchema.parse(JSON.parse(result.stdout)), text: result.stdout };
}

/** The failures of the root's child with one name, from the root document. */
async function failuresOf(name: string): Promise<readonly unknown[]> {
  const invocation1 = await documentOf(['--manifest']);
  const child = invocation1.document.command.children.find((candidate) => candidate.name === name);
  if (child === undefined) {
    throw new Error(`The document holds no child "${name}".`);
  }
  return child.failures;
}

/** The application-wide table, with the rows the fixture declares joined to core's seven. */
const exitCodes = {
  '0': 'Successful execution and core output',
  '1': 'Expected action failure, internal failure, or invalid declarations',
  '129': 'Cancelled by SIGHUP',
  '130': "Cancelled by SIGINT, a caller-supplied abort, or the action's cancel()",
  '131': 'Cancelled by SIGQUIT',
  '141': 'Stopped because the reader of stdout closed the pipe',
  '143': 'Cancelled by SIGTERM',
  '2': 'Invalid invocation inputs',
  '65': 'Declared failures: bad-data, inner-bad, write-bad',
  '69': 'Declared failures: unavailable',
  '70': 'Declared failures: software-fault',
};

test('the table joins each declared code to core rows, in ascending order, naming failures in depth-first order', async () => {
  const { document, text } = await documentOf(['--manifest']);
  expect(document.exitCodes).toEqual(exitCodes);
  expect(Object.keys(document.exitCodes)).toEqual([
    '0',
    '1',
    '2',
    '65',
    '69',
    '70',
    '129',
    '130',
    '131',
    '141',
    '143',
  ]);
  expect(text).toContain('"65": "Declared failures: bad-data, inner-bad, write-bad"');
});

test('every slice carries the whole application table, a hidden Command included', async () => {
  const invocation2 = await documentOf(['none', '--manifest']);
  expect(invocation2.document.exitCodes).toEqual(exitCodes);
  const invocation3 = await documentOf(['secret', '--manifest']);
  expect(invocation3.document.command.failures).toEqual([
    { code: 'software-fault', exitCode: 70, meaning: 'A bug.' },
  ]);
});

test('a Command with no declared failures reads an empty list', async () => {
  await expect(failuresOf('none')).resolves.toEqual([]);
  const invocation4 = await documentOf(['--manifest']);
  expect(invocation4.document.command.failures).toEqual([]);
});

test('an author value and a plugin value concatenate in collection order, and an identical entry prints once', async () => {
  await expect(failuresOf('read')).resolves.toEqual([
    { code: 'bad-data', exitCode: 65, meaning: 'The data is bad.' },
    { code: 'unavailable', exitCode: 69, meaning: 'The service is down.' },
  ]);
});

test('an entry lists its failure code, exit code, and meaning in that key order', async () => {
  const [entry] = await failuresOf('read');
  expect(Object.keys(Object(entry))).toEqual(['code', 'exitCode', 'meaning']);
});

test('one failure code on two Commands with one exit code and meaning is listed on both', async () => {
  await expect(failuresOf('write')).resolves.toEqual([
    { code: 'write-bad', exitCode: 65, meaning: 'The written data is bad.' },
    { code: 'bad-data', exitCode: 65, meaning: 'The data is bad.' },
  ]);
});

test('a class that declares neither code lists 1 and fatal, a class that declares 2 lists 2, neither adds a row, and a stale name is dropped', async () => {
  await expect(failuresOf('plain')).resolves.toEqual([
    { code: 'fatal', exitCode: 1, meaning: 'Something plain failed.' },
    { code: 'refused', exitCode: 2, meaning: 'The request was refused.' },
  ]);
  const invocation5 = await documentOf(['--manifest']);
  const table = invocation5.document.exitCodes;
  expect(table['1']).toBe('Expected action failure, internal failure, or invalid declarations');
  expect(table['2']).toBe('Invalid invocation inputs');
});

/** One invocation's report in each build, so a test compares both at once. */
async function reports(argv: string[]) {
  return {
    development: await fixtureRun(argv, { FIXTURE_BUILD: 'development' }),
    distributed: await fixtureRun(argv),
  };
}

/** One declared failure as the graph holds it: its exit code and its meaning. */
interface Declared {
  readonly exitCode: number;
  readonly meaning: string;
  readonly on: string;
}

/**
 * The finding for one declaration of `invalid-json`, rebuilt as the `manifestCommand()` value that
 * declared it with the entry the graph holds, and the carets under the key the two disagree on.
 */
function finding({ exitCode, meaning, on }: Declared, key: 'exitCode' | 'meaning'): string {
  const value = key === 'exitCode' ? `exitCode: ${String(exitCode)}` : `meaning: '${meaning}'`;
  const line = `    manifestCommand({ failures: [{ code: 'invalid-json', exitCode: ${String(exitCode)}, meaning: '${meaning}' }] })`;
  const start = line.indexOf(value);
  return `${line}\n${' '.repeat(start)}${'^'.repeat(value.length)} on ${on}`;
}

/**
 * What one invocation reports in each build, with a development build's Developer Diagnostic read
 * as the parts a conflict's test pins: its rule's parts and its findings.
 */
async function conflictReports(argv: string[]) {
  const { development, distributed } = await reports(argv);
  return {
    development: {
      findings: findingsOf(development.stderr),
      parts: ruleParts(development.stderr),
      status: development.status,
      stdout: development.stdout,
    },
    distributed,
  };
}

/**
 * The report one failure-code conflict produces in each build, whichever Command was routed: a
 * development build writes the rule's Developer Diagnostic, with a finding for each declaration,
 * and a distributed build writes the generic message.
 */
function conflict(sentence: string, first: Declared, second: Declared) {
  const key = first.exitCode === second.exitCode ? 'meaning' : 'exitCode';
  return {
    development: {
      findings: [finding(first, key), finding(second, key)],
      parts: {
        correction: 'Declare one exit code and one meaning for each failure code.',
        identity: '@loomcli/plugins/manifest/failure-code-conflict',
        sentence,
      },
      status: 1,
      stdout: '',
    },
    distributed: { status: 1, stderr: 'app: Something went wrong.\n', stdout: '' },
  };
}

const notJson = 'The document is not valid JSON.';

test('one failure code with two exit codes is a declaration error naming the code and both Commands', async () => {
  const report = conflict(
    'Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "select".',
    { exitCode: 65, meaning: notJson, on: 'Command "get"' },
    { exitCode: 1, meaning: notJson, on: 'Command "select"' },
  );
  await expect(conflictReports(['code-conflict', '--manifest'])).resolves.toEqual(report);
  await expect(conflictReports(['code-conflict', 'get', '--manifest'])).resolves.toEqual(report);
});

test('one failure code with two meanings is a declaration error naming the code and both Commands', async () => {
  await expect(conflictReports(['meaning-conflict', 'select', '--manifest'])).resolves.toEqual(
    conflict(
      'Failure "invalid-json" is declared with meaning "The document is not valid JSON." on Command "get" and meaning "The document cannot be parsed." on Command "select".',
      { exitCode: 65, meaning: notJson, on: 'Command "get"' },
      { exitCode: 65, meaning: 'The document cannot be parsed.', on: 'Command "select"' },
    ),
  );
});

test('a conflicting meaning is quoted with its control characters escaped', async () => {
  await expect(conflictReports(['meaning-conflict-controls', '--manifest'])).resolves.toEqual(
    conflict(
      String.raw`Failure "invalid-json" is declared with meaning "The document is not valid JSON." on Command "get" and meaning "Bad \u202eevil\u009b" on "x" on Command "select".`,
      { exitCode: 65, meaning: notJson, on: 'Command "get"' },
      { exitCode: 65, meaning: String.raw`Bad \u202eevil\u009b" on "x`, on: 'Command "select"' },
    ),
  );
});

test('one failure code with two exit codes on one Command is a declaration error naming that Command twice', async () => {
  await expect(conflictReports(['same-command-code-conflict', '--manifest'])).resolves.toEqual(
    conflict(
      'Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "get".',
      { exitCode: 65, meaning: notJson, on: 'Command "get"' },
      { exitCode: 1, meaning: notJson, on: 'Command "get"' },
    ),
  );
});

test('one failure code with two meanings on one Command is a declaration error naming that Command twice', async () => {
  await expect(
    conflictReports(['same-command-meaning-conflict', 'get', '--manifest']),
  ).resolves.toEqual(
    conflict(
      'Failure "invalid-json" is declared with meaning "The document is not valid JSON." on Command "get" and meaning "The document cannot be parsed." on Command "get".',
      { exitCode: 65, meaning: notJson, on: 'Command "get"' },
      { exitCode: 65, meaning: 'The document cannot be parsed.', on: 'Command "get"' },
    ),
  );
});

test('a conflict never reaches a run without --manifest', async () => {
  await expect(fixtureRun(['code-conflict', 'get'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\n',
  });
});

/** What one manifest value case reports: no fault, or the declaration error its call raised. */
async function rule(name: string, mode: string[] = []): Promise<unknown> {
  const result = await rulesRun([name, ...mode]);
  return JSON.parse(result.stdout);
}

/** The declaration error one rejected manifest value on `get` reports. */
function invalid(message: string) {
  return {
    fault: 'DeclarationError',
    message: `Command "get" holds an invalid "@loomcli/plugins/manifest/command" value: ${message} Correct the value.`,
  };
}

test('a declared failure is rejected at the call unless it holds a failure class and one line', async () => {
  const notClass = 'Supply a failure class, a class that extends LoomError.';
  await expect(rule('failure-valid')).resolves.toEqual({ fault: null });
  await expect(rule('failure-stale-name')).resolves.toEqual({ fault: null });
  await expect(rule('failure-function')).resolves.toEqual(invalid(notClass));
  await expect(rule('failure-foreign-class')).resolves.toEqual(invalid(notClass));
  await expect(rule('failure-missing')).resolves.toEqual(invalid(notClass));
  await expect(rule('failure-meaning-on-two-lines')).resolves.toEqual(
    invalid('Supply one line that holds a character other than whitespace.'),
  );
});

test("the extension stores a declared failure as its class's failure code, exit code, and meaning, in that key order", async () => {
  const stored = await rule('failure-valid', ['--stored']);
  expect(stored).toEqual({ code: 'bad-data', exitCode: 65, meaning: 'The data is bad.' });
  expect(Object.keys(Object(stored))).toEqual(['code', 'exitCode', 'meaning']);
  await expect(rule('failure-inherited-code', ['--stored'])).resolves.toEqual({
    code: 'fatal',
    exitCode: 1,
    meaning: 'The data is bad.',
  });
  // A stale hand-written name is dropped like any key the schema does not name.
  await expect(rule('failure-stale-name', ['--stored'])).resolves.toEqual(stored);
});

test('a failure class whose failure code is outside the grammar is rejected at the call', async () => {
  await expect(rule('failure-bad-code')).resolves.toEqual(
    invalid(
      'Failure class "BadCodeError" declares failure code "Bad_Code". Declare a kebab-case code of lowercase letters and digits, such as "registry-down".',
    ),
  );
});
