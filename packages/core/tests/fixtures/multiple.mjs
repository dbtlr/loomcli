import { Application, Command, GlobalOptions } from '@loom/core';
import { z } from 'zod';

const [scenario, ...argv] = process.argv.slice(2);
const report = ({ options, passthrough, out }) =>
  out.print(JSON.stringify({ options, passthrough }));
let calls = 0;
const counting = (inner) => ({
  '~standard': {
    validate: (value) => {
      calls += 1;
      return inner['~standard'].validate(value);
    },
    vendor: 'fixture',
    version: 1,
  },
});

const fieldName = z.string().min(1, 'Supply a field name.');
let app = undefined;
switch (scenario) {
  case 'plain': {
    app = new Application('multiple')
      .option('field', { multiple: true, short: 'F', type: 'string' })
      .option('total', { short: 't', type: 'boolean' })
      .action(report);
    break;
  }
  case 'default': {
    app = new Application('multiple')
      .option('field', {
        default: ['a', 'b'],
        multiple: true,
        type: 'string',
        validate: z.array(z.string()).transform((values) => values.join(':')),
      })
      .action(report);
    break;
  }
  case 'raw-default': {
    app = new Application('multiple')
      .option('field', { default: ['a'], multiple: true, type: 'string' })
      .action(report);
    break;
  }
  case 'schema': {
    app = new Application('multiple')
      .option('field', {
        multiple: true,
        short: 'F',
        type: 'string',
        validate: counting(z.array(fieldName)),
      })
      .action(({ options, out }) => out.print(JSON.stringify({ calls, options })));
    break;
  }
  case 'counted': {
    app = new Application('multiple')
      .option('field', {
        multiple: true,
        type: 'string',
        validate: {
          '~standard': {
            validate: (value) => ({ value: value.length }),
            vendor: 'fixture',
            version: 1,
          },
        },
      })
      .action(report);
    break;
  }
  case 'nonempty': {
    app = new Application('multiple')
      .option('field', {
        multiple: true,
        type: 'string',
        validate: z.array(z.string()).min(1, 'Supply at least one field.'),
      })
      .action(report);
    break;
  }
  case 'nonempty-required': {
    app = new Application('multiple')
      .option('field', {
        multiple: true,
        required: true,
        type: 'string',
        validate: z.array(z.string()).min(1, 'Supply at least one field.'),
      })
      .action(report);
    break;
  }
  case 'required': {
    app = new Application('multiple')
      .option('field', { multiple: true, required: true, short: 'F', type: 'string' })
      .action(report);
    break;
  }
  case 'global': {
    const globals = new GlobalOptions().option('field', {
      multiple: true,
      short: 'F',
      type: 'string',
    });
    const show = new Command('show', globals).option('local', { type: 'boolean' }).action(report);
    app = new Application('multiple', { globals }).command(show).action(report);
    break;
  }
  case 'boolean-multiple': {
    app = new Application('multiple')
      .option('verbose', { multiple: true, type: 'boolean' })
      .action(report);
    break;
  }
  case 'nonboolean-multiple': {
    app = new Application('multiple')
      .option('field', { multiple: 'yes', type: 'string' })
      .action(report);
    break;
  }
  case 'string-default': {
    app = new Application('multiple')
      .option('field', { default: 'a', multiple: true, type: 'string' })
      .action(report);
    break;
  }
  default: {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
}
await app.run({ host: { argv } });
