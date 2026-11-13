import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { Application, processHandle } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';

const [turn, other, baton, rounds, batch, keep] = process.argv.slice(2);

/** Sleeps in place for a few milliseconds, so a wait for the other process burns no CPU. */
function pause() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}

/** Free-running processes pass `-` for the baton, and wait for each other only to start. */
const freeRunning = baton === '-';

/**
 * Marks this process ready in the working directory and waits for the other's mark, so two
 * free-running processes start writing together however long each took to start.
 */
function meetOther() {
  writeFileSync(`ready-${turn}`, '');
  while (!existsSync(`ready-${other}`)) {
    pause();
  }
}

/** Waits until the baton file names this process's turn. */
function awaitTurn() {
  if (freeRunning) {
    return;
  }
  while (!existsSync(baton) || readFileSync(baton, 'utf8') !== turn) {
    pause();
  }
}

/**
 * Two of these run at once against one file. With a baton file they hand it to each other, so the
 * processes append and rotate in a fixed order that real concurrency would not give; without one
 * they append and rotate at once. Each rotation renames every copy up to `keep`, so `keep` sets
 * what one rotation costs as well as how many records stay on disk.
 */
const app = new Application('heimdall', {
  description: 'A fixture application.',
  plugins: [logging({ keep: Number(keep), maxBytes: 400 })],
}).action(({ log }) => {
  if (freeRunning) {
    meetOther();
  }
  for (let round = 1; round <= Number(rounds); round += 1) {
    awaitTurn();
    for (let number = 1; number <= Number(batch); number += 1) {
      log.info(`${turn}-${round}-${number}`);
    }
    if (!freeRunning) {
      writeFileSync(baton, other);
    }
  }
});

process.exitCode = await app.run({ process: processHandle({ argv: [], platform: 'linux' }) });
