import { Application } from '@loomcli/core';

/** More rows than a pipe buffers, so the source is still streaming when the reader closes. */
async function* rows() {
  for (let index = 0; index < 200_000; index += 1) {
    yield index;
  }
}

// The run uses the real process, so the stdout it writes to is the OS pipe the test holds.
await new Application('probe', { description: 'Probe a closed pipe on the real stdout.' })
  .rows({ views: { lines: { row: (row) => `${JSON.stringify(row)}\n` } } })
  .action(({ out }) => out.results(rows()))
  .run();
