import { Application } from '@loomcli/core';

const app = new Application('draw').action(({ out }) => {
  out.draw('value', {
    render: () => {
      throw new Error('view failed');
    },
  });
});
const code = await app.run({ host: { argv: [], release: { build: 'distributed' } } });
await new Promise((resolve) => setImmediate(resolve));
process.stdout.write(`CODE:${code}\n`);
