import { stripVTControlCharacters } from 'node:util';

import { Application, style } from '@loomcli/core';
import { theme } from '@loomcli/plugins/theme';
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

/** The editor's answered line on a terminal of `columns`, with dim drawn faint and highlight underlined. */
async function styledAnswer(columns: number, answer: string, lines: number): Promise<string> {
  const app = new Application('draw', {
    plugins: [theme({ dim: style.faint, highlight: style.underline })],
  }).action(async ({ out }) => {
    await out.draw({ answer, kind: 'editor', lines, message: 'Notes' }, answeredLine);
  });
  const mock = mockProcess({ terminal: { columns, rows: 24, streams: ['stderr'] } });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  return mock.stderr.text;
}

test.each([
  // The first line clips with its highlight kept, and an empty answer stays dim as it clips.
  [
    80,
    'abcdefghijklmnop',
    '\u001b[2m?\u001b[22m Notes \u001b[2m·\u001b[22m \u001b[4mabcdefghijklmnop\u001b[24m \u001b[2m(+1 line)\u001b[22m\n',
  ],
  [14, '', '\u001b[2m?\u001b[22m Notes \u001b[2m·\u001b[22m \u001b[2memp…\u001b[22m\n'],
  // Below seven columns the row clips, and the dim mark and separator stay dim.
  [5, 'abcdefghijklmnop', '\u001b[2m?\u001b[22m … \u001b[2m·\u001b[22m\n'],
  [6, '', '\u001b[2m?\u001b[22m … \u001b[2m·\u001b[22m \n'],
  [3, 'abcdefghijklmnop', '\u001b[2m?\u001b[22m …\n'],
] satisfies [number, string, string][])(
  'the editor answered line keeps its styles at %s columns for %j',
  async (columns, answer, expected) => {
    await expect(styledAnswer(columns, answer, 2)).resolves.toBe(expected);
  },
);
