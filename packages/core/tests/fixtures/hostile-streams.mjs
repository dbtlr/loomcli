import { Writable } from 'node:stream';

import { Application, plugin } from '@loomcli/core';

/**
 * The host stream the scenario replaces, `stdout` or `stderr`, how that stream behaves, and whether
 * the action fails after its write or returns.
 */
const [stream, behavior, outcome = 'fails'] = process.argv.slice(2);

/** How long a slow stream takes to call back, which is longer than core's reporting bound. */
const slowCallback = 1500;

/** Each chunk the stream finished, in order. */
const delivered = [];

/**
 * The replaced stream. `silent` takes every write and never calls back, emits no error, and never
 * closes. `throwing` throws from its own `_write`, which leaves a Node Writable holding every later
 * write without ever calling back. Both break the Writable contract. `slow` is live: it finishes
 * every write, later than core's reporting bound.
 */
const replaced = new Writable({
  write(chunk, _encoding, callback) {
    if (behavior === 'throwing') {
      throw new Error('Synchronous write failure.');
    }
    if (behavior === 'slow') {
      setTimeout(() => {
        delivered.push(chunk.toString());
        callback();
      }, slowCallback);
    }
  },
});

/** The listeners on each signal core may claim, as one line a test reads. */
function listeners() {
  return `${process.listenerCount('SIGINT')}:${process.listenerCount('SIGTERM')}`;
}

const before = listeners();
const code = await new Application('hostile', {
  plugins: [plugin('@fixture/signals', { signals: ['SIGINT', 'SIGTERM'] })],
})
  .action(({ out }) => {
    // The write is still in flight when the action ends, so whatever follows waits behind it.
    void (stream === 'stdout' ? out.print('one') : out.info('one'));
    if (outcome === 'fails') {
      out.fatal('Action failed.');
    }
  })
  .run({ host: { argv: [], [stream]: replaced } });
const atResolve = [...delivered];
if (behavior === 'slow') {
  // Core does not close a host stream, so the fixture ends it to learn what the stream received.
  await new Promise((resolve) => {
    replaced.end(resolve);
  });
}
process.stdout.write(
  `${JSON.stringify({ after: listeners(), atResolve, before, code, delivered })}\n`,
);
