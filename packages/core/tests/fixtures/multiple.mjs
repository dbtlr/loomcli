import { Application, Command, validationContext } from '@loomcli/core';
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
/** The run's own controller, so a scenario cancels from inside a validator. */
const controller = new AbortController();
/** What each per-value call saw on entry, in call order. */
const seen = [];
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
        validate: z.string().transform((value) => value.toUpperCase()),
      })
      .action(report);
    break;
  }
  case 'invalid-default': {
    app = new Application('multiple')
      .option('field', { default: ['a', ''], multiple: true, type: 'string', validate: fieldName })
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
        validate: counting(fieldName),
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
  case 'pathed': {
    app = new Application('multiple')
      .option('field', {
        multiple: true,
        type: 'string',
        validate: {
          '~standard': {
            validate: (value) =>
              value === 'a'
                ? { value }
                : { issues: [{ message: 'Unknown name.', path: ['name'] }] },
            vendor: 'fixture',
            version: 1,
          },
        },
      })
      .action(report);
    break;
  }
  case 'required-schema': {
    app = new Application('multiple')
      .option('field', { multiple: true, required: true, type: 'string', validate: fieldName })
      .action(report);
    break;
  }
  case 'abort-mid-list': {
    // The first value cancels the run, so no later value reaches the validator.
    app = new Application('multiple')
      .option('field', {
        multiple: true,
        type: 'string',
        validate: counting({
          '~standard': {
            validate: (value) => {
              controller.abort();
              return { value };
            },
            vendor: 'fixture',
            version: 1,
          },
        }),
      })
      .action(report);
    break;
  }
  case 'per-value-context': {
    // Each call records what it saw, then writes to every array the context handed it.
    app = new Application('multiple')
      .option('field', {
        multiple: true,
        type: 'string',
        validate: {
          '~standard': {
            validate: (value, options) => {
              const context = validationContext(options);
              seen.push({
                command: [...context.command],
                field: [...context.supplied.options.field],
              });
              context.command.push('written');
              context.supplied.options.field.push('written');
              return { value };
            },
            vendor: 'fixture',
            version: 1,
          },
        },
      })
      .action(({ out }) => out.print(JSON.stringify(seen)));
    break;
  }
  case 'required': {
    app = new Application('multiple')
      .option('field', { multiple: true, required: true, short: 'F', type: 'string' })
      .action(report);
    break;
  }
  case 'global': {
    const show = new Command('show').option('local', { type: 'boolean' }).action(report);
    app = new Application('multiple')
      .globalOption('field', {
        multiple: true,
        short: 'F',
        type: 'string',
      })
      .command(show)
      .action(report);
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
  case 'validated-string-default': {
    app = new Application('multiple')
      .option('field', { default: 'a', multiple: true, type: 'string', validate: fieldName })
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
const code = await app.run({ host: { argv }, signal: controller.signal });
if (scenario === 'abort-mid-list') {
  process.stdout.write(`calls:${calls}:code:${code}\n`);
}
