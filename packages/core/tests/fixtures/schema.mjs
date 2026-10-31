import { Application } from '@loomcli/core';
import { z } from 'zod';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    // A source run is a development build, so an author's fault prints its Developer Diagnostic.
    const development = { description: 'Validate options.' };

    const [scenario, ...argv] = words;
    const numberSchema = {
      '~standard': {
        validate: (value) =>
          typeof value === 'string' && /^\d+$/.test(value)
            ? { value: Number(value) }
            : { issues: [{ message: 'Use decimal digits.' }] },
        vendor: 'fixture',
        version: 1,
      },
    };

    let calls = 0;
    let app = new Application('schema', development);
    switch (scenario) {
      case 'default':
      case 'invalid-default': {
        app = app.option('size', {
          default: scenario === 'default' ? '10' : 'bad',
          description: 'The size option.',
          type: 'string',
          validate: numberSchema,
        });
        break;
      }
      case 'transform': {
        app = app.option('size', {
          description: 'The size option.',
          type: 'string',
          validate: numberSchema,
        });
        break;
      }
      case 'absence': {
        app = app.option('size', {
          description: 'The size option.',
          type: 'string',
          validate: z
            .string()
            .default('internal')
            .transform(() => ++calls),
        });
        app = app.action(({ options, out }) =>
          out.print(
            JSON.stringify({
              absent: options.size === undefined,
              calls,
              presentKey: Object.hasOwn(options, 'size'),
            }),
          ),
        );
        break;
      }
      case 'async': {
        app = app.option('size', {
          default: '10',
          description: 'The size option.',
          type: 'string',
          validate: schema(async (raw) => {
            await delay();
            calls++;
            return numberSchema['~standard'].validate(raw);
          }),
        });
        app = app.action(({ options, out }) => out.print(JSON.stringify({ ...options, calls })));
        break;
      }
      case 'issues': {
        app = app
          .option('same', {
            description: 'The same option.',
            type: 'string',
            validate: schema(async () => {
              await delay();
              return { issues: [{ message: 'First.' }, { message: 'Second.' }] };
            }),
          })
          .argument('same', {
            description: 'The same argument.',
            required: true,
            validate: z.string().min(2, 'Too short.'),
            variadic: true,
          })
          .option('last', {
            description: 'The last option.',
            type: 'string',
            validate: schema(() => ({ issues: [{ message: 'Last.' }] })),
          });
        break;
      }
      case 'each': {
        app = app.argument('files', {
          description: 'The files argument.',
          required: true,
          validate: z.string().transform((file) => file.toUpperCase()),
          variadic: true,
        });
        app = app.action(({ args, passthrough, host, out }) =>
          out.print(
            JSON.stringify({
              args: { files: { count: args.files.length, joined: args.files.join(':') } },
              argv: host.argv,
              passthrough,
            }),
          ),
        );
        break;
      }
      case 'throw':
      case 'reject': {
        app = app
          .option('size', {
            description: 'The size option.',
            type: 'string',
            validate: schema(() => {
              if (scenario === 'reject') {
                return Promise.reject(new Error('Broken validator.'));
              }
              throw new Error('Broken validator.');
            }),
          })
          .option('later', {
            description: 'The later option.',
            type: 'string',
            validate: schema(() => {
              writeStdout('later ran\n');
              return { value: 'later' };
            }),
          });
        break;
      }
      case 'empty-issues': {
        app = app.option('size', {
          description: 'The size option.',
          type: 'string',
          validate: schema(() => ({ issues: [] })),
        });
        break;
      }
      case 'malformed-issue': {
        const malformed = {
          key: { message: 'Bad.', path: [{ key: {} }] },
          missing: {},
          nonarray: { message: 'Bad.', path: 'x' },
          null: null,
          number: { message: 42 },
          path: { message: 'Bad.', path: [null] },
        }[argv.shift()];
        app = app
          .option('size', {
            description: 'The size option.',
            type: 'string',
            validate: schema(() => ({ issues: [malformed] })),
          })
          .option('later', {
            description: 'The later option.',
            type: 'string',
            validate: schema(() => {
              writeStdout('later ran\n');
              return { value: 'later' };
            }),
          });
        break;
      }
      case 'malformed-result': {
        app = app.option('size', {
          description: 'The size option.',
          type: 'string',
          validate: schema(() => ({})),
        });
        break;
      }
      case 'required': {
        app = app.option('size', {
          description: 'The size option.',
          required: true,
          type: 'string',
          validate: numberSchema,
        });
        break;
      }
      case 'raw-default': {
        app = app.option('size', {
          default: 'raw',
          description: 'The size option.',
          type: 'string',
        });
        break;
      }
      case 'undefined-default': {
        app = app.option('size', {
          default: undefined,
          description: 'The size option.',
          type: 'string',
          validate: z.string().default('internal'),
        });
        break;
      }
      case 'undefined-output': {
        app = app.option('size', {
          default: '10',
          description: 'The size option.',
          type: 'string',
          validate: z.string().transform(() => {
            calls++;
            return undefined;
          }),
        });
        app = app.action(({ options, out }) =>
          out.print(JSON.stringify({ absent: options.size === undefined, calls })),
        );
        break;
      }
      case 'rerun': {
        const config = {
          default: '10',
          description: 'The proto option.',
          type: 'string',
          validate: schema(async (raw) => ({ value: { call: ++calls, size: Number(raw) } })),
        };
        app = app.option('__proto__', config);
        config.default = '99';
        config.validate = numberSchema;
        app = app.action(({ options, out }) => {
          out.print(JSON.stringify(options));
          options.__proto__.size = 55;
        });
        await Promise.all([
          app.run({ process: createProcess({ argv: [] }) }),
          app.run({ process: createProcess({ argv: ['--__proto__', '20'] }) }),
        ]);
        await app.run({ process: createProcess({ argv: [] }) });
        break;
      }
      case 'throw-controls': {
        app = app.option('size', {
          description: 'The size option.',
          type: 'string',
          validate: schema(() => {
            throw new Error('bad\u202eevil\nsecond line x');
          }),
        });
        break;
      }
      default: {
        throw new Error(`Unknown scenario: ${scenario}`);
      }
    }
    if (!['absence', 'async', 'each', 'undefined-output', 'rerun'].includes(scenario)) {
      app = app.action(({ options, out }) => out.print(JSON.stringify(options)));
    }
    if (scenario !== 'rerun') {
      await app.run({ process: createProcess({ argv }) });
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const schema = (validate) => ({ '~standard': { validate, vendor: 'fixture', version: 1 } });
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));

export { runFixture as run };
