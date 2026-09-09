import {
  Application,
  Command,
  GlobalOptions,
  validationContext,
  validationContextKey,
} from '@loomcli/core';
import { z } from 'zod';

const [scenario, ...argv] = process.argv.slice(2);
const records = [];
let last = undefined;

// A declared `undefined` and a missing key both vanish from JSON, so the marker keeps them apart.
const encode = (value) =>
  JSON.stringify(value, (_key, item) => (item === undefined ? '#undefined' : item));

/** The whole Host cannot be serialized, so the echo keeps the two facts a test can check. */
const reduce = (context) =>
  context === undefined
    ? null
    : {
        ...context,
        host: { argv: context.host.argv, cwd: context.host.cwd },
        suppliedKey: Object.hasOwn(context, 'supplied'),
      };

const echo = (label) => ({
  '~standard': {
    validate: (value, options) => {
      const context = validationContext(options);
      last = context;
      records.push({ context: reduce(context), label, value });
      return { value };
    },
    vendor: 'fixture',
    version: 1,
  },
});

const print = ({ host, out }) => out.print(encode({ records, sameHost: last?.host === host }));

let app = undefined;
switch (scenario) {
  case 'root': {
    const globals = new GlobalOptions().option('mode', {
      type: 'string',
      validate: echo('mode'),
    });
    app = new Application('context', { globals })
      .argument('name', { required: true, validate: echo('name') })
      .argument('files', { validate: echo('files'), variadic: true })
      .option('single', { type: 'string', validate: echo('single') })
      .option('multi', { multiple: true, type: 'string', validate: echo('multi') })
      .option('absent', { type: 'string' })
      .option('pending', { multiple: true, type: 'string' })
      .option('flag', { type: 'boolean' })
      .option('color', { polarity: 'both', type: 'boolean' })
      .option('quiet', { type: 'boolean' })
      .action(print);
    break;
  }
  case 'nested': {
    const globals = new GlobalOptions().option('mode', { type: 'string', validate: echo('mode') });
    const clear = new Command('clear', { globals })
      .alias('cl')
      .option('force', { type: 'string', validate: echo('force') })
      .action(print);
    const cache = new Command('cache', { globals }).alias('c').command(clear);
    app = new Application('context', { globals }).command(cache).action(print);
    break;
  }
  case 'default': {
    app = new Application('context')
      .option('depth', { default: '1', type: 'string', validate: echo('depth') })
      .option('size', { type: 'string', validate: echo('size') })
      .action(print);
    break;
  }
  case 'direct': {
    const plain = echo('direct');
    plain['~standard'].validate('value');
    const foreign = validationContext({
      libraryOptions: { [validationContextKey]: { phase: 'invocation' } },
    });
    process.stdout.write(
      `${encode({ foreign: foreign ?? null, none: validationContext(undefined) ?? null, records })}\n`,
    );
    break;
  }
  case 'snapshot': {
    const seen = [];
    /** Writes to every array the context hands it, so only a copy keeps the invocation intact. */
    const writer = {
      '~standard': {
        validate: (value, options) => {
          const context = validationContext(options);
          context.command.push('written');
          context.passthrough.push('written');
          context.supplied.args.files.push('written');
          context.supplied.options.multi.push('written');
          return { value };
        },
        vendor: 'fixture',
        version: 1,
      },
    };
    /** The next schema call of the same invocation, where a surviving write would show. */
    const reader = {
      '~standard': {
        validate: (value, options) => {
          const context = validationContext(options);
          seen.push({
            command: context.command,
            files: context.supplied.args.files,
            multi: context.supplied.options.multi,
            passthrough: context.passthrough,
            value,
          });
          return { value };
        },
        vendor: 'fixture',
        version: 1,
      },
    };
    app = new Application('context')
      .argument('files', { validate: writer, variadic: true })
      .option('multi', { multiple: true, type: 'string', validate: reader })
      .action(({ args, options, passthrough, out }) =>
        out.print(encode({ args, options, passthrough, seen })),
      );
    break;
  }
  case 'zod': {
    app = new Application('context')
      .option('size', {
        type: 'string',
        validate: z.string().regex(/^\d+$/u, 'Use decimal digits.').transform(Number),
      })
      .action(({ options, out }) => out.print(encode({ size: options.size })));
    break;
  }
  default: {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
}
if (app) {
  await app.run({ host: { argv, cwd: '/loom/context' } });
}
