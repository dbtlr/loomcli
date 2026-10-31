import { Writable } from 'node:stream';

import { processHandle } from '@loomcli/core';

import { isolationApplication, signalApplication } from './by-name.mjs';

const scenario = process.argv[2];
const release = { build: process.argv[3] ?? 'distributed' };
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
if (scenario === 'isolation') {
  // A sentinel host: every stream records its writes, so a write the call leaked would show.
  const stdout = sink();
  const stderr = sink();
  const real = { stderr: 0, stdout: 0 };
  let restore = [];
  const app = isolationApplication({
    afterCall: () => {
      for (const undo of restore) {
        undo();
      }
      return { counts: counts(), exitCode: process.exitCode ?? null, real };
    },
    beforeCall: () => {
      const before = { counts: counts(), exitCode: process.exitCode ?? null };
      restore = [
        countWrites(process.stdout, real, 'stdout'),
        countWrites(process.stderr, real, 'stderr'),
      ];
      return before;
    },
    counts,
  });
  const code = await app.run({
    process: processHandle({
      argv: ['parent'],
      cwd: '/sentinel',
      release,
      stderr: stderr.stream,
      stdout: stdout.stream,
    }),
  });
  print({ code, stderr: stderr.text(), stdout: stdout.text() });
  process.exitCode = 0;
}
if (scenario === 'sigterm') {
  const { app } = signalApplication({
    marks: [],
    print,
    writeStdout: (text) => process.stdout.write(text),
  });
  print({ code: await app.run({ process: processHandle({ argv: ['parent'], release }) }) });
}
/** The listeners the process holds for SIGINT and SIGTERM, which a live run() adds. */
function counts() {
  return [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
}

/** Counts every write to one real stream under `key`, and answers the call that stops counting. */
function countWrites(stream, tally, key) {
  const original = stream.write;
  stream.write = (...args) => {
    tally[key] += 1;
    return Reflect.apply(original, stream, args);
  };
  return () => {
    stream.write = original;
  };
}

/** A stream that records every byte written to it. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}
