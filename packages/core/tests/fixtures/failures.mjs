import {
  Application,
  Command,
  DeclarationError,
  FatalError,
  InputError,
  InternalError,
  override,
  UsageError,
} from '@loomcli/core';
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
// A view is synchronous, so a returned promise is a non-string return.
// Core observes its rejection, which would otherwise end the process before `run()` resolves.
const rejects = { render: () => Promise.reject(new Error('Cannot render the failure.')) };
/** Every issue the reported problems carry, so a test reads the list a view receives. */
const issueMessages = {
  render: (failure) =>
    `${failure.problems
      .flatMap((problem) => (problem.reason === 'invalid' ? problem.issues : []))
      .map((issue) => `issue: ${issue.message}`)
      .join('\n')}\n`,
};

/** An application's own fatal type, so overriding it implies the view for it. */
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

/** A schema that rejects a value and explains nothing, so core supplies the placeholder issue. */
const silent = {
  '~standard': {
    validate: () => ({ issues: [] }),
    vendor: 'fixture',
    version: 1,
  },
};

const dispatch = ({ out }) => out.print('dispatched');

/** A routed graph, so every token and validation fault of one invocation has a declaration. */
function routed(views) {
  const get = new Command('get')
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
  const cache = new Command('cache').command(new Command('keys').action(dispatch));
  return new Application('failures', { views })
    .globalOption('file', { required: true, short: 'f', type: 'string' })
    .globalOption('quiet', { short: 'q', type: 'boolean' })
    .command(get)
    .command(cache)
    .action(dispatch);
}

function ending(views, action) {
  return new Application('failures', { views }).action(action);
}

function build() {
  switch (scenario) {
    case 'usage': {
      return routed([override(UsageError, facts)]);
    }
    case 'derived': {
      return routed([override(UsageError, brand('usage')), override(InputError, brand('input'))]);
    }
    case 'duplicate': {
      return routed([override(InputError, brand('one')), override(InputError, brand('two'))]);
    }
    case 'foreign': {
      return routed([{}]);
    }
    case 'fatal': {
      return ending([override(ConfigError, brand('config'))], () => {
        throw new ConfigError('Config is unreadable.');
      });
    }
    case 'fatal-base': {
      return ending([override(ConfigError, brand('config'))], ({ out }) =>
        out.fatal('Expected failure.'),
      );
    }
    case 'render-failure': {
      // The action returns without the rejection, so the view failure is reported after it.
      return ending(
        [
          override(InternalError, {
            render: (failure) => `internal: ${failure.message} (cause: ${failure.cause.message})\n`,
          }),
        ],
        ({ out }) => {
          out.render([], breaks);
        },
      );
    }
    case 'internal': {
      return ending([override(InternalError, brand('internal'))], () => {
        throw new Error('Unexpected failure.');
      });
    }
    case 'declaration': {
      return new Application('failures', {
        views: [override(DeclarationError, brand('declaration'))],
      })
        .argument('files', { required: true, variadic: true })
        .argument('extras', { required: true, variadic: true })
        .action(dispatch);
    }
    case 'empty-issues': {
      return new Application('failures', {
        views: [override(InputError, issueMessages)],
      })
        .option('tag', { type: 'string', validate: silent })
        .action(dispatch);
    }
    case 'broken':
    case 'broken-fallback': {
      return ending([override(FatalError, breaks)], ({ out }) => out.fatal('Expected failure.'));
    }
    case 'broken-nonstring': {
      return ending([override(FatalError, counted)], ({ out }) => out.fatal('Expected failure.'));
    }
    case 'broken-rejecting': {
      return ending([override(FatalError, rejects)], ({ out }) => out.fatal('Expected failure.'));
    }
    // A broken view on a usage class: the default text of the failure, then the diagnostic.
    case 'broken-usage': {
      return routed([override(UsageError, breaks)]);
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
