import { Application, Command, DeclarationError, GlobalOptions } from '@loomcli/core';

const scenario = process.argv[2];
const mode = process.argv[3];

const declared = new GlobalOptions().option('file', { short: 'f', type: 'string' });

/** An options object with no prototype is plain data too, so either slot accepts one. */
const bare = (entries) => Object.assign(Object.create(null), entries);

/** The second argument of each scenario: the options object, and the shapes it is mistaken for. */
const supplied = {
  'array-options': [],
  'empty-globals': new GlobalOptions(),
  'null-prototype': bare({ description: 'Reads one value.', globals: declared }),
  'null-prototype-application': { globals: declared },
  'options-object': { globals: declared },
  'positional-globals': declared,
  'string-options': 'globals',
};

/** The Application's own slot, which one scenario supplies with no prototype either. */
const application = {
  'null-prototype-application': bare({ description: 'Reads one document.', globals: declared }),
};

// Construction never inspects the options slot, so every scenario reaches this line.
// The fault, when there is one, surfaces only at `inspect()` or `run()`, below.
const get = new Command('get', supplied[scenario]).action(({ out }) => out.print('dispatched'));
const app = new Application('fixture', application[scenario] ?? { globals: declared }).command(get);
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
