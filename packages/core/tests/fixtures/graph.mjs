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
        .command(child('get'))
        .action(dispatch);
    }
    case 'duplicate-children': {
      return app.command(child('get')).command(child('get')).action(dispatch);
    }
    case 'invalid-child-name': {
      return app.command(child('bad name')).action(dispatch);
    }
    case 'empty-child-name': {
      return app.command(child('')).action(dispatch);
    }
    case 'hyphen-child-name': {
      return app.command(child('-get')).action(dispatch);
    }
    case 'equals-child-name': {
      return app.command(child('get=value')).action(dispatch);
    }
    case 'empty-argument-name': {
      return app.argument('', { required: true }).action(dispatch);
    }
    case 'hyphen-argument-name': {
      return app.argument('--file', { required: true }).action(dispatch);
    }
    case 'nonstring-argument-name': {
      return app
        .command(new Command('get', globals).argument(1, {}).action(dispatch))
        .action(dispatch);
    }
    case 'foreign-globals': {
      const other = new GlobalOptions().option('file', { type: 'string' });
      return app.command(new Command('get', other).action(dispatch)).action(dispatch);
    }
    case 'foreign-child': {
      return app.command({ name: 'get' }).action(dispatch);
    }
    case 'foreign-globals-value': {
      return new Application('graph', {}).action(dispatch);
    }
    case 'null-globals': {
      // Only an omitted argument means no globals; null is a value, and not a declaration.
      return new Application('graph', null).action(dispatch);
    }
    case 'missing-globals': {
      return app.command(new Command('get').action(dispatch)).action(dispatch);
    }
    case 'shared-option-key': {
      return app
        .command(new Command('get', globals).option('file', { type: 'boolean' }).action(dispatch))
        .action(dispatch);
    }
    case 'shared-short-spelling': {
      return app
        .command(
          new Command('get', globals)
            .option('force', { short: 'f', type: 'boolean' })
            .action(dispatch),
        )
        .action(dispatch);
    }
    case 'shared-negative-spelling': {
      return app
        .command(
          new Command('get', globals).option('no-total', { type: 'string' }).action(dispatch),
        )
        .action(dispatch);
    }
    case 'root-option-collides': {
      return app.option('file', { type: 'boolean' }).command(child('get')).action(dispatch);
    }
    case 'child-actionless': {
      return app.command(new Command('get', globals)).action(dispatch);
    }
    case 'child-multiple-actions': {
      return app.command(child('get').action(dispatch)).action(dispatch);
    }
    case 'child-duplicate-argument': {
      return app
        .command(
          new Command('get', globals)
            .argument('path', { required: true })
            .argument('path', { required: true })
            .action(dispatch),
        )
        .action(dispatch);
    }
    case 'child-variadic-not-last': {
      return app
        .command(
          new Command('get', globals)
            .argument('paths', { required: true, variadic: true })
            .argument('path', { required: true })
            .action(dispatch),
        )
        .action(dispatch);
    }
    case 'child-invalid-default': {
      return app
        .command(
          new Command('get', globals)
            .option('depth', { default: 'deep', type: 'string', validate: digits() })
            .action(dispatch),
        )
        .action(dispatch);
    }
    case 'late-argument': {
      return app
        .command(new Command('get', globals).action(dispatch).argument('path', { required: true }))
        .action(dispatch);
    }
    case 'late-option': {
      return app
        .command(new Command('get', globals).action(dispatch).option('raw', { type: 'boolean' }))
        .action(dispatch);
    }
    case 'late-root-argument': {
      return app.action(dispatch).argument('files', { required: true, variadic: true });
    }
    case 'late-root-option': {
      return app.action(dispatch).option('pretty', { type: 'boolean' });
    }
    case 'late-two-options': {
      return app
        .command(
          new Command('get', globals)
            .action(dispatch)
            .option('raw', { type: 'boolean' })
            .option('deep', { type: 'boolean' }),
        )
        .action(dispatch);
    }
    case 'late-root-child': {
      return app.action(dispatch).command(child('get'));
    }
    // The order fault outranks the argument-and-child rule, which the same graph also breaks.
    case 'late-child-beside-argument': {
      return app
        .argument('files', { required: true, variadic: true })
        .action(dispatch)
        .command(child('get'));
    }
    // A child's identity and name are settled before the order fault is reported.
    case 'late-child-invalid-name': {
      return app.action(dispatch).command(child('-get'));
    }
    case 'late-child-foreign': {
      return app.action(dispatch).command({ name: 'get' });
    }
    default: {
      return app.command(child('get')).command(child('keys')).action(dispatch);
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
