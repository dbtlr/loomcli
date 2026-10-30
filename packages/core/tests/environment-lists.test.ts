/*
 * Acceptance plan for the environment list of a multiple option
 * (docs/core/input-sources.md#input-sources, Environment lists).
 *
 * Every case runs an Application in process on a mock process.
 *
 * - Split. A multiple string option's variable splits at each occurrence of the declared delimiter,
 *   matched literally and left to right, a delimiter of several characters included, and a value
 *   with no delimiter fills a list of one item.
 * - Kept. No item is trimmed, and a delimiter at either end or beside another fills an empty item.
 * - Names. The first name in the list that holds a non-empty value supplies the list.
 * - Replacement. A variable's list satisfies `required` and keeps the default from applying.
 * - Content. A multiple content option reads each item as a path.
 * - Declarations. An empty delimiter on a multiple string or content option is a declaration error
 *   at the declaring call.
 */
import { Application, Command } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** The lists the action read, or none when it never ran. */
const seen: string[][] = [];

function application() {
  return new Application('app')
    .option('field', {
      default: ['fallback'],
      env: ['APP_FIELDS', 'APP_FIELDS_OLD'],
      envDelimiter: ',',
      multiple: true,
      type: 'string',
    })
    .option('path', { env: 'APP_PATHS', envDelimiter: '::', multiple: true, type: 'string' })
    .action(({ options }) => {
      seen.push(options.field, options.path ?? []);
    });
}

/** The lists the action read in one run: the `field` list, then the `path` list. */
async function listsOf(env: Record<string, string>, argv: string[] = []): Promise<string[][]> {
  seen.length = 0;
  await application().run({ process: mockProcess({ argv, env }) });
  return [...seen];
}

test('a variable splits at each delimiter and a value with none fills one item', async () => {
  await expect(listsOf({ APP_FIELDS: 'name,size' })).resolves.toEqual([['name', 'size'], []]);
  await expect(listsOf({ APP_FIELDS: 'name' })).resolves.toEqual([['name'], []]);
});

test('a delimiter of several characters is matched literally', async () => {
  await expect(listsOf({ APP_PATHS: 'a::b:c::d' })).resolves.toEqual([
    ['fallback'],
    ['a', 'b:c', 'd'],
  ]);
});

test('no item is trimmed and a stray delimiter fills an empty item', async () => {
  await expect(listsOf({ APP_FIELDS: ' a , b,' })).resolves.toEqual([[' a ', ' b', ''], []]);
  await expect(listsOf({ APP_FIELDS: ',a,,b' })).resolves.toEqual([['', 'a', '', 'b'], []]);
});

test('the first name that holds a non-empty value supplies the list', async () => {
  await expect(listsOf({ APP_FIELDS: '', APP_FIELDS_OLD: 'x,y' })).resolves.toEqual([
    ['x', 'y'],
    [],
  ]);
});

test('the list replaces the default, and an empty variable is unset', async () => {
  await expect(listsOf({ APP_FIELDS: 'a' })).resolves.toEqual([['a'], []]);
  await expect(listsOf({ APP_FIELDS: '' })).resolves.toEqual([['fallback'], []]);
});

test('an occurrence in argv outranks the variable', async () => {
  await expect(listsOf({ APP_FIELDS: 'a,b' }, ['--field', 'z'])).resolves.toEqual([['z'], []]);
});

test('a variable satisfies a required multiple option', async () => {
  const mock = mockProcess({ argv: [], env: { APP_NEEDED: 'a,b' } });
  const lists: string[][] = [];
  const status = await new Application('app')
    .option('needed', {
      env: 'APP_NEEDED',
      envDelimiter: ',',
      multiple: true,
      required: true,
      type: 'string',
    })
    .action(({ options }) => {
      lists.push(options.needed);
    })
    .run({ process: mock });
  expect({ lists, status }).toEqual({ lists: [['a', 'b']], status: 0 });
});

test('a multiple content option reads each item as a path', async () => {
  const mock = mockProcess({ argv: [], env: { APP_FILES: 'a.txt,missing.txt' } });
  const status = await new Application('app')
    .option('file', { env: 'APP_FILES', envDelimiter: ',', multiple: true, type: 'content' })
    .action(() => {})
    .run({ process: mock });
  expect(status).toBe(2);
  expect(mock.stderr.text).toBe(
    [
      'app: Option "--file" (from APP_FILES) at 0: Expected a readable file that exists.',
      'app: Option "--file" (from APP_FILES) at 1: Expected a readable file that exists.',
      '',
    ].join('\n'),
  );
});

test('an empty delimiter is a declaration error at the declaring call', () => {
  expect(() =>
    new Command('c').option('field', {
      env: 'F',
      envDelimiter: '',
      multiple: true,
      type: 'string',
    }),
  ).toThrow('@loomcli/core/env-delimiter');
});

test('an empty delimiter on a multiple content option is a declaration error', () => {
  expect(() =>
    new Command('c').option('file', {
      env: 'F',
      envDelimiter: '',
      multiple: true,
      type: 'content',
    }),
  ).toThrow('@loomcli/core/env-delimiter');
});
