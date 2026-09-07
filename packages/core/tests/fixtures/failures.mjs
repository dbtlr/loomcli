import {
  Application,
  Command,
  DeclarationError,
  FatalError,
  GlobalOptions,
  InputError,
  InternalError,
  renderFailure,
  UsageError,
} from '@loom/core';
import { z } from 'zod';

const [scenario, ...argv] = process.argv.slice(2);

/** Every fact the failure classes carry. JSON drops the keys a class does not declare. */
const facts = {
  render: (failure) =>
    `${JSON.stringify({
      accepted: failure.accepted,
      candidates: failure.candidates,
      command: failure.command,
      exitCode: failure.exitCode,
      extra: failure.extra,
      message: failure.message,
      name: failure.name,
      problems: failure.problems,
      reason: failure.reason,
      spelling: failure.spelling,
      token: failure.token,
      value: failure.value,
    })}\n`,
};

const brand = (label) => ({ render: (failure) => `${label}: ${failure.message}\n` });
const breaks = {
  render: () => {
    throw new Error('Cannot render the failure.');
  },
};
const counted = { render: (failure) => failure.exitCode };

/** An application's own fatal type, so registering it implies the renderer for it. */
class ConfigError extends FatalError {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/.test(value)
        ? { value: Number(value) }
        : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};
const speed = {
  '~standard': {
    validate: () => ({ issues: [{ message: 'Use fast or slow.' }] }),
    vendor: 'fixture',
    version: 1,
  },
};

const dispatch = ({ out }) => out.print('dispatched');

/** A routed graph, so every token and validation fault of one invocation has a declaration. */
function routed(failures) {
  const globals = new GlobalOptions()
    .option('file', { required: true, short: 'f', type: 'string' })
    .option('quiet', { short: 'q', type: 'boolean' });
  const get = new Command('get', globals)
    .argument('path', { required: true })
    .option('depth', { short: 'd', type: 'string', validate: digits })
    .option('mode', { short: 'm', shortOnly: true, type: 'string', validate: speed })
    .option('field', {
      multiple: true,
      short: 'F',
      type: 'string',
      validate: z.array(z.string().min(1, 'Supply a field name.')),
    })
    .action(dispatch);
  const cache = new Command('cache', globals).command(
    new Command('keys', globals).action(dispatch),
  );
  return new Application('failures', { failures, globals })
    .command(get)
    .command(cache)
    .action(dispatch);
}

function ending(failures, action) {
  return new Application('failures', { failures }).action(action);
}

function build() {
  switch (scenario) {
    case 'usage': {
      return routed([renderFailure(UsageError, facts)]);
    }
    case 'derived': {
      return routed([
        renderFailure(UsageError, brand('usage')),
        renderFailure(InputError, brand('input')),
      ]);
    }
    case 'duplicate': {
      return routed([
        renderFailure(InputError, brand('one')),
        renderFailure(InputError, brand('two')),
      ]);
    }
    case 'foreign': {
      return routed([{}]);
    }
    case 'fatal': {
      return ending([renderFailure(ConfigError, brand('config'))], () => {
        throw new ConfigError('Config is unreadable.');
      });
    }
    case 'fatal-base': {
      return ending([renderFailure(ConfigError, brand('config'))], ({ out }) =>
        out.fatal('Expected failure.'),
      );
    }
    case 'render-failure': {
      // The action returns without the rejection, so the renderer failure is reported after it.
      return ending(
        [
          renderFailure(InternalError, {
            render: (failure) => `internal: ${failure.message} (cause: ${failure.cause.message})\n`,
          }),
        ],
        ({ out }) => {
          out.render([], breaks);
        },
      );
    }
    case 'internal': {
      return ending([renderFailure(InternalError, brand('internal'))], () => {
        throw new Error('Unexpected failure.');
      });
    }
    case 'declaration': {
      return new Application('failures', {
        failures: [renderFailure(DeclarationError, brand('declaration'))],
      })
        .argument('files', { required: true, variadic: true })
        .argument('extras', { required: true, variadic: true })
        .action(dispatch);
    }
    case 'broken':
    case 'broken-fallback': {
      return ending([renderFailure(FatalError, breaks)], ({ out }) =>
        out.fatal('Expected failure.'),
      );
    }
    case 'broken-nonstring': {
      return ending([renderFailure(FatalError, counted)], ({ out }) =>
        out.fatal('Expected failure.'),
      );
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

// An unusable destination proves the fallback path stops reporting without changing the status.
const host = scenario === 'broken-fallback' ? { argv, stderr: {} } : { argv };
const code = await build().run({ host });
process.stdout.write(`resolved:${code}\n`);
