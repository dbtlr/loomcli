import {
  Application,
  DeclarationError,
  EX_UNAVAILABLE,
  FatalError,
  InputError,
  LoomError,
  override,
  plugin,
  UsageError,
} from '@loomcli/core';

const [scenario, ...argv] = process.argv.slice(2);

/** An application's own failure that declares a sysexits code. */
class RegistryUnavailableError extends FatalError {
  static exitCode = EX_UNAVAILABLE;

  constructor(status) {
    super(`The registry answered ${String(status)}.`);
    this.name = 'RegistryUnavailableError';
    this.status = status;
  }
}

/** A subclass that declares nothing, so it exits with its parent's code. */
class RegistryTimeoutError extends RegistryUnavailableError {
  constructor() {
    super(504);
    this.name = 'RegistryTimeoutError';
  }
}

/** A fatal subclass that declares nothing, so it reaches LoomError's 1. */
class ConfigError extends FatalError {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** A class that declares 2 without extending UsageError. */
class StrictError extends FatalError {
  static exitCode = 2;

  constructor(message) {
    super(message);
    this.name = 'StrictError';
  }
}

/** One class that declares a value no failure may exit with, under the name a test reads. */
function reservedClass(name, code) {
  const Reserved = class extends FatalError {
    static exitCode = code;
  };
  Object.defineProperty(Reserved, 'name', { value: name });
  return Reserved;
}

/** The undeclarable classes, keyed by the name each one carries. */
const reserved = Object.fromEntries(
  [
    ['SuccessError', 0],
    ['ShellError', 126],
    ['InterruptError', 130],
    ['FractionError', 3.5],
    ['StringError', '69'],
  ].map(([name, code]) => [name, reservedClass(name, code)]),
);

/** A view that reads the code on the instance, so a test sees the value a view receives. */
const counted = {
  render: (failure) => `${String(failure.exitCode)}: ${failure.message}\n`,
};

const breaks = {
  render: () => {
    throw new Error('Cannot render the failure.');
  },
};

/** A plugin whose middleware throws the declared failure before it calls next(). */
const guard = plugin('@fixture/guard', {
  middleware: {
    activate: 'always',
    load: async () => ({
      default: () => {
        throw new RegistryUnavailableError(503);
      },
    }),
  },
});

function ending(action, options = {}) {
  return new Application('exits', options).action(action);
}

/** Each scenario's application, and the signal its run reads. */
function build() {
  switch (scenario) {
    case 'declared': {
      return ending(
        () => {
          throw new RegistryUnavailableError(503);
        },
        { views: [override(RegistryUnavailableError, counted)] },
      );
    }
    case 'inherited': {
      return ending(() => {
        throw new RegistryTimeoutError();
      });
    }
    case 'undeclared': {
      return ending(() => {
        throw new ConfigError('Config is unreadable.');
      });
    }
    case 'strict': {
      return ending(
        () => {
          throw new StrictError('Strict mode refused the value.');
        },
        { views: [override(UsageError, { render: () => 'usage override\n' })] },
      );
    }
    case 'reserved': {
      const Reserved = reserved[process.env.FIXTURE_CLASS];
      return ending(() => {
        throw new Reserved('unreachable');
      });
    }
    case 'middleware': {
      return ending(({ out }) => out.print('dispatched'), { plugins: [guard] });
    }
    case 'broken': {
      return ending(
        () => {
          throw new RegistryUnavailableError(503);
        },
        { views: [override(RegistryUnavailableError, breaks)] },
      );
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

if (scenario === 'statics') {
  process.stdout.write(
    `${JSON.stringify({
      ConfigError: ConfigError.exitCode,
      InputError: InputError.exitCode,
      LoomError: LoomError.exitCode,
      RegistryTimeoutError: RegistryTimeoutError.exitCode,
      RegistryUnavailableError: RegistryUnavailableError.exitCode,
      UsageError: UsageError.exitCode,
    })}\n`,
  );
} else if (scenario === 'exports') {
  // Every export whose name starts EX_, so an EX_OK among them would show.
  const core = await import('@loomcli/core');
  const sysexits = Object.entries(core).filter(([name]) => name.startsWith('EX_'));
  process.stdout.write(`${JSON.stringify(Object.fromEntries(sysexits))}\n`);
} else if (scenario === 'construct') {
  // Constructing outside a run throws at that line.
  try {
    new reserved[process.env.FIXTURE_CLASS]('unreachable');
    process.stdout.write('constructed\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'DeclarationError' : 'other';
    process.stdout.write(`thrown:${kind}:${String(error.exitCode)}: ${error.message}\n`);
  }
} else if (scenario === 'cancelled') {
  // The action throws the declared failure after the caller aborted, so the signal decides.
  const controller = new AbortController();
  const app = ending(() => {
    controller.abort();
    throw new RegistryUnavailableError(503);
  });
  const code = await app.run({ host: { argv }, signal: controller.signal });
  process.stdout.write(`resolved:${code}\n`);
} else {
  const code = await build().run({ host: { argv } });
  process.stdout.write(`resolved:${code}\n`);
}
