import { Application, Command, DeclarationError, processHandle } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';

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

// The optional `version` lets a second graph key declare `0.0.0` explicitly.
// A test then compares that graph against an omitted version without duplicating the declaration.
function jsonkit(version) {
  const get = new Command('get').argument('path', { required: true }).action(dispatch);
  const keys = new Command('keys').argument('path', {}).action(dispatch);
  const select = new Command('select')
    .option('field', { multiple: true, required: true, short: 'F', type: 'string' })
    .action(dispatch);
  return new Application('jsonkit', {
    version,
  })
    .globalOption('file', { short: 'f', type: 'string' })
    .globalOption('quiet', { short: 'q', type: 'boolean' })
    .command(get)
    .command(keys)
    .command(select)
    .action(dispatch);
}

// Every target of a core fact declares one, so inspection reports each of them in place.
// The root node repeats the Application's description, which the graph carries too.
function described() {
  const get = new Command('get', { description: 'Reads one value.' })
    .argument('path', { description: 'The path to read.', required: true })
    .option('raw', { description: 'Prints the value unquoted.', type: 'boolean' })
    .action(dispatch);
  return new Application('described', {
    description: 'Reads a JSON document.',
    version: '1.2.0',
  })
    .globalOption('file', {
      description: 'The document to read.',
      short: 'f',
      type: 'string',
    })
    .command(get)
    .action(dispatch);
}

// A hidden or deprecated member is a fact for the projections, so inspection reports both in place.
// The root carries neither, so it reads the omitted values every other node reads.
function listing() {
  const fetch = new Command('fetch', { deprecated: 'Use get instead.' })
    .option('raw', { deprecated: 'Use --plain instead.', hidden: true, type: 'string' })
    .action(dispatch);
  const debug = new Command('debug', { hidden: true }).action(dispatch);
  return new Application('listing')
    .globalOption('file', { deprecated: 'Use --path instead.', short: 'f', type: 'string' })
    .globalOption('quiet', { hidden: true, type: 'boolean' })
    .command(fetch)
    .command(debug)
    .action(dispatch);
}

function nested() {
  const clear = new Command('clear').action(dispatch);
  const list = new Command('list').alias('ls').alias('l').action(dispatch);
  const cache = new Command('cache').alias('c').command(clear).command(list);
  return new Application('store').command(cache).action(dispatch);
}

// A declared result is a graph fact.
// Inspection reports its unit, its names in record order, and the default a call moved.
function results() {
  const table = { render: (value) => `${String(value.count)}\n` };
  const wide = { render: (value) => `${String(value.count)} rows\n` };
  const list = { row: (row) => `${row.path}\n` };
  const count = new Command('count').result({ views: { table } }).action(dispatch);
  const paths = new Command('paths')
    .rows({ views: { list, table } })
    .views({ wide }, { default: 'wide' })
    .action(dispatch);
  const plain = new Command('plain').action(dispatch);
  return new Application('results').command(count).command(paths).command(plain).action(dispatch);
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

/** A root with neither children nor an action, which is final only when the graph builds. */
function invalid() {
  return new Application('invalid');
}

// A default that its schema rejects waits for run().
const faults = {
  'schema-default': () =>
    new Application('faults')
      .option('depth', { default: 'deep', type: 'string', validate: digits })
      .action(dispatch),
};

const graphs = {
  defaults,
  described,
  invalid,
  jsonkit,
  'jsonkit-versioned': () => jsonkit('0.0.0'),
  listing,
  nested,
  omission,
  polarity,
  results,
  roles,
  tails,
  ...faults,
};
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
        message: ruleText(error),
        name: error.name,
      })}\n`,
    );
  }
} else if (mode === 'run') {
  const code = await build().run({
    process: processHandle({ argv: [], release: { build: 'distributed' } }),
  });
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
  record('aliases', () => {
    graph.root.children[0].aliases.push('other');
  });
  process.stdout.write(`${encode({ attempts, repeats: build().inspect().name })}\n`);
} else {
  process.stdout.write(`${encode(build().inspect())}\n`);
}
