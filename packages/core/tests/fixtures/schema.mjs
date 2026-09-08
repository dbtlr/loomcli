import { Application } from '@loomcli/core';
import { z } from 'zod';

const [scenario, ...argv] = process.argv.slice(2);
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
const schema = (validate) => ({ '~standard': { validate, vendor: 'fixture', version: 1 } });
const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
let calls = 0;
let app = new Application('schema');
switch (scenario) {
  case 'default':
  case 'invalid-default': {
    app = app.option('size', {
      default: scenario === 'default' ? '10' : 'bad',
      type: 'string',
      validate: numberSchema,
    });
    break;
  }
  case 'transform': {
    app = app.option('size', { type: 'string', validate: numberSchema });
    break;
  }
  case 'absence': {
    app = app.option('size', {
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
        type: 'string',
        validate: schema(async () => {
          await delay();
          return { issues: [{ message: 'First.' }, { message: 'Second.' }] };
        }),
      })
      .argument('same', {
        required: true,
        validate: z.array(z.string().min(2, 'Too short.')),
        variadic: true,
      })
      .option('last', {
        type: 'string',
        validate: schema(() => ({ issues: [{ message: 'Last.' }] })),
      });
    break;
  }
  case 'collection': {
    app = app.argument('files', {
      required: true,
      validate: z
        .array(z.string())
        .transform((files) => ({ count: files.length, joined: files.join(':') })),
      variadic: true,
    });
    app = app.action(({ args, passthrough, host, out }) =>
      out.print(JSON.stringify({ args, argv: host.argv, passthrough })),
    );
    break;
  }
  case 'throw':
  case 'reject': {
    app = app
      .option('size', {
        type: 'string',
        validate: schema(() => {
          if (scenario === 'reject') {
            return Promise.reject(new Error('Broken validator.'));
          }
          throw new Error('Broken validator.');
        }),
      })
      .option('later', {
        type: 'string',
        validate: schema(() => {
          process.stdout.write('later ran\n');
          return { value: 'later' };
        }),
      });
    break;
  }
  case 'empty-issues': {
    app = app.option('size', { type: 'string', validate: schema(() => ({ issues: [] })) });
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
      .option('size', { type: 'string', validate: schema(() => ({ issues: [malformed] })) })
      .option('later', {
        type: 'string',
        validate: schema(() => {
          process.stdout.write('later ran\n');
          return { value: 'later' };
        }),
      });
    break;
  }
  case 'malformed-result': {
    app = app.option('size', { type: 'string', validate: schema(() => ({})) });
    break;
  }
  case 'required': {
    app = app.option('size', { required: true, type: 'string', validate: numberSchema });
    break;
  }
  case 'required-default': {
    app = app.option('size', {
      default: '1',
      required: true,
      type: 'string',
      validate: numberSchema,
    });
    break;
  }
  case 'boolean-schema': {
    app = app.option('size', { type: 'boolean', validate: numberSchema });
    break;
  }
  case 'invalid-schema': {
    app = app.option('size', { type: 'string', validate: { '~standard': { version: 2 } } });
    break;
  }
  case 'raw-default': {
    app = app.option('size', { default: 'raw', type: 'string' });
    break;
  }
  case 'nonstring-default': {
    app = app.option('size', { default: 12, type: 'string' });
    break;
  }
  case 'undefined-default': {
    app = app.option('size', {
      default: undefined,
      type: 'string',
      validate: z.string().default('internal'),
    });
    break;
  }
  case 'undefined-output': {
    app = app.option('size', {
      default: '10',
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
      app.run({ host: { argv: [] } }),
      app.run({ host: { argv: ['--__proto__', '20'] } }),
    ]);
    await app.run({ host: { argv: [] } });
    break;
  }
  default: {
    throw new Error(`Unknown scenario: ${scenario}`);
  }
}
if (!['absence', 'async', 'collection', 'undefined-output', 'rerun'].includes(scenario)) {
  app = app.action(({ options, out }) => out.print(JSON.stringify(options)));
}
if (scenario !== 'rerun') {
  await app.run({ host: { argv } });
}
