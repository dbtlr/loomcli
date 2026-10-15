import { Writable } from 'node:stream';

import { Application, glyph, style } from '@loomcli/core';

let plain = '';
let cells = 0;
const sink = new Writable({
  write(chunk, encoding, done) {
    done();
  },
});
const app = new Application('view', {
  description: 'Resolve view text.',
  rendering: { color: 'always', modifiers: 'always', terminalControls: 'preserve' },
}).action(async ({ out }) => {
  await out.draw(undefined, {
    render: (_data, context) => {
      plain = context.plain(`${style.bold('Name')} ${glyph.pointer}\u001b[2J`);
      cells = context.width(style.escape(plain));
      return '';
    },
  });
  await out.print(JSON.stringify({ cells, plain }));
});
process.exitCode = await app.run({
  host: { argv: [], env: { TERM: 'linux' }, platform: 'linux', stderr: sink },
});
