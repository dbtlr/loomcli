import {
  Application,
  Command,
  DeclarationError,
  EX_DATAERR,
  FatalError,
  InputError,
  InternalError,
  LoomError,
  MisplacedOptionError,
  MissingValueError,
  NonCallableCommandError,
  RepeatedOptionError,
  ResultError,
  UnexpectedArgumentError,
  UnexpectedValueError,
  UnknownCommandError,
  UnknownOptionError,
  plugin,
  UsageError,
  WorkingDirectoryError,
} from '@loomcli/core';

const [scenario, build = 'distributed'] = process.argv.slice(2);

/** The packet one run reads, which decides whether a defect shows its Developer Diagnostic. */
const packet = { packet: { build } };

/** Every class core exports, keyed by its name, as a projection reads them without an instance. */
const coreClasses = {
  DeclarationError,
  FatalError,
  InputError,
  InternalError,
  LoomError,
  MisplacedOptionError,
  MissingValueError,
  NonCallableCommandError,
  RepeatedOptionError,
  ResultError,
  UnexpectedArgumentError,
  UnexpectedValueError,
  UnknownCommandError,
  UnknownOptionError,
  UsageError,
  WorkingDirectoryError,
};

/** Jsonkit's failure, as the contract's example declares it. */
class PathNotFoundError extends FatalError {
  static code = 'path-not-found';
  static exitCode = EX_DATAERR;

  constructor(path) {
    super(`Path not found: "${path}".`);
    this.name = 'PathNotFoundError';
  }
}

/** A subclass that declares no code, so it reads its parent's. */
class NestedPathError extends PathNotFoundError {
  constructor(path) {
    super(path);
    this.name = 'NestedPathError';
  }
}

/** A bare FatalError subclass, which reads `fatal`. */
class BareError extends FatalError {
  constructor(message) {
    super(message);
    this.name = 'BareError';
  }
}

/** A direct LoomError subclass that declares no code, which reads `failure`. */
class DirectError extends LoomError {
  constructor(message) {
    super(message);
    this.name = 'DirectError';
  }
}

/** An author's InternalError subclass, whose own code never reaches a form. */
class OopsError extends InternalError {
  static code = 'oops';

  constructor() {
    super('Oops.', undefined);
    this.name = 'OopsError';
  }
}

/** One class that declares a code outside the grammar, under the name a test reads. */
function invalidClass(name, code) {
  const Invalid = class extends FatalError {
    static code = code;
  };
  Object.defineProperty(Invalid, 'name', { value: name });
  return Invalid;
}

/** The invalid classes, keyed by the name each one carries. */
const invalid = Object.fromEntries(
  [
    ['UnderscoreError', 'Path_Not_Found'],
    ['EmptyError', ''],
    ['LeadingError', '-x'],
    ['DoubledError', 'a--b'],
    ['SpacedError', 'path not found'],
    ['NumericError', 42],
  ].map(([name, code]) => [name, invalidClass(name, code)]),
);

/** A plugin that rejects every graph it judges, so each run fails at build. */
const judging = plugin('@fixture/judging', {
  onGraphBuilt: () => {
    throw new DeclarationError('The graph is rejected.');
  },
});

/** The form of the failure one run by name resolves with, or the outcome when it did not fail. */
async function formOf(app, path = [], values = {}) {
  const outcome = await app.invoke(path, values);
  return outcome.status === 'failed' ? outcome.form : outcome;
}

/** An application whose action throws what `raise` returns. */
function raising(raise) {
  return new Application('codes', { ...packet, description: 'The codes application.' }).action(
    () => {
      throw raise();
    },
  );
}

