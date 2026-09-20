import { Application, Command, plugin } from '@loomcli/core';
import { z } from 'zod';

/** Every action stays silent, so a mode's one JSON line is the whole of stdout. */
const dispatch = () => undefined;

// A declared `undefined` and a missing key both vanish from JSON, so the marker keeps them apart.
const encode = (value) =>
  JSON.stringify(value, (_key, item) => (item === undefined ? '#undefined' : item));

/** A hand-written Standard Schema that declares no converter, so it publishes no shape. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/** The same validator with a converter, which records every call and answers with `answer`. */
function converting(answer) {
  const calls = [];
  const answers = [];
  const schema = {
    '~standard': {
      jsonSchema: {
        input: (options) => {
          calls.push(options);
          const value = answer(options);
          answers.push(value);
          return value;
        },
        output: () => {
          throw new Error('The output side is never asked.');
        },
      },
      validate: digits['~standard'].validate,
      vendor: 'fixture',
      version: 1,
    },
  };
  return { answers, calls, schema };
}

/** A converter that throws, the way zod does for a shape JSON Schema cannot carry. */
const throwing = converting(() => {
  throw new Error('Transforms cannot be represented in JSON Schema.');
});

/** A converter that returns something other than a plain object. */
const nonObject = converting(() => 'string');

/** A converter that returns an object that is not plain: an array. */
const listing = converting(() => [1, 2]);

/** A validator whose converter throws on being reached, before any call. */
const lazy = {
  '~standard': {
    get jsonSchema() {
      throw new Error('The converter is built on first use and cannot be.');
    },
    validate: digits['~standard'].validate,
    vendor: 'fixture',
    version: 1,
  },
};

/** A converter that answers a nested document, so the copy and the freeze reach every depth. */
const nested = converting((options) => ({
  items: { pattern: '^[0-9]+$', type: 'string' },
  target: options.target,
  type: 'array',
}));

const enumeration = z.enum(['bytes', 'words', 'lines']);
const threshold = z
  .string()
  .regex(/^[0-9]+$/)
  .transform(Number)
  .refine((value) => value >= 0);

// One zod validator per shape the contract names beside an unvalidated argument and a Boolean.
// The shapes are an enum, a pattern behind a transform, a coerced integer, and a whole-tail array.
function zod() {
  const count = new Command('count')
    .argument('files', { validate: z.array(z.string()), variadic: true })
    .option('metric', { default: 'bytes', type: 'string', validate: enumeration })
    .option('min-bytes', { default: '0', type: 'string', validate: threshold })
    .option('timing', { hidden: true, type: 'boolean' })
    .action(dispatch);
  const get = new Command('get').argument('path', { required: true }).action(dispatch);
  return new Application('zod')
    .globalOption('limit', { type: 'string', validate: z.coerce.number().int().min(1) })
    .command(count)
    .command(get);
}

// A hand-written schema with no converter publishes nothing, whatever else it declares.
function plain() {
  return new Application('plain')
    .option('size', { type: 'string', validate: digits })
    .argument('path', { validate: digits, validateOmitted: true })
    .action(dispatch);
}

// Two inputs share one converter, and its answer is nested, so each node gets its own frozen copy.
function shared() {
  return new Application('shared')
    .option('first', { type: 'string', validate: nested.schema })
    .option('second', { type: 'string', validate: nested.schema })
    .action(dispatch);
}

function failing() {
  return new Application('failing')
    .option('minimum', { type: 'string', validate: throwing.schema })
    .option('list', { type: 'string', validate: listing.schema })
    .option('lazy', { type: 'string', validate: lazy })
    .argument('files', { validate: nonObject.schema, variadic: true })
    .action(dispatch);
}

/** A middleware prints the schema it reads on the routed Command's first option. */
function observed() {
  const observing = async ({ command, next, out }) => {
    await out.print(encode(command.options[0].schema));
    await next();
  };
  const observer = plugin('@fixture/observer', {
    middleware: { activate: 'always', load: () => ({ default: observing }) },
  });
  return new Application('observed', { plugins: [observer] })
    .option('metric', { type: 'string', validate: enumeration })
    .option('count', { type: 'string', validate: nested.schema })
    .action(dispatch);
}

const graphs = { failing, observed, plain, shared, zod };
const build = graphs[process.argv[2]];
const mode = process.argv[3];

if (mode === 'run') {
  const code = await build().run({ host: { argv: process.argv.slice(4) } });
  process.stdout.write(`${encode({ code })}\n`);
} else if (mode === 'calls') {
  // One converter call per input on inspect(), and none on a run with no middleware.
  const before = nested.calls.length;
  build().inspect();
  const inspected = nested.calls.length - before;
  const code = await build().run({ host: { argv: [] } });
  const ran = nested.calls.length - before - inspected;
  process.stdout.write(`${encode({ code, inspected, options: nested.calls[0], ran })}\n`);
} else if (mode === 'copies') {
  const graph = build().inspect();
  const [first, second] = graph.root.options;
  let rejected = false;
  try {
    first.schema.items.type = 'number';
  } catch (error) {
    rejected = error instanceof TypeError;
  }
  process.stdout.write(
    `${encode({
      distinct: first.schema !== second.schema,
      equal: JSON.stringify(first.schema) === JSON.stringify(second.schema),
      libraryFrozen: nested.answers.some((answer) => Object.isFrozen(answer)),
      nestedFrozen: Object.isFrozen(first.schema.items),
      rejected,
    })}\n`,
  );
} else {
  process.stdout.write(`${encode(build().inspect())}\n`);
}
