import { Writable } from 'node:stream';

import { Application, plugin } from '@loomcli/core';

const [scenario] = process.argv.slice(2);

/** The caller's own controller, which a ranking scenario aborts from its action. */
const controller = new AbortController();

/** Lines the fixture prints after the run, keyed for the test to read. */
const printed = [];

/** Every failure event the run logged, which a closed pipe adds none to. */
const failures = [];

const collector = plugin('fixture/collector', {
  onLog: (event) => {
    if (event.failure !== undefined) {
      failures.push(event.message);
    }
  },
});

/** The error a write fails with, as the runtime reports it with `code`. */
function writeError(code) {
  return Object.assign(new Error(`write ${code}`), { code });
}

/**
 * A stream that delivers its first `accepted` writes to the process's stdout and fails every later
 * one with `code`, as a pipe whose reader closed after the first line does with `EPIPE`.
 */
function closing(code, accepted) {
  let writes = 0;
  return new Writable({
    write(chunk, _encoding, callback) {
      writes += 1;
      if (writes <= accepted) {
        process.stdout.write(`stdout:${String(chunk)}`);
        callback();
        return;
      }
      callback(writeError(code));
    },
  });
}

/** The reason the run's signal carries, as one line a test reads. */
function describe(signal) {
  const { reason } = signal;
  return `reason:${reason.source}:${reason.cause instanceof Error ? reason.cause.message : 'none'}`;
}

/** An application of one action, with the failure collector installed. */
function application(action) {
  return new Application('probe', {
    description: 'Probe a closed pipe.',
    plugins: [collector],
  }).action(action);
}

/** An action that prints until a write rejects, then reports what it saw and lets it propagate. */
async function printUntilRefused({ out, signal }) {
  try {
    for (let line = 0; ; line += 1) {
      await out.print(`line ${line}`);
    }
  } catch (error) {
    printed.push(`rejected:${error === signal.reason}:aborted:${signal.aborted}`);
    throw error;
  }
}

const scenarios = {
  // The caller aborts first, so the closed pipe after it keeps the caller's code.
  'caller-first': () => ({
    app: application(async ({ out }) => {
      controller.abort(new Error('the caller stopped the run'));
      await out.print('lost');
    }),
    host: { stdout: closing('EPIPE', 0) },
  }),
  // A socket stdout whose reader closed, which XNU's send() reports as ENOTCONN once the peer is gone.
  'closed-socket': () => ({
    app: application(async (context) => {
      try {
        await printUntilRefused(context);
      } finally {
        printed.push(describe(context.signal));
      }
    }),
    host: { stdout: closing('ENOTCONN', 1) },
  }),
  // A stdout that fails with another code is a broken destination.
  'full-disk': () => ({
    app: application(({ out }) => out.print('lost')),
    host: { stdout: closing('ENOSPC', 0) },
  }),
  // The pipe closes first, so the caller's abort after it keeps the closed pipe's code.
  'pipe-first': () => ({
    app: application(async ({ out, signal }) => {
      await out.print('lost').catch(() => undefined);
      controller.abort(new Error('the caller stopped the run'));
      printed.push(describe(signal));
    }),
    host: { stdout: closing('EPIPE', 0) },
  }),
  print: () => ({
    app: application(async (context) => {
      try {
        await printUntilRefused(context);
      } finally {
        printed.push(describe(context.signal));
      }
    }),
    host: { stdout: closing('EPIPE', 1) },
  }),
  // A row source that never ends, which a closed pipe stops.
  rows: () => {
    let pulled = 0;
    let ended = false;
    async function* endless() {
      try {
        for (;;) {
          pulled += 1;
          yield pulled;
        }
      } finally {
        ended = true;
      }
    }
    return {
      after: () => printed.push(`pulled:${pulled}:ended:${ended}`),
      app: new Application('probe', { description: 'Probe a closed pipe.', plugins: [collector] })
        .rows({ views: { lines: { row: (row) => `${JSON.stringify(row)}\n` } } })
        .action(async ({ out, signal }) => {
          try {
            await out.results(endless());
          } finally {
            printed.push(describe(signal));
          }
        }),
      host: { stdout: closing('EPIPE', 1) },
    };
  },
  // Stderr's closed reader is a broken destination, so the run returns 1.
  stderr: () => ({
    app: application(({ out }) => out.info('lost')),
    host: { stderr: closing('EPIPE', 0) },
  }),
};

const build = scenarios[scenario];
if (build === undefined) {
  throw new Error(`Unknown scenario: ${scenario}`);
}
const { after, app, host } = build();
const code = await app.run({
  host: { argv: [], release: { build: 'distributed' }, ...host },
  signal: controller.signal,
});
after?.();
for (const line of printed) {
  process.stdout.write(`${line}\n`);
}
process.stdout.write(`failures:${failures.length}\nresolved:${code}\n`);
