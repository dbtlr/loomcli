import { Readable, Writable } from 'node:stream';

import { Application } from '@loomcli/core';
import { dateTime, path } from '@loomcli/validators';

import { text } from '../../dist/index.js';

const scenario = process.argv[2];
class Keyboard extends Readable {
  sent = false;
  _read() {
    if (!this.sent) {
      this.sent = true;
      this.push(scenario === 'path' ? 'notes.txt\r' : '2026-10-15T10:30\r');
    }
  }
  setRawMode() {
    return this;
  }
}
let output = '';
let messages = '';
const sink = new Writable({
  write(chunk, encoding, done) {
    messages += chunk.toString();
    done();
  },
});
const app = new Application('questions', { description: 'Validate question answers.' }).action(
  async (context) => {
    const answer =
      scenario === 'path'
        ? await text(context, { message: 'File', validate: path() })
        : await text(context, { message: 'When', validate: dateTime() });
    output = answer instanceof Date ? answer.toISOString() : answer;
  },
);
const code = await app.run({
  host: {
    argv: [],
    cwd: '/workspace',
    env: {},
    platform: 'linux',
    stderr: sink,
    stdin: new Keyboard(),
    terminal: {
      stderr: { columns: 80, isTTY: true, rows: 24 },
      stdin: { isTTY: true },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
    timeZone: 'Europe/Berlin',
  },
});
process.stdout.write(JSON.stringify({ code, messages, output }));
