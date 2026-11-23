import {
  Application,
  Command,
  FatalError,
  plugin,
  processHandle,
  validationContext,
} from '@loomcli/core';

const [scenario, answer] = process.argv.slice(2);

/** A failure an environment hook throws, which declares its own exit code. */
class UnreadableFileError extends FatalError {
  static exitCode = 78;

  constructor(message) {
    super(message);
    this.name = 'UnreadableFileError';
  }
}

const events = [];
const controller = new AbortController();
const first = plugin('fixture/first', {
  onEnvironment: async () => {
    events.push('first');
    if (scenario === 'cancel' && answer === 'during') {
      controller.abort();
    }
    if (scenario === 'throws') {
      throw answer === 'fatal'
        ? new UnreadableFileError('The .env file cannot be read.')
        : new TypeError('The parser broke.');
    }
    if (scenario === 'dashed') {
      return { 'my-var': 'dashed' };
    }
    if (scenario === 'precedence') {
      return { EMPTY: 'file', SET: 'file', UNDEFINED: 'file' };
    }
    return { LOOM_DOTENV_TOKEN: 'imported' };
  },
});
const second = plugin('fixture/second', {
  middleware: {
    activate: 'always',
    load: async () => ({
      default: async ({ host, next }) => {
        events.push(`middleware:${host.env.LOOM_DOTENV_TOKEN}`);
        await next();
      },
    }),
  },
  onEnvironment: ({ host }) => {
    events.push(`second:${host.env.LOOM_DOTENV_TOKEN}`);
    return { LOOM_DOTENV_TOKEN: 'later' };
  },
});
const validate = {
  '~standard': {
    validate: (value, options) => {
      const context = validationContext(options);
      events.push(`${context.phase}:${context.host.env.LOOM_DOTENV_TOKEN}`);
      return { value };
    },
    vendor: 'fixture',
    version: 1,
  },
};
const app = new Application('app', {
  description: 'Exercise environment preparation.',
  plugins: [first, second],
})
  .option('check', { default: 'default', description: 'Check timing.', type: 'string', validate })
  .option('token', {
    description: 'An imported token.',
    env: 'LOOM_DOTENV_TOKEN',
    type: 'string',
    validate,
  })
  .command(
    new Command('child', { description: 'Read the inherited environment.' }).action(
      ({ host, out }) => out.print(host.env.LOOM_DOTENV_TOKEN),
    ),
  )
  .action(async ({ host, invoke, options, out }) =>
    out.print(
      JSON.stringify({
        events,
        ...(scenario === 'nested' ? { nested: await invoke(['child'], {}) } : {}),
        options,
        ...(scenario === 'precedence' ? { env: host.env } : {}),
        ...(scenario === 'dashed' ? { dashed: host.env['my-var'] } : {}),
        ...(scenario === 'timing' ? {} : { process: process.env.LOOM_DOTENV_TOKEN ?? null }),
      }),
    ),
  );

if (scenario === 'inspect') {
  app.inspect();
  app.check();
  process.stdout.write(`${JSON.stringify(events)}\n`);
} else if (scenario === 'cancel') {
  if (answer === 'before') {
    controller.abort();
  }
  await app.run({ process: processHandle({ argv: [] }), signal: controller.signal });
  process.stdout.write(
    `${JSON.stringify({ events, process: process.env.LOOM_DOTENV_TOKEN ?? null })}\n`,
  );
} else if (scenario === 'timing') {
  await app.run({ process: processHandle({ argv: [], env: {} }) });
} else if (scenario === 'dashed') {
  await app.run({ process: processHandle({ argv: [], env: {} }) });
} else if (scenario === 'precedence') {
  await app.run({
    process: processHandle({ argv: [], env: { EMPTY: '', SET: 'shell', UNDEFINED: undefined } }),
  });
} else if (scenario === 'process-name' || scenario === 'nested') {
  const outcome = await app.invoke([], {});
  process.stdout.write(outcome.output);
} else {
  await app.run({
    process: processHandle({
      argv: [],
      ...(scenario === 'process-env' ? { env: {} } : {}),
      ...(scenario === 'process-cwd' ? { cwd: process.cwd() } : {}),
    }),
  });
}
