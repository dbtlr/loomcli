import { Application, Command, DeclarationError, GlobalOptions } from '@loom/core';

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

const dispatch = ({ out }) => out.print('dispatched');

// A declared `undefined` and a missing key both vanish from JSON, so the marker keeps them apart.
const encode = (value) =>
  JSON.stringify(value, (_key, item) => (item === undefined ? '#undefined' : item));

function jsonkit() {
  const globals = new GlobalOptions()
    .option('file', { required: true, short: 'f', type: 'string' })
    .option('quiet', { short: 'q', type: 'boolean' });
  const get = new Command('get', globals).argument('path', { required: true }).action(dispatch);
  const keys = new Command('keys', globals).argument('path', {}).action(dispatch);
  const select = new Command('select', globals)
    .option('field', { multiple: true, required: true, short: 'F', type: 'string' })
    .action(dispatch);
  return new Application('jsonkit', globals)
    .command(get)
    .command(keys)
    .command(select)
    .action(dispatch);
}

function nested() {
  const globals = new GlobalOptions();
  const clear = new Command('clear', globals).action(dispatch);
  const list = new Command('list', globals).action(dispatch);
  const cache = new Command('cache', globals).command(clear).command(list);
  return new Application('store', globals).command(cache).action(dispatch);
}

function polarity() {
  return new Application('flags')
    .option('total', { polarity: 'both', short: 't', type: 'boolean' })
    .option('color', { type: 'boolean' })
    .option('cache', { polarity: 'negative', type: 'boolean' })
    .option('mode', { short: 'm', shortOnly: true, type: 'string' })
    .action(dispatch);
}

// A name that begins with "no-" gives the negative form a doubled prefix.
// The role each entry records is the only reliable reading of a spelling.
function roles() {
  return new Application('roles')
    .option('no-color', { polarity: 'both', short: 'n', type: 'boolean' })
    .option('field', { multiple: true, short: 'F', shortOnly: true, type: 'string' })
    .action(dispatch);
}

function defaults() {
  return new Application('defaults')
    .option('depth', { default: '1', type: 'string' })
    .option('limit', { default: undefined, type: 'string', validate: digits })
    .option('plain', { type: 'string' })
    .argument('path', { default: 'root' })
    .action(dispatch);
}

function tails() {
  return new Application('tails')
    .argument('files', { default: ['a'], variadic: true })
    .action(dispatch);
}

function omission() {
  return new Application('omission')
    .option('file', { type: 'string', validate: digits, validateOmitted: true })
    .option('size', { type: 'string', validate: digits, validateOmitted: false })
    .argument('path', { validate: digits, validateOmitted: true })
    .action(dispatch);
}

function invalid() {
  const globals = new GlobalOptions();
  return new Application('invalid', globals).command(new Command('get', globals)).action(dispatch);
}

// Each of these builds cleanly, so only the declaration checks can reject it.
// A default that its schema rejects is the one fault inspection leaves to run().
const faults = {
  'boolean-default': () =>
    new Application('faults').option('total', { default: 'x', type: 'boolean' }).action(dispatch),
  'boolean-validate': () =>
    new Application('faults')
      .option('total', { type: 'boolean', validate: digits })
      .action(dispatch),
  'foreign-schema': () =>
    new Application('faults')
      .option('size', { type: 'string', validate: { parse: () => 1 } })
      .action(dispatch),
  'multiple-default': () =>
    new Application('faults')
      .option('field', { default: 'a', multiple: true, type: 'string' })
      .action(dispatch),
  'nonboolean-omitted': () =>
    new Application('faults')
      .option('file', { type: 'string', validate: digits, validateOmitted: 'yes' })
      .action(dispatch),
  'nonboolean-required': () =>
    new Application('faults').option('size', { required: 'yes', type: 'string' }).action(dispatch),
  'nonboolean-variadic': () =>
    new Application('faults').argument('files', { variadic: 'yes' }).action(dispatch),
  'null-omitted': () =>
    new Application('faults')
      .option('file', { type: 'string', validate: digits, validateOmitted: null })
      .action(dispatch),
  'numeric-omitted': () =>
    new Application('faults')
      .option('file', { type: 'string', validate: digits, validateOmitted: 0 })
      .action(dispatch),
  'required-default': () =>
    new Application('faults')
      .option('depth', { default: '1', required: true, type: 'string' })
      .action(dispatch),
  'schema-default': () =>
    new Application('faults')
      .option('depth', { default: 'deep', type: 'string', validate: digits })
      .action(dispatch),
  'undefined-omitted': () =>
    new Application('faults')
      .option('file', { type: 'string', validate: digits, validateOmitted: undefined })
      .action(dispatch),
};

const graphs = { defaults, invalid, jsonkit, nested, omission, polarity, roles, tails, ...faults };
const build = graphs[process.argv[2]];
const mode = process.argv[3];

if (mode === 'catch') {
  try {
    build().inspect();
    process.stdout.write(`${encode({ caught: false })}\n`);
  } catch (error) {
    process.stdout.write(
      `${encode({
        caught: error instanceof DeclarationError,
        message: error.message,
        name: error.name,
      })}\n`,
    );
  }
} else if (mode === 'run') {
  const code = await build().run({ host: { argv: [] } });
  process.stdout.write(`${encode({ code })}\n`);
} else if (mode === 'freeze') {
  const graph = build().inspect();
  const attempts = [];
  const record = (label, change) => {
    try {
      change();
      attempts.push({ label, rejected: false });
    } catch (error) {
      attempts.push({ label, rejected: error instanceof TypeError });
    }
  };
  record('name', () => {
    graph.name = 'other';
  });
  record('globals', () => {
    graph.globals.pop();
  });
  record('option', () => {
    graph.globals[0].name = 'other';
  });
  record('root', () => {
    graph.root.hasAction = false;
  });
  record('children', () => {
    graph.root.children.push(graph.root);
  });
  record('argument', () => {
    graph.root.children[0].arguments[0].required = false;
  });
  process.stdout.write(`${encode({ attempts, repeats: build().inspect().name })}\n`);
} else {
  process.stdout.write(`${encode(build().inspect())}\n`);
}
