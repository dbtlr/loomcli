import { Readable, Writable } from 'node:stream';

import { Application, override, processHandle } from '@loomcli/core';

import { text, secret } from '../../dist/index.js';
import { questionFrame } from '../../dist/views.js';

const scenario = process.argv[2];
class Keyboard extends Readable {
  raw = false;
  modes = [];
  _read() {}
  setRawMode(value) {
    this.raw = value;
    this.modes.push(value);
    return this;
  }
}
const input = new Keyboard();
/** The bytes each key scenario types: an interrupt key, which this stdin raises no signal for. */
const keys = { 'ctrl-backslash': '\u001c', 'ctrl-c': '\u0003', 'ctrl-z': '\u001a8080\r' };
const caller = new AbortController();
let output = '';
let messages = '';
let scheduled = false;
let abortRestored = false;
const stdout = new Writable({
  write(chunk, encoding, done) {
    output += chunk.toString();
    done();
  },
});
const stderr = new Writable({
  write(chunk, encoding, done) {
    messages += chunk.toString();
    done();
    if (!scheduled && messages.includes('?')) {
      scheduled = true;
      setImmediate(() => {
        if (scenario === 'abort') {
          caller.abort('stop');
          abortRestored = !input.raw;
        } else if (scenario === 'eof') {
          input.push(null);
        } else if (scenario === 'error') {
          input.destroy(new Error('keyboard failed'));
        } else if (scenario in keys) {
          input.push(keys[scenario]);
        } else {
          input.push(scenario === 'secret' ? 'secret-value\r' : '8080\ryes\r');
        }
      });
    }
  },
});
let secretVisible = false;
const app = new Application('setup', {
  description: 'Configure the service.',
  views: [
    override(questionFrame, {
      render: (data, context) => {
        if (data.kind === 'secret' && data.typed !== '') {
          secretVisible = true;
        }
        return `extra row\n${questionFrame.render(data, context)}`;
      },
    }),
  ],
}).action(async (context) => {
  const answer =
    scenario === 'secret'
      ? await secret(context, { message: 'Secret' })
      : await text(context, { message: 'Port' });
  await context.out.print(answer);
});
const code = await app.run({
  process: processHandle({
    argv: [],
    env: {},
    stderr,
    stdin: input,
    stdout,
    terminal: {
      stderr: { columns: 80, isTTY: true, rows: 24 },
      stdin: { isTTY: true },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
  }),
  signal: caller.signal,
});
process.stdout.write(
  JSON.stringify({
    abortRestored,
    code,
    listeners: ['data', 'end', 'close', 'error'].map((name) => input.listenerCount(name)),
    messages,
    modes: input.modes,
    output,
    paused: input.isPaused(),
    raw: input.raw,
    secretVisible,
  }),
);
