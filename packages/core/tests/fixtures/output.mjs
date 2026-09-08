import { Writable } from 'node:stream';

import { Application } from '@loomcli/core';

const scenario = process.argv[2];
const events = [];
const destination = new Writable({
  highWaterMark: 1,
  write(chunk, _encoding, callback) {
    setTimeout(() => {
      if (scenario === 'failed' || scenario === 'caught-write' || scenario === 'double-failed') {
        callback(new Error('Output failed.'));
      } else {
        events.push(chunk.toString());
        callback();
      }
    }, 5);
  },
});
if (scenario === 'closed') {
  destination.destroy();
}
const stderr = scenario === 'double-failed' ? destination : process.stderr;
const beforeErrors = destination.listenerCount('error');
let attempts = 0;
if (scenario === 'diagnostic-write') {
  destination.write = () => {
    attempts++;
    throw new Error('Synchronous write failure.');
  };
}
const app = new Application('output').action(async ({ out }) => {
  if (scenario === 'chained') {
    out.print('one').then(() => out.print('two'));
    return;
  }
  if (scenario === 'diagnostic-write') {
    out.fatal('Expected failure.');
  }
  if (scenario === 'renderer-failed') {
    const error = new Error('render');
    Object.defineProperty(error, 'message', {
      get() {
        throw new Error('Cannot render.');
      },
    });
    throw error;
  }
  if (scenario === 'semantics') {
    out.print(' \ntext\t');
    out.info('info');
    out.success('success');
    out.warn('warn');
    out.error('error');
    return 'ignored';
  }
  if (scenario === 'caught-write') {
    try {
      await out.print('one');
    } catch {
      events.push('caught');
    }
  } else {
    out.print('one');
    out.print('two');
    out.print('three');
  }
});
const code = await app.run({
  host: {
    argv: [],
    stderr: scenario === 'diagnostic-write' ? destination : stderr,
    stdout: destination,
  },
});
process.stdout.write(
  `${JSON.stringify({
    code,
    events,
    listeners: destination.listenerCount('error') - beforeErrors,
    ...(scenario === 'diagnostic-write' ? { attempts } : {}),
  })}\n`,
);
