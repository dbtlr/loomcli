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
const label = extension('@acme/probe/label', { schema: accepting, target: 'option' });

/**
 * A well-formed declaration for each declaring call, built fresh for each case. Every slot core
 * reads holds a value of the kind core reads there.
 */
const declarations = {
  application: () => ({
    description: 'Probe the reads.',
    extensions: [note('x')],
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
  option: () => ({
    default: 'plain',
    description: 'Format.',
    extensions: [label('x')],
    type: 'string',
  }),
  plugin: () => ({
    commands: [new Command('check').action(act)],
    extensions: [tag],
    middleware: { activate: ['level'], load },
    onCommandAttach: (command) => command,
    onFailure: () => undefined,
    options: { level: { extensions: [label('x')], type: 'string' } },
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
  option: (config) =>
    new Application('probe')
      .command(new Command('get').option('format', config).action(act))
      .inspect(),
  plugin: (definition) =>
    new Application('probe', { plugins: [plugin('@acme/probe', definition)] }).inspect(),
};

/** Each call made with an invalid name and the declaration it receives. */
const misnamed = {
  application: (options) => new Application('bad name', options),
  argument: (config) => new Command('get').argument('-path', config),
  command: (options) => new Command('bad name', options),
  global: (config) => new Application('probe').globalOption('-format', config),
  option: (config) => new Command('get').option('-format', config),
  plugin: (definition) => plugin('Help', definition),
};

/** The declaration each misnamed call receives: its own, or an input's config for an input call. */
const misnamedDeclaration = (call) => (declarations[call] ?? declarations.option)();

/** The fact each call's graph reads back from the declaration, so a dropped part shows. */
const factOf = {
  application: (graph) => graph.description,
  command: (graph) => graph.root.children[0].description,
  option: (graph) => graph.root.children[0].options[0].default,
  plugin: (graph) => graph.globals.map((option) => option.name),
};

/** The plain objects and lists each declaration holds, which the trap counts watch. */
const parts = {
  application: ['rendering', 'plugins', 'views', 'translators', 'extensions'],
  command: ['extensions'],
  option: ['extensions'],
  plugin: [
    'theme',
    'options',
    'options.level',
    'options.level.extensions',
    'middleware',
    'middleware.activate',
    'source',
    'extensions',
    'signals',
    'commands',
    'views',
    'translators',
  ],
};

/** How many keys deep a dotted path reaches. */
const depth = (path) => path.split('.').length;

/** The traps a read of a plain object or a list runs. */
const traps = ['getOwnPropertyDescriptor', 'get', 'getPrototypeOf', 'has', 'ownKeys'];

/**
 * The declaration with each part, and the whole, behind a proxy that counts every trap by part and
 * key. Deeper parts are wrapped first, so wrapping a holder never reads through a counting proxy.
 */
function watched(declaration, paths) {
  const counts = new Map();
  const watch = (part, target) =>
    new Proxy(
      target,
      Object.fromEntries(
        traps.map((trap) => [
          trap,
          (...args) => {
            const key = trap === 'getPrototypeOf' || trap === 'ownKeys' ? '' : String(args[1]);
            const name = `${part} ${trap} ${key}`;
            counts.set(name, (counts.get(name) ?? 0) + 1);
            return Reflect[trap](...args);
          },
        ]),
      ),
    );
  const deepestFirst = paths.toSorted((first, second) => depth(second) - depth(first));
  for (const path of deepestFirst) {
    const { holder, key } = holderOf(declaration, path);
    holder[key] = watch(path, holder[key]);
  }
  return { counts, declaration: watch('whole', declaration) };
}

/**
 * The declaration with the part at `path`, or the whole, behind a proxy whose prototype reads as
 * `Object.prototype` once and as `second` after: a throw, or `Array.prototype`.
 */
function flipping(declaration, path, second) {
  let reads = 0;
  const flip = (target) =>
    new Proxy(target, {
      getPrototypeOf() {
        reads += 1;
        if (reads === 1) {
          return Object.prototype;
        }
        if (second === 'throws') {
          throw boom;
        }
        return Array.prototype;
      },
    });
  if (path === '') {
    return flip(declaration);
  }
  const { holder, key } = holderOf(declaration, path);
  holder[key] = flip(holder[key]);
  return declaration;
}

/** The declaration with its one key `key` defined as a data property that is not enumerable. */
function hiddenKey(declaration, key) {
  const { [key]: value } = declaration;
  Object.defineProperty(declaration, key, { configurable: true, enumerable: false, value });
  return declaration;
}

/** The key each call's non-enumerable case hides, whose fact the graph reads back. */
const hiddenKeys = {
  application: 'description',
  command: 'description',
  option: 'default',
  plugin: 'options',
};

/** The object a dotted path leads to inside a declaration, and the last key, which it holds. */
function holderOf(declaration, path) {
  const keys = path.split('.');
  const last = keys.pop();
  return { holder: keys.reduce((value, key) => value[key], declaration), key: last };
}

/** A read that fails with the fixture's error. */
function throws() {
  throw boom;
}

/**
 * The declaration with one read made to throw. `getter <path>` makes the key at the path a getter
 * that throws, `<trap>` puts the whole declaration behind a proxy whose trap throws, and
 * `<trap> <path>` puts the value at the path behind one.
 */
function unreadable(declaration, spec) {
  const [kind, path] = spec.split(' ');
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
  // A part whose prototype reads plain once and not plain after is judged by the first read.
  flip: () => {
    const [path = '', second] = rest;
    let fact = undefined;
    const declaration = flipping(declarations[call](), path, second);
    const ended = outcome(() => {
      fact = factOf[call](declare[call](declaration));
    });
    return { ended, fact };
  },
  // A key that is not enumerable is read like any other own key.
  hidden: () => {
    let fact = undefined;
    const declaration = hiddenKey(declarations[call](), hiddenKeys[call]);
    const ended = outcome(() => {
      fact = factOf[call](declare[call](declaration));
    });
    return { ended, fact };
  },
  // A verdict one declaring call reached answers no later call: each part changes its prototype after.
  later: () => {
    const foreign = { kind: 'foreign' };
    const rendering = Object.create(foreign);
    rendering.color = 'auto';
    const before = outcome(() => new Application('probe', { rendering }));
    Object.setPrototypeOf(rendering, Object.prototype);
    const after = outcome(() => new Application('probe', { rendering }));
    const definition = { views: [] };
    plugin('@acme/probe', definition);
    Object.setPrototypeOf(definition, foreign);
    const reused = outcome(() => plugin('@acme/probe', definition));
    return { after, before, reused };
  },
  // The plugins list reports a length of 1 and then 3, and the views list overrides forEach.
  lists: () => {
    let lengthReads = 0;
    let forEachCalls = 0;
    const plugins = new Proxy([plugin('@acme/probe', {})], {
      get(target, key) {
        if (key === 'length') {
          lengthReads += 1;
          return lengthReads === 1 ? 1 : 3;
        }
        return Reflect.get(target, key);
      },
    });
    const views = [view('@acme/probe/page', { render })];
    views.forEach = () => {
      forEachCalls += 1;
    };
    const ended = outcome(() =>
      new Application('probe', { plugins: [plugin('@acme/other', { views })] })
        .action(act)
        .inspect(),
    );
    const installed = outcome(() => new Application('probe', { plugins }).action(act).inspect());
    return { ended, forEachCalls, installed, lengthReads };
  },
  // The declaration's name is invalid, so its fault reads no part of the declaration.
  name: () => {
    const { counts, declaration } = watched(misnamedDeclaration(call), parts[call] ?? parts.option);
    const ended = outcome(() => misnamed[call](declaration));
    return { reads: counts.size, rule: typeof ended === 'string' ? ended : ended.rule };
  },
  // The nested paths to count follow the call, and the result maps each read path to its count.
  once: () => {
    const { declaration, reads } = counted(declarations[call](), rest);
    const ended = outcome(() => declare[call](declaration));
    return { ended, reads };
  },
  // Every trap a part runs is counted by part and key, and the result lists each that ran twice.
  traps: () => {
    const { counts, declaration } = watched(declarations[call](), parts[call]);
    const ended = outcome(() => declare[call](declaration));
    const read = new Set([...counts.keys()].map((name) => name.split(' ')[0]));
    return {
      ended,
      twice: [...counts].filter(([, count]) => count > 1).map(([name]) => name),
      unread: ['whole', ...parts[call]].filter((part) => !read.has(part)),
    };
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
