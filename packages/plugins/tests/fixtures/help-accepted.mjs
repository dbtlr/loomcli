import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpArgument, helpInput } from '@loomcli/plugins/help/extension';

/** A validator that accepts any value and publishes exactly the given input-side JSON Schema. */
function shaped(json) {
  return {
    '~standard': {
      jsonSchema: { input: () => json, output: () => ({}) },
      validate: (value) => ({ value }),
      vendor: 'fixture',
      version: 1,
    },
  };
}

/** One string option whose schema is the given JSON Schema. */
const one = (json, more = {}) => ({ type: 'string', validate: shaped(json), ...more });

/** One multiple string option whose validator publishes the given JSON Schema for each value. */
const many = (json) => ({ multiple: true, type: 'string', validate: shaped(json) });

const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

/** An array of the given length with a hole wherever `entries` names no index. */
function sparse(length, entries) {
  const list = [];
  list.length = length;
  return Object.assign(list, entries);
}

/** Each option exercises one rule of accepted values; its name says which. */
const shapes = new Command('shapes', { description: 'Every derivation rule.' })
  .option('enum-typed', one({ enum: ['a', 'b'], type: 'string' }))
  .option('enum-annotated', one({ default: 'a', enum: ['a', 'b'] }))
  .option('enum-pattern', one({ enum: ['a', 'b'], pattern: '^a', type: 'string' }))
  .option('const-typed', one({ const: 'only', type: 'string' }))
  .option('const-annotated', one({ const: 'only', description: 'x' }))
  .option('const-min-length', one({ const: 'only', minLength: 2 }))
  .option(
    'any-consts',
    one({
      anyOf: [
        { const: 'a', type: 'string' },
        { const: 'b', type: 'string' },
      ],
    }),
  )
  .option('any-mixed', one({ anyOf: [{ enum: ['a', 'b'] }, { const: 'b' }, { const: 'c' }] }))
  .option('any-annotated', one({ anyOf: [{ const: 'a', default: 'a' }, { const: 'b' }] }))
  .option('any-pattern', one({ anyOf: [{ const: 'a', pattern: 'x' }, { const: 'b' }] }))
  .option('any-typed', one({ anyOf: [{ const: 'a' }, { const: 'b' }], type: 'string' }))
  .option('any-nested', one({ anyOf: [{ anyOf: [{ const: 'a' }] }] }))
  .option('beside-const', one({ const: 'a', enum: ['a'] }))
  .option('beside-any', one({ anyOf: [{ const: 'a' }], enum: ['a'] }))
  .option('repeated', one({ enum: ['a', 'a', 'b'] }))
  .option('empty', one({ enum: [] }))
  .option('nullable', one({ anyOf: [{ enum: ['a'] }, { type: 'null' }] }))
  .option('eight', one({ enum: nine.slice(0, 8) }))
  .option('nine', one({ enum: nine }))
  .option('number', one({ enum: ['a', 1] }))
  .option('pattern-only', one({ pattern: '^x', type: 'string' }))
  .option('quoted', one({ enum: ['', 'a b', 'c,d', 'e"f', 'g\u2028h', 'plain'] }))
  .option('marked', one({ enum: ['m\uE000n'] }))
  .option('described', one({ enum: ['a', 'b'] }, { description: 'Pick one.' }))
  .option('faceted', one({ enum: ['a', 'b'] }, { default: 'a', description: 'Pick one.' }))
  .option('many-enum', many({ enum: ['x', 'y'], type: 'string' }))
  .option('many-annotated', many({ anyOf: [{ const: 'x' }, { const: 'y' }], description: 'd' }))
  .option('many-pattern', many({ enum: ['x'], pattern: 'x' }))
  .option('many-array', many({ items: { enum: ['x'] }, type: 'array' }))
  .option(
    'authored-over-enum',
    one({ enum: ['a'] }, { extensions: [helpInput({ accepts: 'Custom words.' })] }),
  )
  .option('authored-open', {
    extensions: [helpInput({ accepts: 'Anything at all.' })],
    type: 'string',
  })
  .option(
    'authored-pattern',
    one({ pattern: '^x', type: 'string' }, { extensions: [helpInput({ accepts: 'An x.' })] }),
  )
  .option('flag', { extensions: [helpInput({ accepts: 'Never shown.' })], type: 'boolean' })
  .option(
    'all-annotations',
    one({
      $comment: 'c',
      $id: 'i',
      $schema: 's',
      default: 'a',
      deprecated: false,
      description: 'd',
      enum: ['a'],
      examples: ['a'],
      readOnly: true,
      title: 't',
      writeOnly: false,
    }),
  )
  .option('number-typed', one({ enum: ['a'], type: 'number' }))
  .option('number-const', one({ const: 1 }))
  .option('any-top-annotated', one({ anyOf: [{ const: 'a' }], description: 'd' }))
  .option('any-top-pattern', one({ anyOf: [{ const: 'a' }], pattern: 'x' }))
  .option('any-enum-typed', one({ anyOf: [{ enum: ['a'], type: 'string' }, { const: 'b' }] }))
  .option('any-enum-annotated', one({ anyOf: [{ enum: ['a'], title: 't' }] }))
  .option('any-enum-narrow', one({ anyOf: [{ enum: ['a'], minLength: 1 }] }))
  .option('repeated-late', one({ enum: ['b', 'a', 'b'] }))
  .option('nine-repeating', one({ enum: [...nine.slice(0, 8), 'a'] }))
  .option('scalar-array', one({ items: { enum: ['x'] }, type: 'array' }))
  .option('sparse-enum', one({ enum: sparse(3, { 0: 'a', 2: 'b' }) }))
  .option('sparse-any', one({ anyOf: sparse(2, { 1: { const: 'a' } }) }))
  .option('quoted-controls', one({ enum: ['b\bc', 'd\u007fe', 'f\u009bg'] }))
  .option('quoted-more', one({ enum: ['i\u0085j', 'k\tl', 'm\u00a0n'] }))
  .action(() => {});

/** Arguments derive from their schema too, and carry an authored sentence through helpArgument. */
const pick = new Command('pick', { description: 'Pick items.' })
  .argument('mode', {
    description: 'The mode.',
    required: true,
    validate: shaped({ enum: ['fast', 'slow'], type: 'string' }),
  })
  .argument('size', {
    extensions: [helpArgument({ accepts: 'A whole number.' })],
    required: true,
    validate: shaped({ pattern: '^[0-9]+$', type: 'string' }),
  })
  .argument('names', {
    validate: shaped({ enum: ['x', 'y'] }),
    variadic: true,
  })
  .action(() => {});

/** One Command per variadic case, since a Command holds one variadic argument. */
const variadic = (name, json) =>
  new Command(name).argument('values', { validate: shaped(json), variadic: true }).action(() => {});

const variadics = [
  variadic('v-const', { const: 'x' }),
  variadic('v-any', { anyOf: [{ const: 'x' }, { enum: ['y'] }] }),
  variadic('v-typed', { enum: ['x'], type: 'string' }),
  variadic('v-annotated', { description: 'd', enum: ['x'] }),
  variadic('v-narrow', { enum: ['x'], pattern: 'x' }),
  variadic('v-array', { items: { enum: ['x'] }, type: 'array' }),
];

const app = variadics.reduce(
  (built, command) => built.command(command),
  new Application('app', { plugins: [help()] }).command(shapes).command(pick),
);
await app.run({ host: { argv: process.argv.slice(2) } });
