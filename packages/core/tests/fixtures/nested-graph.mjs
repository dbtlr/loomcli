import { Writable } from 'node:stream';

import { Application, Command } from '@loomcli/core';

import { declare } from './declare.mjs';

const scenario = process.argv[2];

const dispatch = ({ out }) => out.print('dispatched');

function leaf(name) {
  return new Command(name).action(dispatch);
}

function aliased(name, ...aliases) {
  return new Command(name).alias(...aliases).action(dispatch);
}

function build() {
  const app = new Application('nested-graph').globalOption('file', { short: 'f', type: 'string' });
  switch (scenario) {
    case 'group-option': {
      return app
        .command(new Command('cache').option('verbose', { type: 'boolean' }).command(leaf('clear')))
        .action(dispatch);
    }
    case 'root-group-option': {
      return app.option('verbose', { type: 'boolean' }).command(leaf('clear'));
    }
    case 'leaf-actionless': {
      return app.command(new Command('cache').command(new Command('clear'))).action(dispatch);
    }
    case 'nested-foreign-globals': {
      const other = {};
      return app
        .command(
          new Command('cache').command(new Command('clear', { globals: other }).action(dispatch)),
        )
        .action(dispatch);
    }
    case 'duplicate-nested-children': {
      return app
        .command(new Command('cache').command(leaf('clear')).command(leaf('clear')))
        .action(dispatch);
    }
    case 'invalid-nested-child-name': {
      return app.command(new Command('cache').command(leaf('bad name'))).action(dispatch);
    }
    case 'late-nested-child': {
      return app
        .command(new Command('cache').action(dispatch).command(leaf('clear')))
        .action(dispatch);
    }
    case 'nested-shared-option-key': {
      return app
        .command(
          new Command('cache').command(
            new Command('clear').option('file', { type: 'boolean' }).action(dispatch),
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
        .command(new Command('keys').alias('ls').alias('ls').action(dispatch))
        .action(dispatch);
    }
    case 'invalid-alias-name': {
      return app.command(aliased('keys', 'bad name')).action(dispatch);
    }
    case 'empty-alias': {
      return app.command(new Command('keys').alias().action(dispatch)).action(dispatch);
    }
    case 'late-alias': {
      return app.command(new Command('keys').action(dispatch).alias('ls')).action(dispatch);
    }
    case 'nested-alias-sibling-name': {
      return app
        .command(new Command('cache').command(leaf('clear')).command(aliased('list', 'clear')))
        .action(dispatch);
    }
    case 'shared-child': {
      const clear = leaf('clear');
      return app.command(new Command('cache').command(clear)).command(clear).action(dispatch);
    }
    case 'nested-too-deep': {
      // A group attached below a named Command would put its children three levels below the root.
      const cache = new Command('cache').command(leaf('clear'));
      return app.command(new Command('store').command(cache)).action(dispatch);
    }
    default: {
      return app.command(new Command('cache').command(leaf('clear'))).action(dispatch);
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
const app = declare(build);
const code = await app.run({ host: { argv: process.argv.slice(3), stderr } });
process.stdout.write(`${JSON.stringify({ chunks, code })}\n`);
