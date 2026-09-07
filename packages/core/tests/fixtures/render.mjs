import { Application } from '@loom/core';

const scenario = process.argv[2];

const rows = [
  { count: 6, source: 'one.txt' },
  { count: 2, source: 'two words.txt' },
];

// The renderer owns every byte, so these two differ only in the newlines they return.
const table = { render: (data) => data.map((row) => `${row.count}  ${row.source}\n`).join('') };
const bare = { render: (data) => data.map((row) => row.source).join(' ') };
const breaks = {
  render: () => {
    throw new Error('Cannot render the table.');
  },
};
const counted = { render: (data) => data.length };

const app = new Application('render').action(async ({ out }) => {
  switch (scenario) {
    case 'bytes': {
      await out.render(rows, table);
      break;
    }
    case 'exact': {
      await out.render(rows, bare);
      break;
    }
    case 'order': {
      out.print('before');
      out.render(rows, table);
      out.print('after');
      break;
    }
    case 'unawaited': {
      out.render(rows, breaks);
      out.print('after');
      break;
    }
    case 'caught': {
      try {
        await out.render(rows, breaks);
        out.print('unreachable');
      } catch (error) {
        out.print(`caught:${error.message}`);
      }
      out.print('after');
      break;
    }
    case 'non-string': {
      try {
        await out.render(rows, counted);
      } catch (error) {
        out.print(`caught:${error.message}`);
      }
      break;
    }
    case 'twice': {
      out.render(rows, breaks);
      out.render(rows, counted);
      out.print('after');
      break;
    }
    case 'action-failure': {
      out.render(rows, breaks);
      throw new Error('The action failed.');
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
});

const code = await app.run({ host: { argv: [] } });
process.stdout.write(`resolved:${code}\n`);
