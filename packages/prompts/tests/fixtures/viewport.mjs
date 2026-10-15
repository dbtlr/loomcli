import { Readable, Writable } from 'node:stream';

import { Application } from '@loomcli/core';

import { select } from '../../dist/index.js';
import { questionFrame } from '../../dist/views.js';

const columns = Number(process.argv[2]);
const height = Number(process.argv[3]);
let advanced = 0;
let answer = undefined;
class Keyboard extends Readable {
  sent = false;
  _read() {
    if (!this.sent) {
      this.sent = true;
      setImmediate(() => this.push('\r'));
    }
  }
  setRawMode() {
    return this;
  }
}
const sink = new Writable({
  write(chunk, encoding, done) {
    done();
  },
});
const app = new Application('viewport', { description: 'Render a bounded select frame.' }).action(
  async (context) => {
    const { out } = context;
    if (process.argv[5] === 'flow') {
      answer = await select(
        {
          ...context,
          out: {
            ...out,
            draw: async (data, view) => {
              const count = await out.draw(data, view);
              if (view === questionFrame) {
                advanced = Math.max(advanced, count);
              }
              return count;
            },
          },
        },
        {
          choices: Array.from({ length: 10 }, (_value, index) => `choice-${index}`),
          default: 'choice-3',
          message: process.argv[4] ?? 'Backend',
        },
      );
      return;
    }
    advanced = await out.draw(
      {
        above: 3,
        below: 2,
        choices: ['choice-3', 'choice-4', 'choice-5', 'choice-6', 'choice-7'],
        columns,
        highlighted: 0,
        issue: undefined,
        kind: 'select',
        message: process.argv[4] ?? 'Backend',
        rows: height,
      },
      questionFrame,
    );
  },
);
const code = await app.run({
  host: {
    argv: [],
    env: {},
    stderr: sink,
    stdin: new Keyboard(),
    terminal: {
      stderr: { columns, isTTY: true, rows: height },
      stdin: { isTTY: true },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
  },
});
process.stdout.write(JSON.stringify({ advanced, answer, code }));
