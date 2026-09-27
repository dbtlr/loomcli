import { Application, Command } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';

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

/**
 * Closed-set values a shell must insert as text, and values completion leaves out: a newline, a
 * tab, the ActiveHelp marker, a lone surrogate, a C1 control, a line separator, and the empty
 * string. `plain` repeats, so the answer shows it once.
 */
const modes = [
  'plain',
  '$(touch sentinel)',
  '`touch sentinel`',
  ';touch sentinel',
  'a\nb',
  'c\td',
  '_activeHelp_ x',
  `${String.fromCharCode(55_296)}e`,
  `f${String.fromCodePoint(155)}`,
  `g${String.fromCodePoint(8232)}`,
  '',
  'plain',
];

const paths = new Command('paths', { description: 'Walk\tall paths.' })
  .option('format', {
    description: 'The view.',
    short: 'f',
    type: 'string',
    validate: shaped({ enum: ['json', 'jsonl', 'table'] }),
  })
  .option('field', { description: 'A field.', multiple: true, type: 'string' })
  .option('quiet', { description: 'Say less.', short: 'q', type: 'boolean' })
  .option('secret', { hidden: true, type: 'boolean' })
  .option('legacy', { deprecated: 'Use --format.', type: 'boolean' })
  .action(() => {});

const keys = new Command('keys', { description: 'List keys.' })
  .alias('ls')
  .argument('mode', { validate: shaped({ enum: modes }) })
  .action(() => {});

const fetch = new Command('fetch', { deprecated: 'Use keys instead.' })
  .option('deep', { type: 'boolean' })
  .action(() => {});
const debug = new Command('debug', { hidden: true })
  .option('dump', { type: 'boolean' })
  .action(() => {});

const cache = new Command('cache', { description: String.fromCodePoint(1) })
  .command(new Command('clear').action(() => {}))
  .command(new Command('list', { description: 'List entries.' }).action(() => {}));

const app = new Application('kit', { plugins: [help(), completion()] })
  .globalOption('file', { description: 'The document.', type: 'string' })
  .globalOption('color', { description: 'Color output.', polarity: 'both', type: 'boolean' })
  .globalOption('old', { deprecated: 'Use --file.', type: 'string' })
  .globalOption('trace', { hidden: true, type: 'boolean' })
  .command(paths)
  .command(keys)
  .command(fetch)
  .command(debug)
  .command(cache);

await app.run({ host: { argv: process.argv.slice(2) } });
