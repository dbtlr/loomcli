import { Application } from '@loomcli/core';
import { key, mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import type { ChoiceEntry, MultiselectSettings } from '../src/index.js';
import { multiselect, select } from '../src/index.js';

test('select returns an object value and skips disabled choices and separators', async () => {
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.down + key.enter], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = undefined;
  const app = new Application('choices').action(async (context) => {
    answer = await select(context, {
      choices: [
        'a',
        { separator: 'Group' },
        { disabled: true, value: 'b' },
        { label: 'Two', value: { id: 2 } },
      ],
      message: 'Pick',
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toEqual({ id: 2 });
});

test('multiselect submits in selection order while searching', async () => {
  const mock = mockProcess({
    terminal: {
      columns: 80,
      keys: [key.down + key.tab + key.up + key.tab + key.enter],
      rows: 24,
      streams: ['stderr'],
    },
  });
  let answer: unknown = undefined;
  const app = new Application('choices').action(async (context) => {
    answer = await multiselect(context, { choices: ['a', 'b'], message: 'Pick', search: true });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toEqual(['b', 'a']);
});

async function choose(
  keys: string | readonly string[],
  multiple = false,
  extra: { search?: boolean; min?: number; max?: number } = {},
) {
  const mock = mockProcess({
    terminal: { columns: 80, keys: [keys], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = undefined;
  const app = new Application('choices').action(async (context) => {
    const settings = {
      choices: [
        'alpha',
        { separator: 'Group' },
        { disabled: '', value: 'blocked' },
        { description: 'Second', label: 'Beta', value: 'beta' },
        'gamma',
      ],
      message: 'Pick',
      ...extra,
    };
    answer = multiple ? await multiselect(context, settings) : await select(context, settings);
  });
  const code = await app.run({ process: mock });
  return { answer, code, output: mock.stderr.text };
}

test.each([
  [key.ctrl('n') + key.enter, 'beta'],
  [key.end + key.up + key.enter, 'beta'],
  [key.end + key.home + key.up + key.enter, 'alpha'],
  [key.end + key.down + key.enter, 'gamma'],
  [key.down + key.ctrl('p') + key.enter, 'alpha'],
  [`BE${key.enter}`, 'beta'],
  [`bXeta${key.home}${key.right}${key.ctrl('d')}${key.enter}`, 'beta'],
  [`bad${key.enter}${key.ctrl('u')}gam${key.enter}`, 'gamma'],
  [`betx${key.backspace}${key.home}${key.right}${key.end}${key.enter}`, 'beta'],
])('list navigation and search: %j', async (keys, answer) => {
  await expect(
    choose(keys, false, { search: keys.startsWith('B') || keys.startsWith('b') }),
  ).resolves.toMatchObject({ answer, code: 0 });
});

test('a standalone Escape clears the search term', async () => {
  await expect(
    choose(['bet', key.escape, key.enter], false, { search: true }),
  ).resolves.toMatchObject({
    answer: 'alpha',
    code: 0,
  });
});

test('selection order, toggling out and in, min, max, and an empty answer', async () => {
  await expect(
    choose(key.space + key.down + key.tab + key.up + key.space + key.space + key.enter, true),
  ).resolves.toMatchObject({ answer: ['beta', 'alpha'], code: 0 });
  const minimum = await choose(key.enter + key.space + key.enter, true, { min: 1 });
  expect(minimum).toMatchObject({ answer: ['alpha'], code: 0 });
  expect(minimum.output).toContain('Choose at least 1.');
  await expect(
    choose(key.space + key.down + key.space + key.enter, true, { max: 1 }),
  ).resolves.toMatchObject({ answer: ['alpha'], code: 0 });
  const empty = await choose(key.enter, true);
  expect(empty).toMatchObject({ answer: [], code: 0 });
  expect(empty.output).toContain('none');
});

test('space enters the search while Tab toggles and hidden selections survive', async () => {
  await expect(
    choose(`${key.tab}Beta ${key.enter}`, true, { search: true }),
  ).resolves.toMatchObject({
    answer: ['alpha'],
    code: 0,
  });
});

test('a source aborts on each changed term, drops stale rejection, waits for keys, and aborts at answer', async () => {
  const calls: { term: string; signal: AbortSignal }[] = [];
  const mock = mockProcess({
    terminal: { columns: 80, keys: [`uni${key.down}${key.enter}`], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = undefined;
  const app = new Application('source').action(async (context) => {
    answer = await select(context, {
      message: 'Country',
      source: (term, { signal }) => {
        calls.push({ signal, term });
        if (term !== 'uni') {
          return new Promise<readonly string[]>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('stale')), { once: true }),
          );
        }
        return Promise.resolve(['United Kingdom', 'United States']);
      },
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe('United States');
  expect(calls.map(({ term }) => term)).toEqual(['', 'u', 'un', 'uni']);
  expect(calls.every(({ signal }) => signal.aborted)).toBe(true);
});

test('the latest source rejection follows the ordinary failure path', async () => {
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  const app = new Application('source').action(async (context) => {
    await select(context, {
      message: 'Country',
      source: () => Promise.reject(new Error('Source failed.')),
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain('Source failed.');
  expect(mock.stderr.text).toContain('cancelled');
});

test('linked answers run their input validator, keep rejected selections, and return outputs', async () => {
  const mock = mockProcess({
    terminal: {
      columns: 80,
      keys: [key.tab + key.down + key.tab + key.enter + key.tab + key.enter],
      rows: 24,
      streams: ['stderr'],
    },
  });
  let answer: unknown = undefined;
  const app = new Application('linked')
    .option('port', {
      multiple: true,
      type: 'string',
      validate: {
        '~standard': {
          validate: (value) =>
            value === 'bad' ? { issues: [{ message: 'Use a port.' }] } : { value: Number(value) },
          vendor: 'test',
          version: 1,
        },
      },
    })
    .action(async (context) => {
      answer = await multiselect(context, {
        choices: ['80', { label: 'Invalid', value: 'bad' }],
        message: 'Ports',
        option: 'port',
      });
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toEqual([80]);
  expect(mock.stderr.text).toContain('Invalid: Use a port.');
});

test('supplied source values get one lookup each in supplied order and duplicate tokens select once', async () => {
  const calls: string[] = [];
  const mock = mockProcess({
    argv: ['--tag', 'b', '--tag', 'b', '--tag', 'c'],
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  let answer: unknown = undefined;
  const app = new Application('linked')
    .option('tag', { multiple: true, type: 'string' })
    .action(async (context) => {
      answer = await multiselect(context, {
        message: 'Tags',
        option: 'tag',
        source: (term) => {
          calls.push(term);
          return term === '' ? ['a'] : [term];
        },
      });
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toEqual(['b', 'c']);
  expect(calls).toEqual(['', 'b', 'c']);
});

test('an omitted collected input falls through to the question default', async () => {
  let answer: unknown = undefined;
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  const app = new Application('linked')
    .option('tag', { default: ['a'], multiple: true, type: 'string' })
    .action(async (context) => {
      answer = await multiselect(context, {
        choices: ['a', 'b'],
        default: ['b'],
        message: 'Tags',
        option: 'tag',
        skipIfSupplied: true,
      });
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toEqual(['b']);
});

test.each([
  [
    ['missing', 'blocked', 'b', 'c', 'd'],
    'Cannot select "missing", "blocked". Choose from the list. Cannot select "c", "d": at most 1 can be selected. Deselect a choice to select one.',
  ],
  [['b', 'c'], 'Cannot select "c": at most 1 can be selected. Deselect a choice to select it.'],
])('unselectable supplied values are named in order: %j', async (tokens, sentence) => {
  const mock = mockProcess({
    argv: tokens.flatMap((value) => ['--tag', value]),
    terminal: { columns: 120, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  const app = new Application('linked')
    .option('tag', { multiple: true, type: 'string' })
    .action(async (context) => {
      await expect(
        multiselect(context, {
          choices: ['b', 'c', 'd', { disabled: true, value: 'blocked' }],
          max: 1,
          message: 'Tags',
          option: 'tag',
        }),
      ).resolves.toEqual(['b']);
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toContain(sentence);
});

test('non-interactive supplied lists skip the source and selection limits', async () => {
  let called = false;
  const app = new Application('linked')
    .option('tag', { multiple: true, type: 'string' })
    .action(async (context) => {
      await expect(
        multiselect(context, {
          max: 1,
          message: 'Tags',
          option: 'tag',
          source: () => {
            called = true;
            return [];
          },
        }),
      ).resolves.toEqual(['a', 'b']);
    });
  await expect(
    app.run({ process: mockProcess({ argv: ['--tag', 'a', '--tag', 'b'] }) }),
  ).resolves.toBe(0);
  expect(called).toBe(false);
});

test.each([
  [{ choices: ['a'], max: 1, min: 2 }, 'The multiselect question "Tags" has min 2 above max 1.'],
  [
    { choices: ['a'], min: 2 },
    'The multiselect question "Tags" has min 2 and 1 choices that are not disabled.',
  ],
  [
    { choices: [{ disabled: true, value: 'a' }] },
    'The multiselect question "Tags" has no choice that is not disabled.',
  ],
])('computed choices report the exact declaration sentence', async (settings, sentence) => {
  const app = new Application('linked').action(async (context) => {
    const question: MultiselectSettings = { ...settings, message: 'Tags' };
    await multiselect(context, question);
  });
  const mock = mockProcess();
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain(sentence);
});

test('source cancellation interrupts a pending list operation without waiting for the source', async () => {
  const mock = mockProcess({
    terminal: { columns: 80, keys: [key.enter + key.ctrl('c')], rows: 24, streams: ['stderr'] },
  });
  const signals: AbortSignal[] = [];
  const app = new Application('source').action(async (context) => {
    await select(context, {
      message: 'Country',
      source: (_term, options) => {
        signals.push(options.signal);
        return new Promise<readonly string[]>(() => {});
      },
    });
  });
  await expect(app.run({ process: mock })).resolves.toBe(130);
  expect(signals[0]?.aborted).toBe(true);
});

test('a supplied select missing from the first source page opens its lookup list and term', async () => {
  const calls: string[] = [];
  const mock = mockProcess({
    argv: ['--country', 'uk'],
    terminal: { columns: 80, keys: [key.enter], rows: 24, streams: ['stderr'] },
  });
  const app = new Application('source')
    .option('country', { type: 'string' })
    .action(async (context) => {
      await expect(
        select(context, {
          message: 'Country',
          option: 'country',
          source: (term): readonly ChoiceEntry<string>[] => {
            calls.push(term);
            return term === '' ? ['fr'] : [{ label: 'United Kingdom', value: 'uk' }];
          },
        }),
      ).resolves.toBe('uk');
    });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(calls).toEqual(['', 'uk']);
  expect(mock.stderr.text).toContain('United Kingdom');
});
