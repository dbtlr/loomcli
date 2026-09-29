import {
  Application,
  Command,
  DeclarationError,
  EX_DATAERR,
  EX_UNAVAILABLE,
  extension,
  FatalError,
  InputError,
  LoomError,
  override,
  plugin,
  UsageError,
} from '@loomcli/core';
import { z } from 'zod';

import { ruleText } from './rule-text.mjs';
import assignSloppily from './sloppy-assign.cjs';

const [scenario, ...argv] = process.argv.slice(2);

/** Every export of `@loomcli/core`, which the `exports` and `core-statics` scenarios scan. */
const core = await import('@loomcli/core');

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
    ['NaNError', Number.NaN],
    ['InfinityError', Number.POSITIVE_INFINITY],
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

/** The value a tampering case writes, read as JSON so a test can pass a number or a string. */
const tampered = JSON.parse(process.env.FIXTURE_VALUE ?? '200');

/** A JavaScript subclass whose instance field shadows the instance's `exitCode`. */
class ShadowError extends FatalError {
  exitCode = tampered;

  constructor() {
    super('Shadowed.');
    this.name = 'ShadowError';
  }
}

/**
 * Each tampering case, which throws what an action, a middleware, or a source raises. An ES module
 * is strict mode code, so `assigned` writes the instance's `exitCode` as strict code, and
 * `assigned-sloppy` writes it through a CommonJS module, which is sloppy mode code.
 */
const tamperings = {
  assigned: () => {
    const failure = new RegistryUnavailableError(503);
    failure.exitCode = tampered;
    throw failure;
  },
  'assigned-sloppy': () => {
    const failure = new RegistryUnavailableError(503);
    assignSloppily(failure, tampered);
    throw failure;
  },
  created: () => {
    throw Object.create(FatalError.prototype);
  },
  field: () => {
    throw new ShadowError();
  },
  foreign: () => {
    const failure = new Error('Foreign.');
    failure.exitCode = tampered;
    throw Object.setPrototypeOf(failure, FatalError.prototype);
  },
  reprototyped: () => {
    throw Object.setPrototypeOf({ exitCode: tampered, message: 'Forged.' }, FatalError.prototype);
  },
};

const sourceKey = extension('@fixture/exits/key', { schema: z.string(), target: 'option' });

/** Where a tampering case is raised: an action, a middleware before next(), or a source. */
function tamperingApplication() {
  const raise = tamperings[process.env.FIXTURE_CASE];
  const where = process.env.FIXTURE_WHERE ?? 'action';
  if (where === 'middleware') {
    const raising = plugin('@fixture/raising', {
      middleware: { activate: 'always', load: async () => ({ default: raise }) },
    });
    return ending(({ out }) => out.print('dispatched'), { plugins: [raising] });
  }
  if (where === 'source') {
    const raising = plugin('@fixture/raising', {
      extensions: [sourceKey],
      source: { binding: sourceKey, load: async () => ({ default: raise }) },
    });
    return new Application('exits', { plugins: [raising] })
      .globalOption('limit', { extensions: [sourceKey('limit')], type: 'string' })
      .action(({ out }) => out.print('dispatched'));
  }
  return ending(raise);
}

/**
 * One class whose static changes after its first construction. `reassigned` writes a new static
 * between two constructions, `flipping` answers a different code on each read, and `mutated`
 * writes a reserved static after the thrown instance was constructed.
 */
function capturedApplication() {
  const variant = process.env.FIXTURE_CASE;
  if (variant === 'flipping') {
    let reads = 0;
    class FlippingError extends FatalError {
      static get exitCode() {
        reads += 1;
        return reads === 1 ? EX_UNAVAILABLE : EX_DATAERR;
      }

      constructor(message) {
        super(message);
        this.name = 'FlippingError';
      }
    }
    return ending(({ out }) => {
      const first = new FlippingError('First.');
      const second = new FlippingError('Second.');
      out.print(`instances:${String(first.exitCode)},${String(second.exitCode)}`);
      throw second;
    });
  }
  class CapturedError extends FatalError {
    static exitCode = EX_UNAVAILABLE;

    constructor(message) {
      super(message);
      this.name = 'CapturedError';
    }
  }
  if (variant === 'reassigned') {
    const first = new CapturedError('First.');
    CapturedError.exitCode = EX_DATAERR;
    return ending(({ out }) => {
      const second = new CapturedError('Second.');
      out.print(`instances:${String(first.exitCode)},${String(second.exitCode)}`);
      throw second;
    });
  }
  return ending(({ out }) => {
    const failure = new CapturedError('Mutated.');
    CapturedError.exitCode = 200;
    out.print(`instance:${String(failure.exitCode)}`);
    throw failure;
  });
}

/** A class whose static getter throws, so its first construction throws that error. */
class UnreadableError extends FatalError {
  static get exitCode() {
    throw new Error('The code table is unavailable.');
  }

  constructor(message) {
    super(message);
    this.name = 'UnreadableError';
  }
}

/**
 * Every class `@loomcli/core` exports that is a failure class, whose statics a case overwrites
 * before anything is constructed.
 */
const coreFailureClasses = Object.values(core).filter(
  (value) =>
    typeof value === 'function' && (value === LoomError || value.prototype instanceof LoomError),
);

/**
 * An application run after every core failure class's static was overwritten. `fatal` throws a
 * FatalError and an undeclaring subclass, `usage` routes an unknown command, and `declaration`
 * constructs a class that declares a reserved code.
 */
function coreStaticsApplication() {
  const variant = process.env.FIXTURE_CASE;
  for (const Class of coreFailureClasses) {
    Class.exitCode = variant === 'declaration' ? 200 : 0;
  }
  if (variant === 'usage') {
    return new Application('exits').command(
      new Command('known').action(({ out }) => out.print('dispatched')),
    );
  }
  if (variant === 'declaration') {
    const Reserved = reserved.InterruptError;
    return ending(() => {
      throw new Reserved('unreachable');
    });
  }
  return ending(() => {
    const variants = [new FatalError('Stopped.'), new ConfigError('Config is unreadable.')];
    throw variants[process.env.FIXTURE_THROWN === 'subclass' ? 1 : 0];
  });
}

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
    case 'tampered': {
      return tamperingApplication();
    }
    case 'captured': {
      return capturedApplication();
    }
    case 'unreadable': {
      return ending(() => {
        throw new UnreadableError('unreachable');
      });
    }
    case 'core-statics': {
      return coreStaticsApplication();
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
  const sysexits = Object.entries(core).filter(([name]) => name.startsWith('EX_'));
  process.stdout.write(`${JSON.stringify(Object.fromEntries(sysexits))}\n`);
} else if (scenario === 'construct') {
  // Constructing outside a run throws at that line.
  try {
    new reserved[process.env.FIXTURE_CLASS]('unreachable');
    process.stdout.write('constructed\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'DeclarationError' : 'other';
    process.stdout.write(`thrown:${kind}:${String(error.exitCode)}: ${ruleText(error)}\n`);
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
