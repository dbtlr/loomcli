import { Writable } from 'node:stream';

import {
  Application,
  Command,
  LoomError,
  override,
  plugin,
  WorkingDirectoryError,
} from '@loomcli/core';

const [scenario, build = 'distributed'] = process.argv.slice(2);

/** The release facts one run reads, which decide whether a defect shows its Developer Diagnostic. */
const release = { build };

/** The value the capture throws, as a removed directory's `process.cwd()` throws one. */
const removed = Object.assign(new Error('ENOENT: process.cwd failed, uv_cwd'), {
  code: 'ENOENT',
  syscall: 'uv_cwd',
});

/** How many times core read the process's working directory. */
let reads = 0;

// The capture throws, as it does in a process whose working directory was removed.
process.cwd = () => {
  reads++;
  throw removed;
};

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

/** What every hook and action call recorded, so a scenario shows which of them ran. */
const calls = [];

/** A plugin whose `onFailure` hook records each call and answers a hint. */
const hinting = plugin('@fixture/hinting', {
  onFailure: (failure) => {
    calls.push(`hook:${failure.name}`);
    return ['A hint.'];
  },
});

/** An application with a hook and a view override, so a scenario shows that neither answers. */
function application() {
  return new Application('cwd', {
    description: 'The working directory application.',
    plugins: [hinting],
    views: [
      override(WorkingDirectoryError, { render: () => 'overridden\n' }),
      override(LoomError, { render: () => 'overridden\n' }),
    ],
  })
    .command(
      new Command('where', { description: 'Print the working directory.' }).action(
        ({ host, out }) => {
          calls.push('action:where');
          out.print(host.cwd);
        },
      ),
    )
    .command(
      new Command('nested', { description: 'Print the working directory by name.' }).action(
        async ({ invoke, out }) => {
          calls.push('action:nested');
          const outcome = await invoke(['where'], {});
          out.print(`${outcome.status}:${outcome.status === 'completed' ? outcome.output : ''}`);
        },
      ),
    );
}

/** One run on a sink host, with the facts a scenario reads back. */
async function runOn(host) {
  const stdout = sink();
  const stderr = sink();
  const code = await application().run({
    host: { argv: ['where'], release, stderr: stderr.stream, stdout: stdout.stream, ...host },
  });
  return { code, exitCode: process.exitCode, stderr: stderr.text(), stdout: stdout.text() };
}

/** The parts of one outcome a scenario reads, with the failure named and its cause compared. */
function described(outcome) {
  if (outcome.status !== 'failed') {
    return outcome;
  }
  const { failure, ...rest } = outcome;
  return {
    ...rest,
    cause: failure.cause === removed,
    failure: failure.name,
    instance: failure instanceof WorkingDirectoryError,
    message: failure.message,
  };
}

const scenarios = {
  /** An action's invoke reads its run's working directory and captures nothing. */
  action: async () => {
    const result = await runOn({ argv: ['nested'], cwd: '/srv/override' });
    process.stdout.write(`${JSON.stringify({ calls, reads, ...result })}\n`);
  },
  /** `app.invoke` from a working directory that cannot be read resolves failed. */
  invoke: async () => {
    const outcome = await application().invoke(['where'], {}, { host: { release } });
    process.stdout.write(`${JSON.stringify({ calls, reads, ...described(outcome) })}\n`);
  },
  /** A malformed call is reported from a working directory that cannot be read, and never rejects. */
  malformed: async () => {
    const outcome = await application().invoke('where', {}, { host: { release } });
    process.stdout.write(
      `${JSON.stringify({ calls, form: outcome.form, reads, status: outcome.status })}\n`,
    );
  },
  /** A `host.cwd` override replaces the capture at both doors. */
  overrides: async () => {
    const ran = await runOn({ cwd: '/srv/override' });
    const named = await application().invoke(
      ['where'],
      {},
      { host: { cwd: '/srv/named', release } },
    );
    process.stdout.write(`${JSON.stringify({ calls, named, ran, reads })}\n`);
  },
  /** `run()` from a working directory that cannot be read fails with the failure's line. */
  run: async () => {
    const result = await runOn({});
    process.stdout.write(`${JSON.stringify({ calls, reads, ...result })}\n`);
  },
  /** The failure itself, constructed outside a run, and its class read without an instance. */
  statics: () => {
    const failure = new WorkingDirectoryError({ cause: removed });
    process.stdout.write(
      `${JSON.stringify({
        cause: failure.cause === removed,
        code: WorkingDirectoryError.code,
        exitCode: WorkingDirectoryError.exitCode,
        instanceExitCode: failure.exitCode,
        message: failure.message,
        name: failure.name,
      })}\n`,
    );
  },
};

await scenarios[scenario]();
