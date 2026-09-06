import { Writable } from 'node:stream';

import { Application, Command, GlobalOptions } from '@loom/core';

const scenario = process.argv[2];
const globals = new GlobalOptions()
  .option('file', { short: 'f', type: 'string' })
  .option('total', { polarity: 'both', type: 'boolean' });
const dispatch = ({ out }) => out.print('dispatched');

function child(name) {
  return new Command(name, globals).action(dispatch);
}

function build() {
  const app = new Application('graph', globals);
  switch (scenario) {
    case 'arguments-and-children': {
      return app
        .argument('files', { required: true, variadic: true })
        .action(dispatch)
        .command(child('get'));
    }
    case 'duplicate-children': {
      return app.action(dispatch).command(child('get')).command(child('get'));
    }
    case 'invalid-child-name': {
      return app.action(dispatch).command(child('bad name'));
    }
    case 'empty-child-name': {
      return app.action(dispatch).command(child(''));
    }
    case 'hyphen-child-name': {
      return app.action(dispatch).command(child('-get'));
    }
    case 'equals-child-name': {
      return app.action(dispatch).command(child('get=value'));
    }
    case 'foreign-globals': {
      const other = new GlobalOptions().option('file', { type: 'string' });
      return app.action(dispatch).command(new Command('get', other).action(dispatch));
    }
    case 'missing-globals': {
      return app.action(dispatch).command(new Command('get').action(dispatch));
    }
    case 'shared-option-key': {
      return app
        .action(dispatch)
        .command(new Command('get', globals).option('file', { type: 'boolean' }).action(dispatch));
    }
    case 'shared-short-spelling': {
      return app
        .action(dispatch)
        .command(
          new Command('get', globals)
            .option('force', { short: 'f', type: 'boolean' })
            .action(dispatch),
        );
    }
    case 'shared-negative-spelling': {
      return app
        .action(dispatch)
        .command(
          new Command('get', globals).option('no-total', { type: 'string' }).action(dispatch),
        );
    }
    case 'root-option-collides': {
      return app.option('file', { type: 'boolean' }).action(dispatch).command(child('get'));
    }
    case 'child-actionless': {
      return app.action(dispatch).command(new Command('get', globals));
    }
    case 'child-multiple-actions': {
      return app.action(dispatch).command(child('get').action(dispatch));
    }
    case 'child-duplicate-argument': {
      return app
        .action(dispatch)
        .command(
          new Command('get', globals)
            .argument('path', { required: true })
            .argument('path', { required: true })
            .action(dispatch),
        );
    }
    case 'child-variadic-not-last': {
      return app
        .action(dispatch)
        .command(
          new Command('get', globals)
            .argument('paths', { required: true, variadic: true })
            .argument('path', { required: true })
            .action(dispatch),
        );
    }
    case 'child-invalid-default': {
      return app
        .action(dispatch)
        .command(
          new Command('get', globals)
            .option('depth', { default: 'deep', type: 'string', validate: digits() })
            .action(dispatch),
        );
    }
    default: {
      return app.action(dispatch).command(child('get')).command(child('keys'));
    }
  }
}

function digits() {
  return {
    '~standard': {
      validate: (value) =>
        /^\d+$/.test(value)
          ? { value: Number(value) }
          : { issues: [{ message: 'Use decimal digits.' }] },
      vendor: 'fixture',
      version: 1,
    },
  };
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
