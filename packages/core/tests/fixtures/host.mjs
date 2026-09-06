import { Readable, Writable } from 'node:stream';

import { Application } from '@loom/core';

const scenario = process.argv[2];
if (scenario === 'capture') {
  const app = new Application('host')
    .argument('values', { required: true, variadic: true })
    .action(({ args, host, out }) => {
      const original = [...host.argv];
      args.values.push('argument mutation');
      process.argv.push('process mutation');
      process.env.LOOM_CAPTURE_TEST = 'changed';
      out.print(
        JSON.stringify({
          argv: host.argv,
          cwdMatches: host.cwd === process.cwd(),
          env: host.env.LOOM_CAPTURE_TEST,
          original,
          streams:
            host.stdin === process.stdin &&
            host.stdout === process.stdout &&
            host.stderr === process.stderr,
          terminal: host.terminal,
        }),
      );
    });
  process.argv = [process.execPath, 'host.mjs', 'before run', 'two words'];
  process.env.LOOM_CAPTURE_TEST = 'at run';
  await app.run();
} else if (scenario === 'capture-once') {
  const first = [];
  const second = [];
  const firstStream = new Writable({
    write(chunk, _encoding, callback) {
      first.push(chunk.toString());
      callback();
    },
  });
  const secondStream = new Writable({
    write(chunk, _encoding, callback) {
      second.push(chunk.toString());
      callback();
    },
  });
  const stdout = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('Output failed.'));
    },
  });
  let stderrReads = 0;
  let terminalReads = 0;
  let hostReads = 0;
  let actionSawFirst = false;
  const overrides = {
    argv: [],
    get stderr() {
      stderrReads++;
      return stderrReads === 1 ? firstStream : secondStream;
    },
    stdout,
    get terminal() {
      terminalReads++;
      return { stderr: { isTTY: false }, stdin: { isTTY: false }, stdout: { isTTY: false } };
    },
  };
  const app = new Application('host').action(({ host, out }) => {
    actionSawFirst = host.stderr === firstStream;
    out.print('fail');
  });
  const code = await app.run({
    get host() {
      hostReads++;
      return overrides;
    },
  });
  process.stdout.write(
    `${JSON.stringify({
      actionSawFirst,
      code,
      first,
      hostReads,
      second,
      stderrReads,
      terminalReads,
    })}\n`,
  );
} else if (scenario === 'overrides') {
  const argv = ['original'];
  const env = { ONLY: 'original' };
  const terminal = {
    stderr: { columns: undefined, isTTY: false, rows: undefined },
    stdin: { isTTY: true },
    stdout: { columns: 81, isTTY: true, rows: 25 },
  };
  let reads = 0;
  const stdin = new Readable({
    read() {
      reads++;
      this.push(null);
    },
  });
  const app = new Application('host')
    .argument('values', { required: true, variadic: true })
    .action(({ args, host, out }) => {
      argv.push('mutation');
      env.ONLY = 'mutation';
      terminal.stdout.columns = 1;
      out.print(
        JSON.stringify({
          args,
          argv: host.argv,
          cwd: host.cwd,
          env: host.env,
          reads,
          sameInput: stdin === host.stdin,
          terminal: host.terminal,
        }),
      );
    });
  await app.run({ host: { argv, cwd: 'virtual-workspace', env, stdin, terminal } });
} else if (scenario === 'build-output') {
  const chunks = [];
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const app = new Application('bad');
  const code = await app.run({ host: { stderr } });
  process.stdout.write(`${JSON.stringify({ chunks, code })}\n`);
} else if (scenario === 'reuse') {
  const app = new Application('reuse')
    .argument('values', { required: true, variadic: true })
    .action(({ args, out }) => out.print(args.values.join(',')));
  await app.run({ host: { argv: ['one'] } });
  await app.run({ host: { argv: ['two'] } });
}
