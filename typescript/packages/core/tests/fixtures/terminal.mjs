import { Application, processHandle } from '@loomcli/core';

Object.defineProperties(process.stdout, {
  columns: { configurable: true, value: 0, writable: true },
  isTTY: { configurable: true, value: true, writable: true },
  rows: { configurable: true, value: 24, writable: true },
});
Object.defineProperties(process.stderr, {
  columns: { configurable: true, value: 100, writable: true },
  isTTY: { configurable: true, value: true, writable: true },
  rows: { configurable: true, value: 0, writable: true },
});
await new Application('terminal')
  .action(({ host, out }) => {
    const before = JSON.stringify(host.terminal);
    // A resize changes the stream's readings; a stream never changes kind mid-run.
    process.stdout.columns = 120;
    process.stderr.columns = 0;
    process.stderr.rows = 40;
    process.stdout.isTTY = false;
    out.print(JSON.stringify({ after: host.terminal, before: JSON.parse(before) }));
  })
  .run({ process: processHandle({ argv: [] }) });
