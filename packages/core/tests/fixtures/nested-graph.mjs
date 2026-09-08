import { Writable } from 'node:stream';

import { Application, Command, GlobalOptions } from '@loomcli/core';

const scenario = process.argv[2];
const globals = new GlobalOptions().option('file', { short: 'f', type: 'string' });
const dispatch = ({ out }) => out.print('dispatched');

function leaf(name, declarations = globals) {
  return new Command(name, declarations).action(dispatch);
}

function aliased(name, ...aliases) {
  return new Command(name, globals).alias(...aliases).action(dispatch);
}

function build() {
  const app = new Application('nested-graph', { globals });
  switch (scenario) {
    case 'group-option': {
      return app
        .command(
          new Command('cache', globals)
            .option('verbose', { type: 'boolean' })
            .command(leaf('clear')),
        )
        .action(dispatch);
    }
    case 'root-group-option': {
      return app.option('verbose', { type: 'boolean' }).command(leaf('clear'));
    }
    case 'leaf-actionless': {
      return app
        .command(new Command('cache', globals).command(new Command('clear', globals)))
        .action(dispatch);
    }
    case 'nested-foreign-globals': {
      const other = new GlobalOptions().option('file', { type: 'string' });
      return app
        .command(new Command('cache', globals).command(leaf('clear', other)))
        .action(dispatch);
    }
    case 'nested-missing-globals': {
      return app
        .command(new Command('cache', globals).command(new Command('clear').action(dispatch)))
        .action(dispatch);
    }
    case 'duplicate-nested-children': {
      return app
        .command(new Command('cache', globals).command(leaf('clear')).command(leaf('clear')))
        .action(dispatch);
    }
    case 'invalid-nested-child-name': {
      return app.command(new Command('cache', globals).command(leaf('bad name'))).action(dispatch);
    }
    case 'late-nested-child': {
      return app
        .command(new Command('cache', globals).action(dispatch).command(leaf('clear')))
        .action(dispatch);
    }
    case 'nested-shared-option-key': {
      return app
        .command(
          new Command('cache', globals).command(
            new Command('clear', globals).option('file', { type: 'boolean' }).action(dispatch),
          ),
        )
        .action(dispatch);
    }
    case 'alias-sibling-name': {
      return app.command(leaf('get')).command(aliased('keys', 'get')).action(dispatch);
    }
    case 'alias-before-sibling-name': {
      // The alias is declared before the child whose name it repeats, so the rule reads both ways.
      return app.command(aliased('keys', 'get')).command(leaf('get')).action(dispatch);
    }
    case 'alias-sibling-alias': {
      return app.command(aliased('select', 'ls')).command(aliased('keys', 'ls')).action(dispatch);
    }
    case 'alias-own-name': {
      return app.command(aliased('keys', 'keys')).action(dispatch);
    }
    case 'repeated-alias': {
      return app
        .command(new Command('keys', globals).alias('ls').alias('ls').action(dispatch))
        .action(dispatch);
    }
    case 'invalid-alias-name': {
      return app.command(aliased('keys', 'bad name')).action(dispatch);
    }
    case 'empty-alias': {
      return app.command(new Command('keys', globals).alias().action(dispatch)).action(dispatch);
    }
    case 'late-alias': {
      return app
        .command(new Command('keys', globals).action(dispatch).alias('ls'))
        .action(dispatch);
    }
    case 'nested-alias-sibling-name': {
      return app
        .command(
          new Command('cache', globals).command(leaf('clear')).command(aliased('list', 'clear')),
        )
        .action(dispatch);
    }
    case 'shared-child': {
      const clear = leaf('clear');
      return app
        .command(new Command('cache', globals).command(clear))
        .command(clear)
        .action(dispatch);
    }
    case 'shared-child-same-parent-name': {
      // Two distinct parents named "cache" at different depths attach one "clear" value.
      const clear = leaf('clear');
      return app
        .command(new Command('cache', globals).command(clear))
        .command(
          new Command('other', globals).command(new Command('cache', globals).command(clear)),
        )
        .action(dispatch);
    }
    default: {
      return app.command(new Command('cache', globals).command(leaf('clear'))).action(dispatch);
    }
  }
}

const chunks = [];
const stderr = new Writable({
  write(chunk, _encoding, callback) {
    chunks.push(chunk.toString());
    callback();
  },
});
const code = await build().run({ host: { argv: process.argv.slice(3), stderr } });
process.stdout.write(`${JSON.stringify({ chunks, code })}\n`);
