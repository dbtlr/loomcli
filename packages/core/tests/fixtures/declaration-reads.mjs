import {
  Application,
  Command,
  DeclarationError,
  extension,
  InputError,
  override,
  plugin,
  style,
  translate,
  view,
} from '@loomcli/core';

const act = () => undefined;
const load = () => Promise.resolve({ default: act });
const render = () => '';

/** The value every unreadable read throws, so a test reads that the fault keeps it as its cause. */
const boom = new Error('boom');

const accepting = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};
const note = extension('@acme/probe/command', { schema: accepting, target: 'command' });
const tag = extension('@acme/probe/option', { schema: accepting, target: 'option' });

/**
 * A well-formed declaration for each declaring call, built fresh for each case. Every slot core
 * reads holds a value of the kind core reads there.
 */
const declarations = {
  application: () => ({
    description: 'Probe the reads.',
    extensions: [note('x')],
    packet: { build: 'distributed' },
    plugins: [plugin('@acme/log', {})],
    rendering: { color: 'auto' },
    translators: [translate(SyntaxError, act)],
    version: '1.0.0',
    views: [override(InputError, { render })],
  }),
  command: () => ({
    deprecated: 'Use fetch.',
    description: 'Get one.',
    extensions: [note('x')],
    hidden: false,
  }),
  plugin: () => ({
    commands: [new Command('check').action(act)],
    extensions: [tag],
    middleware: { activate: ['level'], load },
    onCommandAttach: (command) => command,
    onFailure: () => undefined,
    options: { level: { type: 'string' } },
    signals: ['SIGINT'],
    source: { binding: tag, load },
    theme: { highlight: style.cyan },
    translators: [translate(SyntaxError, act)],
    views: [view('@acme/probe/page', { render })],
  }),
};

/** Each call made with one declaration, and the graph built over it. */
const declare = {
  application: (options) => new Application('probe', options).action(act).inspect(),
  command: (options) =>
    new Application('probe').command(new Command('get', options).action(act)).inspect(),
  plugin: (definition) =>
    new Application('probe', { plugins: [plugin('@acme/probe', definition)] }).inspect(),
};

/** Each call made with an invalid name and the declaration it receives. */
const misnamed = {
  application: (options) => new Application('bad name', options),
  command: (options) => new Command('bad name', options),
  plugin: (definition) => plugin('Help', definition),
};

/** The object a dotted path leads to inside a declaration, and the last key, which it holds. */
function holderOf(declaration, path) {
  const keys = path.split('.');
  const last = keys.pop();
  return { holder: keys.reduce((value, key) => value[key], declaration), key: last };
}

/**
 * The declaration with one read made to throw. `getter <path>` makes the key at the path a getter
 * that throws, `<trap>` puts the whole declaration behind a proxy whose trap throws, and
 * `<trap> <path>` puts the value at the path behind one.
 */
function unreadable(declaration, spec) {
  const [kind, path] = spec.split(' ');
  const throws = () => {
    throw boom;
  };
  if (kind === 'getter') {
    const { holder, key } = holderOf(declaration, path);
    Object.defineProperty(holder, key, { configurable: true, enumerable: true, get: throws });
    return declaration;
  }
  if (path === undefined) {
    return new Proxy(declaration, { [kind]: throws });
  }
  const { holder, key } = holderOf(declaration, path);
  holder[key] = new Proxy(holder[key], { [kind]: throws });
  return declaration;
}

/**
 * The declaration with a counting getter on every top-level key and on each nested path given, so
 * the counts say how many times core read each one.
 */
function counted(declaration, nested) {
  const reads = {};
  // Every holder is found before any getter is defined, so finding one counts no read.
  const places = [...Object.keys(declaration), ...nested].map((path) => [
    path,
    holderOf(declaration, path),
  ]);
  for (const [path, { holder, key }] of places) {
    const value = holder[key];
    reads[path] = 0;
    Object.defineProperty(holder, key, {
      configurable: true,
      enumerable: true,
      get() {
        reads[path] += 1;
        return value;
      },
    });
  }
  return { declaration, reads };
}

/** How one call ended: the fault it threw, read through its public parts, or what escaped. */
function outcome(run) {
  try {
    run();
    return 'returned';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      return `escaped ${String(error)}`;
    }
    return {
      cause: error.cause === boom,
      mark: error.findings.map((finding) => finding.mark),
      rule: error.rule?.identity,
      sentence: error.sentence,
    };
  }
}

const [mode, call, ...rest] = process.argv.slice(2);

const modes = {
  // The declaration is unreadable as a whole, so the name's fault shows the name is judged first.
  name: () => {
    const ended = outcome(() => misnamed[call](unreadable(declarations[call](), 'ownKeys')));
    return typeof ended === 'string' ? ended : ended.rule;
  },
  // The nested paths to count follow the call, and the result maps each read path to its count.
  once: () => {
    const { declaration, reads } = counted(declarations[call](), rest);
    const ended = outcome(() => declare[call](declaration));
    return { ended, reads };
  },
  // Each spec names one read made to throw, and the result maps it to the call's outcome.
  unreadable: () =>
    Object.fromEntries(
      rest.map((spec) => [
        spec,
        outcome(() => declare[call](unreadable(declarations[call](), spec))),
      ]),
    ),
};

process.stdout.write(`${JSON.stringify(modes[mode]())}\n`);
