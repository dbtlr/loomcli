import {
  Application,
  Command,
  DeclarationError,
  FatalError,
  LoomError,
  override,
  plugin,
} from '@loomcli/core';

// Each run prints what a failure view and an `onFailure` hook read of the run's selection.
// The first argument names the application, and the rest are the run's words.
const [shape, ...words] = process.argv.slice(2);

/** A validator that accepts each listed name and rejects every other value. */
function oneOf(names) {
  return {
    '~standard': {
      validate: (value) =>
        names.includes(value)
          ? { value }
          : { issues: [{ message: `Supply one of ${names.join(', ')}.` }] },
      vendor: 'fixture',
      version: 1,
    },
  };
}

/** A validator that accepts decimal digits alone. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value) ? { value } : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

/** The line one reader writes for the selection it read. */
function line(reader, { mediaType, view }) {
  return `${reader}:${String(view)}:${String(mediaType)}`;
}

/**
 * A plugin whose global `--pick` selects the view through its middleware, as the formatter selects
 * one through `--format`, and whose hook reports the selection the failure's hook context reads.
 * `bad` passes the validator and names no view.
 */
const selecting = plugin('@fixture/selecting', {
  middleware: {
    activate: 'always',
    load: async () => ({
      default: async (context) => {
        const picked = context.options?.pick;
        if (context.view !== null && typeof picked === 'string') {
          context.view = picked;
        }
        await context.next();
      },
    }),
  },
  onFailure: (_failure, context) => line('hook', context),
  options: { pick: { type: 'string', validate: oneOf(['table', 'json', 'bad']) } },
});

/** A failure view that reports the selection its context reads, then each hint. */
const reporting = override(LoomError, {
  render: (_failure, context) =>
    [line('view', context), ...context.hints].map((text) => `${text}\n`).join(''),
});

const render = (data) => `${JSON.stringify(data)}\n`;

/** A Command that declares a result and fails after the boundary dispatched its action. */
const list = new Command('list')
  .option('depth', { type: 'string', validate: digits })
  .rows({ views: { json: { mediaType: 'application/json', render }, table: { render } } })
  .views({}, { default: 'table' })
  .action(() => {
    throw new FatalError('Refused.');
  });

/** A Command whose default view declares a media type. */
const wire = new Command('wire')
  .result({ views: { json: { mediaType: 'application/json', render }, text: { render } } })
  .views({}, { default: 'json' })
  .action(() => {
    throw new FatalError('Refused.');
  });

/** A Command that declares no result. */
const get = new Command('get').action(() => {
  throw new FatalError('Refused.');
});

/** A plugin that rejects every graph it judges, so each run fails at build. */
const judging = plugin('@fixture/judging', {
  onGraphBuilt: () => {
    throw new DeclarationError('The graph is rejected.');
  },
});

const shapes = {
  build: () =>
    new Application('picks', { plugins: [selecting, judging], views: [reporting] }).command(list),
  default: () =>
    new Application('picks', { plugins: [selecting], views: [reporting] })
      .globalOption('limit', { default: 'x', type: 'string', validate: digits })
      .command(list),
  plain: () =>
    new Application('picks', { plugins: [selecting], views: [reporting] })
      .command(list)
      .command(wire)
      .command(get),
};

const app = shapes[shape]();
if (process.env.FIXTURE_BY_NAME === undefined) {
  await app.run({ host: { argv: words } });
} else {
  const [path, view] = JSON.parse(process.env.FIXTURE_BY_NAME);
  const outcome = await app.invoke(path, {}, { view });
  process.stderr.write(outcome.messages);
}
