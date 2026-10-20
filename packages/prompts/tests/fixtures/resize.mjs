import { Readable, Writable } from 'node:stream';

import { Application } from '@loomcli/core';

import { select } from '../../dist/index.js';
import { questionFrame } from '../../dist/views.js';

/**
 * A select over ten choices whose stderr height is read live. A plan in argv[2], as JSON, gives the
 * rows of the first frame and, for each frame after it, the rows to set and the key to press:
 * { rows, steps: [{ rows?, key: 'down' | 'up' }] }. After the last step the keyboard presses
 * Enter. Without a plan, the window shrinks from 30 rows to 6 before the second frame and grows
 * to 30 again before the third, with Down pressed before each.
 */
const plan =
  process.argv[2] === undefined
    ? {
        rows: 30,
        steps: [
          { key: 'down', rows: 6 },
          { key: 'down', rows: 30 },
        ],
      }
    : JSON.parse(process.argv[2]);
const keys = { down: '\u001B[B', up: '\u001B[A' };
let { rows } = plan;
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
const steps = [...plan.steps];
const app = new Application('resize', { description: 'Ask a select across resizes.' }).action(
  async (context) => {
    const { out } = context;
    await select(
      {
        ...context,
        out: {
          ...out,
          region: (options) => {
            const region = out.region(options);
            return {
              get closedBy() {
                return region.closedBy;
              },
              draw: async (data, view) => {
                await region.draw(data, view);
                if (view === questionFrame) {
                  shown.push({ above: data.above, choices: data.choices.length, rows: data.rows });
                  const next = steps.shift();
                  if (next === undefined) {
                    keyboard.push('\r');
                  } else {
                    rows = next.rows ?? rows;
                    keyboard.push(keys[next.key]);
                  }
                }
              },
              end: (state, label) => region.end(state, label),
              live: region.live,
              report: (progress) => region.report(progress),
              signal: region.signal,
            };
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
