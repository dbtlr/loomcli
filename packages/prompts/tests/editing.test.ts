import { stripVTControlCharacters } from 'node:util';

import { Application, validationContext, width } from '@loomcli/core';
import { key, mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { secret, text } from '../src/index.js';
import { questionFrame } from '../src/views.js';

test.each([
  [`abcd${key.left}${key.backspace}X`, 'abXd'],
  [
    `postgres://db.local:5432/app${key.alt('b')}${key.alt('b')}${key.ctrl('k')}`,
    'postgres://db.local:',
  ],
  [`abc${key.home}${key.delete}X`, 'Xbc'],
  [`${key.tab + key.home}db.`, 'db.localhost'],
  ['\u001b[200~first\nsecond\t\u001b[201~', 'first'],
  [`connect postgres://db.local:5432/app${key.ctrl('w')}`, 'connect '],
  [
    `connect postgres://db.local:5432/app${key.escape + key.backspace}`,
    'connect postgres://db.local:5432/',
  ],
  [`abc${key.ctrl('b')}${key.ctrl('d')}`, 'ab'],
  [`abc${key.ctrl('a')}${key.ctrl('f')}X`, 'aXbc'],
  [`abc${key.left}${key.ctrl('u')}`, 'c'],
  [`abc${key.home}${key.ctrl('e')}X`, 'abcX'],
  [`one two${key.home}\u001b[1;5CX`, 'oneX two'],
  [`one two${key.home}\u001bOcX`, 'oneX two'],
  [`one two\u001b\u001b[DX`, 'one Xtwo'],
  [`é👨‍👩‍👧‍👦${key.left}${key.backspace}X`, 'X👨‍👩‍👧‍👦'],
  [`a${key.left}é${key.right}X`, 'éaX'],
])('typed line edits %j into %j', async (keys, expected) => {
  let answer: unknown = undefined;
  const app = new Application('ask').action(async (context) => {
    answer = await text(context, { default: 'localhost', message: 'Name' });
  });
  const mock = mockProcess({ terminal: { columns: 40, keys: [keys + key.enter], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe(expected);
});

test.each([
  ['ab\u001b[', 'D', 'X\r'],
  ['ab\u001bO', 'D', 'X\r'],
  ['ab\u001b]late report', '\u0007', '\u001b[D', 'X\r'],
  ['ab\u001b[200~', 'X\nignored', '\u001b[20', '1~\r'],
])('a protocol sequence spans reads: %j', async (...chunks) => {
  let answer: unknown = undefined;
  const app = new Application('ask').action(async (context) => {
    answer = await text(context, { message: 'Name' });
  });
  const mock = mockProcess({ terminal: { columns: 40, keys: [chunks], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe(chunks[0].includes('200~') ? 'abX' : 'aXb');
  expect(mock.stderr.text).toContain('\u001b[?2004h');
  expect(mock.stderr.text).toContain('\u001b[?2004l');
});

test('a linked argument skips with its validated action value', async () => {
  let answer: unknown = undefined;
  const app = new Application('ask')
    .argument('port', {
      validate: {
        '~standard': {
          validate: (value) => ({ value: Number(value) }),
          vendor: 'test',
          version: 1,
        },
      },
    })
    .action(async (context) => {
      answer = await text(context, { argument: 'port', message: 'Port', skipIfSupplied: true });
    });
  const mock = mockProcess({ argv: ['8080'] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe(8080);
});

test.each([
  [0, '? › postgres://…'],
  [14, '? › …/db.local:…'],
  [28, '? › …l:5432/app '],
])('a twelve-column field draws the contract window at cursor %s', async (cursor, expected) => {
  const app = new Application('draw').action(async ({ out }) => {
    await out.draw(
      {
        cursor,
        hint: undefined,
        issue: undefined,
        kind: 'text',
        message: 'Name',
        typed: 'postgres://db.local:5432/app',
      },
      questionFrame,
    );
  });
  const mock = mockProcess({ terminal: { columns: 16, rows: 24, streams: ['stderr'] } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(stripVTControlCharacters(mock.stderr.text)).toBe(expected);
});

test('a frame without a cursor draws the cursor at the end of the typed line', async () => {
  const drawn: string[] = [];
  for (const cursor of [undefined, 3]) {
    const app = new Application('draw').action(async ({ out }) => {
      await out.draw(
        {
          hint: undefined,
          issue: undefined,
          kind: 'text',
          message: 'Name',
          typed: 'abc',
          ...(cursor === undefined ? {} : { cursor }),
        },
        questionFrame,
      );
    });
    const mock = mockProcess({ terminal: { columns: 40, rows: 24, streams: ['stderr'] } });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    drawn.push(mock.stderr.text);
  }
  expect(drawn[0]).toBe(drawn[1]);
  expect(stripVTControlCharacters(drawn[0] ?? '')).toBe('? Name › abc ');
});

test.each([1, 2, 3, 4, 7, 8, 12, 21, 22, 40, 80])(
  'a typed frame stays on one row at %s columns',
  async (columns) => {
    const app = new Application('draw').action(async ({ out }) => {
      await out.draw(
        {
          cursor: 3,
          hint: undefined,
          issue: undefined,
          kind: 'text',
          message: 'Repository connection URL',
          typed: '日本語のテキスト'.repeat(10),
        },
        questionFrame,
      );
    });
    const mock = mockProcess({ terminal: { columns, rows: 24, streams: ['stderr'] } });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(width(stripVTControlCharacters(mock.stderr.text))).toBeLessThanOrEqual(columns);
  },
);

test('an accepted secret discards typeahead from its Enter read', async () => {
  const answers: unknown[] = [];
  const app = new Application('ask').action(async (context) => {
    answers.push(await secret(context, { message: 'Password' }));
    answers.push(await text(context, { message: 'Name' }));
  });
  const mock = mockProcess({
    terminal: { columns: 40, keys: ['hidden\rleak\r', 'safe\r'], rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answers).toEqual(['hidden', 'safe']);
  expect(mock.stderr.text).not.toContain('hidden');
  expect(mock.stderr.text).not.toContain('leak');
});

test('a linked argument identifies question validation and accepts its raw prefill', async () => {
  const seen: unknown[] = [];
  let answer: unknown = undefined;
  const app = new Application('ask')
    .argument('port', {
      validate: {
        '~standard': {
          validate: (value) => ({ value: Number(value) }),
          vendor: 'test',
          version: 1,
        },
      },
    })
    .action(async (context) => {
      answer = await text(context, {
        argument: 'port',
        message: 'Port',
        validate: {
          '~standard': {
            validate: (value, options) => {
              const carried = validationContext(options);
              seen.push(carried?.input, carried?.phase);
              return { value: Number(value) };
            },
            vendor: 'test',
            version: 1,
          },
        },
      });
    });
  const mock = mockProcess({
    argv: ['08080'],
    terminal: { columns: 40, keys: [key.enter], rows: 24 },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answer).toBe(8080);
  expect(seen).toEqual([{ global: false, kind: 'argument', name: 'port' }, 'question']);
});

test('a question rejects a variadic argument link at its call', async () => {
  const app = new Application('ask')
    .argument('files', { variadic: true })
    .action(async (context) => {
      await text(context, { argument: 'files', message: 'Files' });
    });
  const mock = mockProcess({ terminal: { columns: 40, keys: [], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain('which is not a string argument that takes one value.');
  expect(mock.stderr.text).toContain('Link a string option or argument that takes one value.');
});

test('an accepted secret discards a paste started in its Enter read and completed during validation', async () => {
  const answers: unknown[] = [];
  const app = new Application('ask').action(async (context) => {
    answers.push(
      await secret(context, {
        message: 'Password',
        validate: {
          '~standard': {
            validate: async (value) => {
              await new Promise((resolve) => setTimeout(resolve, 20));
              return { value };
            },
            vendor: 'test',
            version: 1,
          },
        },
      }),
    );
    answers.push(await text(context, { message: 'Name' }));
  });
  const mock = mockProcess({
    terminal: {
      columns: 40,
      keys: [['hidden\r\u001b[', '200~leak', '\u001b[201~'], 'safe\r'],
      rows: 24,
    },
  });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(answers).toEqual(['hidden', 'safe']);
});
