import { Application, Command, DeclarationError, GlobalOptions } from '@loomcli/core';

const scenario = process.argv[2];
const mode = process.argv[3];

const declared = new GlobalOptions().option('file', { short: 'f', type: 'string' });

/** The second argument of each scenario: the options object, and the shapes it is mistaken for. */
const supplied = {
  'array-options': [],
  'empty-globals': new GlobalOptions(),
  'options-object': { globals: declared },
  'positional-globals': declared,
  'string-options': 'globals',
};

// Construction never inspects the options slot, so every scenario reaches this line.
// The fault, when there is one, surfaces only at `inspect()` or `run()`, below.
const get = new Command('get', supplied[scenario]).action(({ out }) => out.print('dispatched'));
const app = new Application('fixture', { globals: declared }).command(get);
process.stdout.write('assembled\n');

if (mode === 'inspect') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'declaration' : 'other';
    process.stdout.write(`${kind}:${error.exitCode}: ${error.message}\n`);
  }
} else {
  const code = await app.run({ host: { argv: ['get'] } });
  process.stdout.write(`resolved:${code}\n`);
}
