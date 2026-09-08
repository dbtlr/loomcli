import { Application } from '@loomcli/core';

Object.defineProperties(process.stdout, {
  columns: { configurable: true, value: 0, writable: true },
  isTTY: { configurable: true, value: true },
  rows: { configurable: true, value: 24, writable: true },
});
Object.defineProperties(process.stderr, {
  columns: { configurable: true, value: 100, writable: true },
  isTTY: { configurable: true, value: true },
  rows: { configurable: true, value: 0, writable: true },
});
await new Application('terminal')
  .action(({ host, out }) => {
    process.stdout.columns = 120;
    process.stderr.rows = 40;
    out.print(JSON.stringify(host.terminal));
  })
  .run({ host: { argv: [] } });
