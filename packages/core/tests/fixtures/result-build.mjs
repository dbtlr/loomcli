import { Application, Command, DeclarationError } from '@loomcli/core';

const scenario = process.argv[2];
const place = process.argv[3];
const mode = process.argv[4];

const dispatch = ({ out }) => out.print('dispatched');

/** The whole view every value scenario names, which renders the declared value in one call. */
const table = { render: (value) => `${String(value.count)}\n` };

/** The row view a rows declaration names, which core feeds one row at a time. */
const list = { row: (row) => `${row.name}\n` };

/** A value that carries both shapes, which is neither of them. */
const both = { render: () => '', row: () => '' };

/** Each rejected declaration, applied to whichever Command the invocation places it on. */
const scenarios = {
  'after-action': (target) => target.action(dispatch).result({ views: { table } }),
  'bad-name': (target) => target.result({ views: { 'wide table': table } }).action(dispatch),
  'both-shapes': (target) => target.result({ views: { both } }).action(dispatch),
  'empty-record': (target) => target.result({ views: {} }).action(dispatch),
  'integer-name': (target) => target.result({ views: { 0: table } }).action(dispatch),
  'missing-default': (target) =>
    target.result({ views: { table } }).views({}, { default: 'wide' }).action(dispatch),
  'no-action': (target) => target.result({ views: { table } }),
  'not-a-view': (target) => target.result({ views: { table: {} } }).action(dispatch),
  'row-view-on-value': (target) => target.result({ views: { records: list } }).action(dispatch),
  'two-results': (target) =>
    target.result({ views: { table } }).rows({ views: { list } }).action(dispatch),
  'views-no-result': (target) => target.views({ table }).action(dispatch),
};

// The same declaration reads on the unnamed root and on a named Command.
// Each diagnostic names the Command that holds the fault.
const declare = scenarios[scenario];
const app =
  place === 'root'
    ? declare(new Application('fixture'))
    : new Application('fixture').command(declare(new Command('count'))).action(dispatch);
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
