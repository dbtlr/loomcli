import { writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';

import { Application, processHandle } from '@loomcli/core';

/**
 * Arguments: the shape (`row`, `whole`, `io`, or `slow`), a row count or `infinite`, the
 * milliseconds each row busy-waits, and, for `io` and `slow`, the row that raises SIGINT.
 */
const [shape, size, work = '0', signalRow = '1'] = process.argv.slice(2);
const infinite = size === 'infinite';
const count = infinite ? Number.POSITIVE_INFINITY : Number(size);
const rowWork = Number(work);
const raisesSignal = shape === 'io' || shape === 'slow';
let yielded = 0;
let turn = undefined;
const turns = [];
let announced = false;

/** Records progress once per event-loop turn without adding a yield to the source. */
function observe() {
  turns.push(yielded);
  turn = setImmediate(observe);
}

/** Keeps the thread busy for the row's own work, which never yields to the event loop. */
function busy(milliseconds) {
  const until = performance.now() + milliseconds;
  while (performance.now() < until) {
    // The row's own work.
  }
}

async function* rows() {
  if (shape === 'io') {
    // Resumes from an I/O callback before the signal, so the signal waits for a later poll.
    await readFile(new URL(import.meta.url));
  }
  if (infinite && shape === 'whole') {
    writeSync(2, 'ready\n');
  }
  if (!infinite) {
    turn = setImmediate(observe);
  }
  while (yielded < count) {
    busy(rowWork);
    yielded += 1;
    if (raisesSignal && yielded === Number(signalRow)) {
      process.kill(process.pid, 'SIGINT');
    }
    yield yielded;
  }
}

// Discarding writes prevents pipe back-pressure from giving the signal an unrelated turn.
const stdout = new Writable({
  write(chunk, encoding, callback) {
    if (infinite && !announced) {
      announced = true;
      writeSync(1, chunk);
    }
    callback();
  },
});
const view = shape === 'whole' ? { render: () => 'complete\n' } : { row: () => 'row\n' };
const code = await new Application('sequence')
  .rows({ views: { text: view } })
  .action(async ({ out }) => {
    await out.results(rows());
    clearImmediate(turn);
  })
  .run({ process: processHandle({ argv: [], stdout }) });
if (!infinite) {
  writeSync(1, `${JSON.stringify(turns)}\n`);
}
process.exitCode = code;
