import { Writable } from 'node:stream';

import { jsonkit } from '../../dist/application.js';

const [scenario, file] = process.argv.slice(2);

/** A stream that records every byte written to it, as a sink host's stdout and stderr do. */
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

/**
 * One outcome as the fixture reports it. The bundle carries its own copy of core, so the failure
 * is named by its class's name and its static code rather than by `instanceof`.
 */
function described(outcome) {
  if (outcome.status !== 'failed') {
    return outcome;
  }
  const { failure, ...rest } = outcome;
  return {
    ...rest,
    cause: failure.cause instanceof Error ? failure.cause.code : failure.cause,
    classCode: failure.constructor.code,
    failure: failure.name,
  };
}

const scenarios = {
  /** `app.invoke` from a removed working directory resolves failed, and never rejects. */
  invoke: async () => {
    const outcome = await jsonkit.invoke(['keys'], { options: { file } });
    process.stdout.write(`${JSON.stringify(described(outcome))}\n`);
  },
  /** A `host.cwd` override replaces the capture at both doors, so each completes. */
  overrides: async () => {
    const stdout = sink();
    const stderr = sink();
    const code = await jsonkit.run({
      host: {
        argv: ['keys', '-f', file],
        cwd: '/srv/override',
        stderr: stderr.stream,
        stdout: stdout.stream,
      },
    });
    const named = await jsonkit.invoke(
      ['keys'],
      { options: { file } },
      { host: { cwd: '/srv/override' } },
    );
    const ran = { code, stderr: stderr.text(), stdout: stdout.text() };
    process.stdout.write(`${JSON.stringify({ named: described(named), ran })}\n`);
  },
};

await scenarios[scenario]();
