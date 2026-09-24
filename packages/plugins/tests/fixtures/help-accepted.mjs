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

/** One multiple string option whose schema is the given JSON Schema. */
const many = (json) => ({ multiple: true, type: 'string', validate: shaped(json) });

const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

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
  .option('many-enum', many({ items: { enum: ['x', 'y'], type: 'string' }, type: 'array' }))
  .option(
    'many-counted',
    many({ items: { const: 'x' }, maxItems: 3, minItems: 1, type: 'array', uniqueItems: true }),
  )
  .option(
    'many-annotated',
    many({
      default: [],
      description: 'd',
      items: { anyOf: [{ const: 'x' }, { const: 'y' }] },
      type: 'array',
    }),
  )
  .option(
    'many-prefix',
    many({ items: { enum: ['x'] }, prefixItems: [{ const: 'x' }], type: 'array' }),
  )
  .option(
    'many-contains',
    many({ contains: { const: 'x' }, items: { enum: ['x'] }, type: 'array' }),
  )
  .option('many-items-pattern', many({ items: { enum: ['x'], pattern: 'x' }, type: 'array' }))
  .option('many-items-typed', many({ items: { const: 'x', type: 'string' }, type: 'array' }))
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
    validate: shaped({ items: { enum: ['x', 'y'] }, type: 'array' }),
    variadic: true,
  })
  .action(() => {});

const app = new Application('app', { plugins: [help()] }).command(shapes).command(pick);
await app.run({ host: { argv: process.argv.slice(2) } });
