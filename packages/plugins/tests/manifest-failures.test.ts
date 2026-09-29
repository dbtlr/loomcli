import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/manifest-failures.mjs', import.meta.url);

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
function documentOf(argv: string[]) {
  const result = invoke(fixture, ['app', ...argv]);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return { document: printedSchema.parse(JSON.parse(result.stdout)), text: result.stdout };
}

/** The failures of the root's child with one name, from the root document. */
function failuresOf(name: string): readonly unknown[] {
  const child = documentOf(['--manifest']).document.command.children.find(
    (candidate) => candidate.name === name,
  );
  if (child === undefined) {
    throw new Error(`The document holds no child "${name}".`);
  }
  return child.failures;
}

/** The application-wide table, with the rows the fixture declares joined to core's five. */
const exitCodes = {
  '0': 'Successful execution and core output',
  '1': 'Expected action failure, internal failure, or invalid declarations',
  '130': 'Cancelled by SIGINT or by a caller-supplied abort',
  '143': 'Cancelled by SIGTERM',
  '2': 'Invalid invocation inputs',
  '65': 'Declared failures: bad-data, inner-bad, write-bad',
  '69': 'Declared failures: unavailable',
  '70': 'Declared failures: software-fault',
};

test('the table joins each declared code to core rows, in ascending order, naming failures in depth-first order', () => {
  const { document, text } = documentOf(['--manifest']);
  expect(document.exitCodes).toEqual(exitCodes);
  expect(Object.keys(document.exitCodes)).toEqual(['0', '1', '2', '65', '69', '70', '130', '143']);
  expect(text).toContain('"65": "Declared failures: bad-data, inner-bad, write-bad"');
});

test('every slice carries the whole application table, a hidden Command included', () => {
  expect(documentOf(['none', '--manifest']).document.exitCodes).toEqual(exitCodes);
  expect(documentOf(['secret', '--manifest']).document.command.failures).toEqual([
    { exitCode: 70, meaning: 'A bug.', name: 'software-fault' },
  ]);
});

test('a Command with no declared failures reads an empty list', () => {
  expect(failuresOf('none')).toEqual([]);
  expect(documentOf(['--manifest']).document.command.failures).toEqual([]);
});

test('an author value and a plugin value concatenate in collection order, and an identical entry prints once', () => {
  expect(failuresOf('read')).toEqual([
    { exitCode: 65, meaning: 'The data is bad.', name: 'bad-data' },
    { exitCode: 69, meaning: 'The service is down.', name: 'unavailable' },
  ]);
});

test('an entry lists its name, code, and meaning in that key order', () => {
  const [entry] = failuresOf('read');
  expect(Object.keys(Object(entry))).toEqual(['name', 'exitCode', 'meaning']);
});

test('one name on two Commands with one code and meaning is listed on both', () => {
  expect(failuresOf('write')).toEqual([
    { exitCode: 65, meaning: 'The written data is bad.', name: 'write-bad' },
    { exitCode: 65, meaning: 'The data is bad.', name: 'bad-data' },
  ]);
});

test('a class that declares no code lists 1, a class that declares 2 lists 2, and neither adds a row', () => {
  expect(failuresOf('plain')).toEqual([
    { exitCode: 1, meaning: 'Something plain failed.', name: 'plain-failure' },
    { exitCode: 2, meaning: 'The request was refused.', name: 'refused' },
  ]);
  const table = documentOf(['--manifest']).document.exitCodes;
  expect(table['1']).toBe('Expected action failure, internal failure, or invalid declarations');
  expect(table['2']).toBe('Invalid invocation inputs');
});

/** The report one failure-name conflict produces, whichever Command was routed. */
function conflict(sentence: string) {
  return {
    status: 1,
    stderr: `Invalid declaration: ${sentence} Declare one code and one meaning for each failure name.\n`,
    stdout: '',
  };
}

test('one name with two codes is a declaration error naming the name and both Commands', () => {
  const report = conflict(
    'Failure "invalid-json" is declared with exit code 65 on Command "get" and exit code 1 on Command "select".',
  );
  expect(invoke(fixture, ['code-conflict', '--manifest'])).toEqual(report);
  expect(invoke(fixture, ['code-conflict', 'get', '--manifest'])).toEqual(report);
});

test('one name with two meanings is a declaration error naming the name and both Commands', () => {
  expect(invoke(fixture, ['meaning-conflict', 'select', '--manifest'])).toEqual(
    conflict(
      'Failure "invalid-json" is declared with meaning "The document is not valid JSON." on Command "get" and meaning "The document cannot be parsed." on Command "select".',
    ),
  );
});

test('a conflict never reaches a run without --manifest', () => {
  expect(invoke(fixture, ['code-conflict', 'get'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\n',
  });
});

/** What one manifest value case reports: no fault, or the declaration error its call raised. */
function rule(name: string): unknown {
  const result = invoke(new URL('fixtures/manifest-rules.mjs', import.meta.url), [name]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** The declaration error one rejected manifest value on `get` reports. */
function invalid(message: string) {
  return {
    fault: 'DeclarationError',
    message: `Command "get" holds an invalid "@loomcli/plugins/manifest/command" value: ${message} Correct the value.`,
  };
}

test('a declared failure is rejected at the call unless it holds a failure class, a kebab-case name, and one line', () => {
  const notClass = 'Supply a failure class, a class that extends LoomError.';
  expect(rule('failure-valid')).toEqual({ fault: null });
  expect(rule('failure-function')).toEqual(invalid(notClass));
  expect(rule('failure-foreign-class')).toEqual(invalid(notClass));
  expect(rule('failure-missing')).toEqual(invalid(notClass));
  expect(rule('failure-name-uppercase')).toEqual(
    invalid('Supply a kebab-case name: lowercase letters and digits in words joined by hyphens.'),
  );
  expect(rule('failure-meaning-on-two-lines')).toEqual(
    invalid('Supply one line that holds a character other than whitespace.'),
  );
});

test('a failure class whose static exit code is 200 is rejected at the call', () => {
  expect(rule('failure-code-200')).toEqual(
    invalid(
      'Failure class "ReservedError" declares exit code 200. Declare a whole number from 1 through 125; 0 means success, and 126 and above belong to the shell and to signals.',
    ),
  );
});
