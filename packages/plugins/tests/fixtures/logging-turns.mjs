import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { Application } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';

const [turn, other, baton, rounds, batch] = process.argv.slice(2);

/** Sleeps in place for a few milliseconds, so the wait for the baton burns no CPU. */
function pause() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}

/** Waits until the baton file names this process's turn. */
function awaitTurn() {
  while (!existsSync(baton) || readFileSync(baton, 'utf8') !== turn) {
    pause();
  }
}

/**
 * Two of these run at once against one file. They hand a baton file to each other, so the
 * processes append and rotate in a fixed order that real concurrency would not give.
 */
const app = new Application('heimdall', {
  description: 'A fixture application.',
  plugins: [logging({ keep: 100, maxBytes: 400 })],
}).action(({ log }) => {
  for (let round = 1; round <= Number(rounds); round += 1) {
    awaitTurn();
    for (let number = 1; number <= Number(batch); number += 1) {
      log.info(`${turn}-${round}-${number}`);
    }
    writeFileSync(baton, other);
  }
});

process.exitCode = await app.run({ host: { argv: [], platform: 'linux' } });
