import { Application, nowrap, style } from '@loomcli/core';

const input = JSON.parse(process.argv[2]);
const message = input.message
  .map((part) => {
    if (typeof part === 'string') {
      return part;
    }
    return 'nowrap' in part ? nowrap(part.nowrap) : style.red(part.red);
  })
  .join('');
const tty = input.columns !== null;
const output = { columns: input.columns ?? undefined, isTTY: tty, rows: 24 };
await new Application('lanes', { description: 'Write one lane message.' })
  .action(({ out }) => out[input.lane](message))
  .run({
    host: {
      argv: [],
      env: input.env ?? {},
      platform: 'linux',
      release: { build: 'distributed' },
      terminal: { stderr: output, stdin: { isTTY: false }, stdout: output },
    },
    rendering: input.rendering,
  });
