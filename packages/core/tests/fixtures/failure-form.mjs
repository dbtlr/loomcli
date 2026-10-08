import { Application, Command, DeclarationError, FatalError, plugin, style } from '@loomcli/core';

const [scenario, build = 'distributed'] = process.argv.slice(2);

/** The release facts one run reads, which decide whether a defect shows its Developer Diagnostic. */
const release = { build };

/** A validator that accepts decimal digits alone. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value) ? { value } : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/** Prints one line of JSON to stdout, the fixture's report. */
function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/** A plugin whose `onFailure` hook returns the hints `answer` gives. */
function hinting(identity, answer) {
  return plugin(identity, { onFailure: answer });
}

/** An application whose action throws what `raise` returns. */
function raising(raise, plugins = []) {
  return new Application('forms', {
    description: 'The forms application.',
    plugins,
  }).action(() => {
    throw raise();
  });
}

const scenarios = {
  /** A broken hook forces 1 on the outcome while the form keeps the failure's own code. */
  'broken-hook': async () => {
    const breaking = hinting('@fixture/breaking', () => {
      throw new Error('Broken.');
    });
    const app = new Application('forms', {
      description: 'The forms application.',
      plugins: [breaking],
    }).command(new Command('get', { description: 'The get command.' }).action(() => undefined));
    const outcome = await app.invoke(['nope'], {}, { host: { release } });
    print({ exitCode: outcome.exitCode, form: outcome.form });
  },
  /** A build fault runs no hook, so its form holds no hint. */
  'build-fault': async () => {
    const judging = plugin('@fixture/judging', {
      onFailure: () => 'Never.',
      onGraphBuilt: () => {
        throw new DeclarationError('The graph is rejected.');
      },
    });
    const outcome = await raising(() => new FatalError('Never.'), [judging]).invoke(
      [],
      {},
      { host: { release } },
    );
    print({ exitCode: outcome.exitCode, form: outcome.form });
  },
  /** A defect reads by build, and no form holds a stack frame. */
  defect: async () => {
    const outcome = await raising(() => new TypeError('Cannot read the value.')).invoke(
      [],
      {},
      { host: { release } },
    );
    print(outcome.form);
  },
  /** The form of a fatal failure, and the handler's form beside the outcome's. */
  fatal: async () => {
    let handled = undefined;
    const outcome = await raising(() => new FatalError('The registry is down.')).invoke(
      [],
      {},
      {
        failure: (failure, context) => {
          handled = context.form;
          return failure;
        },
        host: { release },
      },
    );
    print({
      exitCode: outcome.exitCode,
      form: outcome.form,
      frozen: Object.isFrozen(outcome.form) && Object.isFrozen(outcome.form.hints),
      keys: Object.keys(outcome.form),
      same: handled === outcome.form,
    });
  },
  /** An assignment to a form's member throws in strict mode code. */
  frozen: async () => {
    const outcome = await raising(() => new FatalError('Failed.')).invoke(
      [],
      {},
      { host: { release } },
    );
    try {
      outcome.form.code = 'other';
      print('assigned');
    } catch (error) {
      print(error.name);
    }
  },
  /** Two plugins' hints, in installation order. */
  hints: async () => {
    const outcome = await raising(
      () => new FatalError('Failed.'),
      [
        hinting('@fixture/first', () => 'First hint.'),
        hinting('@fixture/second', () => ['Second.', 'Third.']),
      ],
    ).invoke([], {}, { host: { release } });
    print(outcome.form.hints);
  },
  /** A marked message and a marked hint read as plain text. */
  plain: async () => {
    const marking = hinting('@fixture/marking', (_failure, context) =>
      context.style.bold('Run it again.'),
    );
    const outcome = await raising(
      () => new FatalError(`The ${style.bold('registry')} is down.`),
      [marking],
    ).invoke([], {}, { host: { release } });
    print(outcome.form);
  },
  /** An input error that reports two problems holds both lines. */
  'two-problems': async () => {
    const app = new Application('forms', { description: 'The forms application.' })
      .option('limit', { description: 'The limit.', type: 'string', validate: digits })
      .argument('path', { description: 'The path.', required: true })
      .action(() => undefined);
    const outcome = await app.invoke([], { options: { limit: 'x' } }, { host: { release } });
    print(outcome.form);
  },
};

await scenarios[scenario]();
