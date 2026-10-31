import { Application, Command, validationContext } from '@loomcli/core';
import { z } from 'zod';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    // A source run is a development build, so an author's fault prints its Developer Diagnostic.
    const development = { description: 'Probe the inputs.' };

    const [scenario, ...argv] = words;

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
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
            multiple: true,
            short: 'F',
            type: 'string',
          })
          .option('total', { description: 'The total option.', short: 't', type: 'boolean' })
          .action(report);
        break;
      }
      case 'default': {
        app = new Application('multiple', development)
          .option('field', {
            default: ['a', 'b'],
            description: 'The field option.',
            multiple: true,
            type: 'string',
            validate: z.string().transform((value) => value.toUpperCase()),
          })
          .action(report);
        break;
      }
      case 'invalid-default': {
        app = new Application('multiple', development)
          .option('field', {
            default: ['a', ''],
            description: 'The field option.',
            multiple: true,
            type: 'string',
            validate: fieldName,
          })
          .action(report);
        break;
      }
      case 'raw-default': {
        app = new Application('multiple', development)
          .option('field', {
            default: ['a'],
            description: 'The field option.',
            multiple: true,
            type: 'string',
          })
          .action(report);
        break;
      }
      case 'schema': {
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
            multiple: true,
            short: 'F',
            type: 'string',
            validate: counting(fieldName),
          })
          .action(({ options, out }) => out.print(JSON.stringify({ calls, options })));
        break;
      }
      case 'counted': {
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
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
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
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
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
            multiple: true,
            required: true,
            type: 'string',
            validate: fieldName,
          })
          .action(report);
        break;
      }
      case 'abort-mid-list': {
        // The first value cancels the run, so no later value reaches the validator.
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
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
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
            multiple: true,
            type: 'string',
            validate: {
              '~standard': {
                validate: (value, options) => {
                  const context = validationContext(options);
                  seen.push({
                    command: [...context.command],
                    field: [...context.supplied.options.field],
                    kept: context.supplied === context.supplied,
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
        app = new Application('multiple', development)
          .option('field', {
            description: 'The field option.',
            multiple: true,
            required: true,
            short: 'F',
            type: 'string',
          })
          .action(report);
        break;
      }
      case 'global': {
        const show = new Command('show', { description: 'The show command.' })
          .option('local', { description: 'The local option.', type: 'boolean' })
          .action(report);
        app = new Application('multiple', development)
          .globalOption('field', {
            description: 'The field option.',
            multiple: true,
            short: 'F',
            type: 'string',
          })
          .command(show)
          .action(report);
        break;
      }
      default: {
        throw new Error(`Unknown scenario: ${scenario}`);
      }
    }
    const code = await app.run({ process: createProcess({ argv }), signal: controller.signal });
    if (scenario === 'abort-mid-list') {
      writeStdout(`calls:${calls}:code:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const report = ({ options, passthrough, out }) =>
  out.print(JSON.stringify({ options, passthrough }));

export { runFixture as run };