const scenarios = {
  /** Every author fault reads `internal`, in both builds. */
  'author-faults': async () => {
    const forms = {
      build: await formOf(
        new Application('codes', {
          ...packet,
          description: 'The codes application.',
          plugins: [judging],
        }).action(() => undefined),
      ),
      internal: await formOf(raising(() => new OopsError())),
      result: await formOf(
        new Application('codes', { ...packet, description: 'The codes application.' })
          .result()
          .action(() => {
            // The action returns without emitting the result it declared.
          }),
      ),
      'type-error': await formOf(raising(() => new TypeError('Cannot read the value.'))),
      unconstructed: await formOf(raising(() => Object.create(FatalError.prototype))),
    };
    const codes = Object.fromEntries(
      Object.entries(forms).map(([name, form]) => [name, form.code]),
    );
    process.stdout.write(`${JSON.stringify(codes)}\n`);
  },
  /** An invalid class constructed outside a run throws at that line. */
  construct: () => {
    try {
      new invalid[process.env.FIXTURE_CLASS]('Never.');
    } catch (error) {
      process.stdout.write(`thrown:${error.name}:${error.rule?.identity}:${error.sentence}\n`);
    }
  },
  /** A failure core raises by name for each class reaches the form with the class's code. */
  'core-forms': async () => {
    const app = new Application('codes', { ...packet, description: 'The codes application.' })
      .command(
        new Command('group', { description: 'The group command.' }).command(
          new Command('leaf', { description: 'The leaf command.' }).action(() => undefined),
        ),
      )
      .command(
        new Command('get', { description: 'The get command.' })
          .argument('path', { description: 'The path.', required: true })
          .action(({ args }) => {
            if (args.path === 'fatal') {
              throw new FatalError('Fatal.');
            }
            if (args.path === 'declaration') {
              throw new DeclarationError('A declaration fault.');
            }
          }),
      );
    const calls = {
      declaration: [['get'], { args: { path: 'declaration' } }],
      fatal: [['get'], { args: { path: 'fatal' } }],
      'invalid-input': [['get'], {}],
      'missing-subcommand': [['group'], {}],
      'unexpected-argument': [['get'], { args: { path: 'a', pth: 'b' } }],
      'unknown-command': [['nope'], {}],
      'unknown-option': [['get'], { args: { path: 'a' }, options: { bogus: true } }],
    };
    const codes = {};
    for (const [name, [path, values]] of Object.entries(calls)) {
      const form = await formOf(app, path, values);
      codes[name] = form.code;
    }
    process.stdout.write(`${JSON.stringify(codes)}\n`);
  },
  /** Core's statics are captured when the package loads, so a later write changes nothing. */
  'core-statics': async () => {
    for (const Class of Object.values(coreClasses)) {
      Object.defineProperty(Class, 'code', { value: 'x' });
    }
    const app = new Application('codes', { ...packet, description: 'The codes application.' })
      .command(new Command('get', { description: 'The get command.' }).action(() => undefined))
      .command(
        new Command('fail', { description: 'The fail command.' }).action(() => {
          throw new BareError('Bare.');
        }),
      );
    const unknown = await formOf(app, ['nope']);
    const bare = await formOf(app, ['fail']);
    process.stdout.write(`${unknown.code},${bare.code}\n`);
  },
  /** Each instance's code, read from the form invoke() resolves with. */
  inherited: async () => {
    const codes = {};
    for (const [name, Class] of Object.entries({ BareError, DirectError, NestedPathError })) {
      const form = await formOf(raising(() => new Class('Failed.')));
      codes[name] = form.code;
    }
    process.stdout.write(`${JSON.stringify(codes)}\n`);
  },
  /** An invalid class constructed inside a run reports the fault by build. */
  invalid: async () => {
    const code = await raising(() => new invalid[process.env.FIXTURE_CLASS]('Never.')).run({
      host: { argv: [] },
    });
    process.stdout.write(`resolved:${String(code)}\n`);
  },
  /** A class whose static changes between two constructions keeps its first code. */
  reassigned: async () => {
    class MovingError extends FatalError {
      static code = 'first-code';

      constructor(message) {
        super(message);
        this.name = 'MovingError';
      }
    }
    const first = await formOf(raising(() => new MovingError('First.')));
    MovingError.code = 'second-code';
    const second = await formOf(raising(() => new MovingError('Second.')));
    process.stdout.write(`${first.code},${second.code}\n`);
  },
  /** Every core class's code, and the author classes' inherited ones, read without an instance. */
  statics: () => {
    const codes = Object.fromEntries(
      Object.entries({ ...coreClasses, BareError, DirectError, NestedPathError }).map(
        ([name, Class]) => [name, Class.code],
      ),
    );
    process.stdout.write(`${JSON.stringify(codes)}\n`);
  },
};

await scenarios[scenario]();
