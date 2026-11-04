import { stripVTControlCharacters } from 'node:util';

import { Application } from '@loomcli/core';
import { answeredLine, questionFrame } from '@loomcli/prompts/views';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

test.each([
  [80, false, '? Notes › Press Enter to open your editor'],
  [80, true, '? Notes › Waiting for your editor to close the file…'],
  [24, false, '? N…s › Press Enter to …'],
  [1, false, ''],
  [2, false, '?'],
  [3, false, '? '],
] satisfies [number, boolean, string][])(
  'editor frame at %s columns, editing %s',
  async (columns, editing, expected) => {
    const mock = mockProcess({ env: { NO_COLOR: '1' }, terminal: { columns, rows: 24 } });
    const app = new Application('draw').action(async ({ out }) => {
      await out.draw(
        { editing, issue: undefined, kind: 'editor', message: 'Notes' },
        questionFrame,
      );
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(stripVTControlCharacters(mock.stderr.text)).toBe(expected);
    expect(mock.stderr.text).not.toContain('\u001b[7m');
  },
);

test.each([
  [80, '? Notes · abcdefghijklmnop (+1 line)\n'],
  [24, '? Notes · abc… (+1 line)\n'],
  [12, '? … · …\n'],
  [1, '?\n'],
] satisfies [number, string][])(
  'editor answered line fits %s columns',
  async (columns, expected) => {
    const mock = mockProcess({ env: { NO_COLOR: '1' }, terminal: { columns, rows: 24 } });
    const app = new Application('draw').action(async ({ out }) => {
      await out.draw(
        { answer: 'abcdefghijklmnop', kind: 'editor', lines: 2, message: 'Notes' },
        answeredLine,
      );
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(stripVTControlCharacters(mock.stderr.text)).toBe(expected);
  },
);
