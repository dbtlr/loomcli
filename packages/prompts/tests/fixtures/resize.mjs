import { Readable, Writable } from 'node:stream';

import { Application } from '@loomcli/core';

import { select } from '../../dist/index.js';
import { questionFrame } from '../../dist/views.js';

/**
 * A select over ten choices whose stderr height is read live. The window shrinks from 30 rows to 6
 * before the second frame, and grows to 30 again before the third. The keyboard presses Down after
 * the first frame and the second, and Enter after the third.
 */
let rows = 30;
const shown = [];
class Keyboard extends Readable {
  _read() {}
  setRawMode() {
    return this;
  }
}
const keyboard = new Keyboard();
const sink = new Writable({
  write(_chunk, _encoding, done) {
    done();
  },
});
const resizes = [6, 30];
const app = new Application('resize', { description: 'Ask a select across resizes.' }).action(
  async (context) => {
    const { out } = context;
    await select(
      {
        ...context,
        out: {
          ...out,
          draw: async (data, view) => {
            const count = await out.draw(data, view);
            if (view === questionFrame) {
              shown.push({ choices: data.choices.length, rows: data.rows });
              const next = resizes.shift();
              if (next === undefined) {
                keyboard.push('\r');
              } else {
                rows = next;
                keyboard.push('\u001B[B');
              }
            }
            return count;
          },
        },
      },
      {
        choices: Array.from({ length: 10 }, (_value, index) => `choice-${index}`),
        message: 'Backend',
      },
    );
  },
);
const code = await app.run({
  host: {
    argv: [],
    env: {},
    stderr: sink,
    stdin: keyboard,
    terminal: {
      stderr: {
        columns: 80,
        isTTY: true,
        get rows() {
          return rows;
        },
      },
      stdin: { isTTY: true },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
  },
});
process.stdout.write(JSON.stringify({ code, shown }));
