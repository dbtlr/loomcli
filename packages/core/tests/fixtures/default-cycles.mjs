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

if (mode === 'shared') {
  // A proxy whose prototype reads plain once and as a Map after, held at two places in one default.
  let reads = 0;
  const shape = new Proxy(
    { key: 'value' },
    {
      getPrototypeOf() {
        reads += 1;
        return reads === 1 ? Object.prototype : Map.prototype;
      },
    },
  );
  const app = new Application('shared')
    .option('shape', { default: [shape, shape], type: 'string', validate: recording })
    .action(() => undefined);
  const [first, second] = app.inspect().root.options[0].default.value;
  process.stdout.write(
    `${JSON.stringify({ copied: first !== shape && second !== shape, frozen: Object.isFrozen(second), same: first === second })}\n`,
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
