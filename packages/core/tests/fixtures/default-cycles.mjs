import { Application } from '@loomcli/core';

const mode = process.argv[2];

/** Every value a default's validator received, in order, so a test reads which object it was. */
const received = [];

/** A validator that accepts any value and records it, which is what lets a default hold an object. */
const recording = {
  '~standard': {
    validate: (value) => {
      received.push(value);
      return { value };
    },
    vendor: 'fixture',
    version: 1,
  },
};

/** Which of the first three positions of a list hold an entry, so a test reads its holes. */
const present = (list) => [0, 1, 2].map((index) => Object.hasOwn(list, index));

if (mode === 'cycle') {
  const shape = { name: 'loop' };
  shape.self = shape;
  const list = ['a'];
  list.push(list);
  const app = new Application('cycles')
    .option('shape', { default: shape, type: 'string', validate: recording })
    .argument('list', { default: list, validate: recording })
    .action(() => undefined);
  const graph = app.inspect();
  const copy = graph.root.options[0].default.value;
  const listCopy = graph.root.arguments[0].default.value;
  await app.run({ host: { argv: [] } });
  process.stdout.write(
    `${JSON.stringify({
      list: {
        authors: listCopy === list,
        cycle: listCopy[1] === listCopy,
        frozen: Object.isFrozen(listCopy),
        validated: received[1] === listCopy,
      },
      shape: {
        authors: copy === shape,
        cycle: copy.self === copy,
        frozen: Object.isFrozen(copy),
        validated: received[0] === copy,
      },
    })}\n`,
  );
} else if (mode === 'sparse') {
  // Writing past the end leaves a hole in the middle, which is the value under test.
  const tags = ['a'];
  tags[2] = 'c';
  let action = [];
  const app = new Application('sparse')
    .option('tags', { default: tags, multiple: true, type: 'string' })
    .action(({ options }) => {
      action = present(options.tags);
    });
  await app.run({ host: { argv: [] } });
  const graph = present(app.inspect().root.options[0].default.value);
  process.stdout.write(`${JSON.stringify({ action, graph })}\n`);
} else {
  // Each getter counts its reads, across the declaring call, a run, and an inspection.
  const reads = { default: 0, nested: 0 };
  const app = new Application('once')
    .option('level', {
      get default() {
        reads.default += 1;
        return 'loud';
      },
      type: 'string',
    })
    .option('shape', {
      default: {
        get key() {
          reads.nested += 1;
          return 'value';
        },
      },
      type: 'string',
      validate: recording,
    })
    .action(() => undefined);
  await app.run({ host: { argv: [] } });
  app.inspect();
  process.stdout.write(`${JSON.stringify(reads)}\n`);
}
