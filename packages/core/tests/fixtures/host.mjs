import { isAbsolute, relative } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { Application, processHandle } from '@loomcli/core';

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
    release: { build: 'distributed' },
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
    get process() {
      hostReads++;
      return processHandle(overrides);
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
      // A relative cwd resolves against the process's working directory.
      const cwd = isAbsolute(host.cwd) ? relative(process.cwd(), host.cwd) : null;
      argv.push('mutation');
      env.ONLY = 'mutation';
      terminal.stdout.columns = 1;
      out.print(
        JSON.stringify({
          args,
          argv: host.argv,
          cwd,
          env: host.env,
          reads,
          sameInput: stdin === host.stdin,
          terminal: host.terminal,
        }),
      );
    });
  await app.run({
    process: processHandle({
      argv,
      cwd: 'virtual-workspace',
      env,
      stdin,
      terminal,
    }),
  });
} else if (scenario === 'terminal-getter') {
  let columns = 100;
  const stdout = {
    get columns() {
      return columns;
    },
    isTTY: true,
    rows: 30,
  };
  const terminal = {
    stderr: { columns: 80, isTTY: true, rows: 30 },
    stdin: { isTTY: false },
    stdout,
  };
  await new Application('host')
    .action(({ host, out }) => {
      const reading = () =>
        JSON.stringify({ columns: host.terminal.stdout.columns, rows: host.terminal.stdout.rows });
      out.print(reading());
      columns = 60;
      stdout.rows = 10;
      out.print(reading());
    })
    .run({ process: processHandle({ argv: [], env: {}, terminal }) });
} else if (scenario === 'build-output') {
  const chunks = [];
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const app = new Application('bad');
  const code = await app.run({
    process: processHandle({ release: { build: 'distributed' }, stderr }),
  });
  process.stdout.write(`${JSON.stringify({ chunks, code })}\n`);
} else if (scenario === 'reuse') {
  const app = new Application('reuse')
    .argument('values', { required: true, variadic: true })
    .action(({ args, out }) => out.print(args.values.join(',')));
  await app.run({ process: processHandle({ argv: ['one'] }) });
  await app.run({ process: processHandle({ argv: ['two'] }) });
} else if (scenario === 'time-zone') {
  const app = new Application('zone').action(({ host, out }) => out.print(host.timeZone));
  await app.run({ process: processHandle({ argv: [] }) });
} else if (scenario === 'time-zone-override') {
  const app = new Application('zone').action(({ host, out }) => out.print(host.timeZone));
  await app.run({
    process: processHandle({ argv: [], timeZone: 'Pacific/Auckland' }),
  });
}
