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

import { declare } from './declare.mjs';

const [scenario, ...argv] = process.argv.slice(2);

/** Every fact the failure classes carry. JSON drops the keys a class does not declare. */
const facts = {
  render: (failure) =>
    `${JSON.stringify({
      accepted: failure.accepted,
      candidates: failure.candidates,
      command: failure.command,
      commands: failure.commands,
      exitCode: failure.exitCode,
      extra: failure.extra,
      message: failure.message,
      name: failure.name,
      problems: failure.problems,
      spelling: failure.spelling,
      token: failure.token,
      value: failure.value,
    })}\n`,
};

// A declaration fault holds its sentence apart from the diagnostic its message carries.
const brand = (label) => ({
  render: (failure) => `${label}: ${failure.sentence ?? failure.message}\n`,
});
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
/** A schema that rejects every value at a path segment the test supplies. */
const keyed = {
  '~standard': {
    validate: (value) => ({ issues: [{ message: 'Supply a known key.', path: [value] }] }),
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
  const get = new Command('get', {
    description: 'The get command.',
  })
    .argument('path', { description: 'The path argument.', required: true })
    .option('depth', {
      description: 'The depth option.',
      short: 'd',
      type: 'string',
      validate: digits,
    })
    .option('mode', {
      description: 'The mode option.',
      short: 'm',
      shortOnly: true,
      type: 'string',
      validate: speed,
    })
    .option('key', { description: 'The key option.', type: 'string', validate: keyed })
    .option('field', {
      description: 'The field option.',
      multiple: true,
      short: 'F',
      type: 'string',
      validate: z.string().min(1, 'Supply a field name.'),
    })
    .action(dispatch);
  const cache = new Command('cache', {
    description: 'The cache command.',
  }).command(
    new Command('keys', {
      description: 'The keys command.',
    }).action(dispatch),
  );
  return new Application('failures', { description: 'The failures application.', views })
    .globalOption('file', { description: 'The file option.', short: 'f', type: 'string' })
    .globalOption('quiet', { description: 'The quiet option.', short: 'q', type: 'boolean' })
    .command(get)
    .command(cache)
    .action(dispatch);
}

// A test that reads a broken contract's own sentence runs the fixture as a development build.
const packet =
  process.env.FIXTURE_BUILD === undefined ? {} : { packet: { build: process.env.FIXTURE_BUILD } };

function ending(views, action) {
  return new Application('failures', {
    description: 'The failures application.',
    ...packet,
    views,
  }).action(action);
}

function build() {
  switch (scenario) {
    case 'usage': {
      return routed([override(UsageError, facts)]);
    }
    // No override, so core's own default text answers every failure.
    case 'default': {
      return routed([]);
    }
    // A required local option and a required argument on one Command omitted together.
    // A global option declares no presence rule, so the aggregation reads local inputs.
    case 'required': {
      const get = new Command('get', {
        description: 'The get command.',
      })
        .argument('path', { description: 'The path argument.', required: true })
        .option('depth', {
          description: 'The depth option.',
          required: true,
          short: 'd',
          type: 'string',
        })
        .action(dispatch);
      return new Application('failures', {
        description: 'The failures application.',
        views: [override(UsageError, facts)],
      })
        .command(get)
        .action(dispatch);
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
    // A root with neither children nor an action is final only at build, so run() reports it.
    case 'declaration': {
      return new Application('failures', {
        description: 'The failures application.',
        views: [override(DeclarationError, brand('declaration'))],
      });
    }
    case 'empty-issues': {
      return new Application('failures', {
        description: 'The failures application.',
        views: [override(InputError, issueMessages)],
      })
        .option('tag', { description: 'The tag option.', type: 'string', validate: silent })
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
const app = declare(build);
const code = await app.run({ host });
process.stdout.write(`resolved:${code}\n`);
