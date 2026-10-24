import { Writable } from 'node:stream';

import { Application, processHandle } from '../../dist/index.js';

const scenario = process.argv[2];
let text = '';
let rows = 0;
const stderr = new Writable({
  write(chunk, encoding, callback) {
    text += chunk.toString();
    callback();
  },
});
const app = new Application('draw', { description: 'Draw terminal output.' }).action(
  async ({ out }) => {
    const first = out.info('before');
    rows = await out.draw(
      { carriage: 'abc\rdef', tab: 'ab\tXXX\n', wide: '界界界\n' }[scenario] ?? 'abcdef\n界界\n',
      {
        render: (value) => `\u001b[?25l${value}\u001b[?25h`,
      },
    );
    await out.info('after');
    await first;
  },
);
process.exitCode = await app.run({
  process: processHandle({
    argv: [],
    env: {},
    stderr,
    terminal: {
      stderr: { columns: { tab: 10, wide: 3 }[scenario] ?? 4, isTTY: true, rows: 24 },
      stdin: { isTTY: false },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
  }),
});
process.stdout.write(JSON.stringify({ rows, text }));
