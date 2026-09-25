import { Application, DeclarationError } from '@loomcli/core';

import { declare } from './declare.mjs';

const scenario = process.argv[2];
const mode = process.argv[3];

const declared = new Application('example').globalOption('file', { short: 'f', type: 'string' });

/** The second argument of each scenario: the options object, and the shapes it is mistaken for. */
const supplied = {
  'application-value': declared,
  'array-options': [],
  'empty-application': new Application('example'),
  'options-object': { description: 'Example application.' },
  'string-options': 'globals',
};

// The constructor checks the options slot, so a faulty one ends the fixture here.
const app = declare(() =>
  new Application('fixture', supplied[scenario]).action(({ out }) => out.print('dispatched')),
);
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
  const code = await app.run({ host: { argv: [] } });
  process.stdout.write(`resolved:${code}\n`);
}
