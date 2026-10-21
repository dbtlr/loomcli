import { Writable } from 'node:stream';

import { Application } from '@loomcli/core';
import { dateTime } from '@loomcli/validators';

/**
 * One run of an application per token, whose `--at` option validates with `dateTime(options)`.
 * The arguments are the factory options as JSON, the host override's time zone or `-` for the
 * process's own, then the tokens. It prints one record for each token: the exit code, what the
 * action printed (the ISO instant the validator output), and what stderr held.
 */
const [declared, timeZone, ...tokens] = process.argv.slice(2);

/** A stream that keeps what is written to it. */
function sink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, text: () => chunks.join('') };
}

const app = new Application('probe')
  .option('at', { type: 'string', validate: dateTime(JSON.parse(declared)) })
  .action(({ options, out }) => out.print(options.at.toISOString()));

const records = [];
for (const token of tokens) {
  const stdout = sink();
  const stderr = sink();
  const host = {
    argv: [`--at=${token}`],
    stderr: stderr.stream,
    stdout: stdout.stream,
  };
  if (timeZone !== '-') {
    host.timeZone = timeZone;
  }
  const status = await app.run({ host });
  records.push({ status, stderr: stderr.text(), stdout: stdout.text() });
}
// Each run records its own status, so the process itself ends cleanly.
process.exitCode = 0;
process.stdout.write(`${JSON.stringify(records)}\n`);
