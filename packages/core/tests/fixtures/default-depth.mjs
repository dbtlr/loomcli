import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

const act = () => undefined;

const accepting = {
  '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
};

/** A default whose containers nest `levels` deep along one path, alternating lists and objects. */
function nested(levels) {
  let value = 'leaf';
  for (let level = levels; level > 0; level -= 1) {
    value = level % 2 === 0 ? { inner: value } : [value];
  }
  return value;
}

/**
 * A config that declares `value` as its default, under a validator that accepts anything, except
 * on a plugin option, which declares no validator.
 */
const configOf = (call, value) =>
  call === 'plugin'
    ? { default: value, type: 'string' }
    : { default: value, type: 'string', validate: accepting };

/** Each declaring call, made with one config and the graph built over it. */
const declare = {
  argument: (config) =>
    new Application('probe')
      .command(new Command('get').argument('path', config).action(act))
      .inspect(),
  global: (config) => new Application('probe').globalOption('format', config).action(act).inspect(),
  hook: (config) =>
    new Application('probe', {
      plugins: [
        plugin('@acme/probe', {
          onCommandAttach: (command) =>
            command.name === 'get' ? command.option('format', config) : command,
        }),
      ],
    })
      .command(new Command('get').action(act))
      .inspect(),
  option: (config) =>
    new Application('probe')
      .command(new Command('get').option('format', config).action(act))
      .inspect(),
  plugin: (config) =>
    new Application('probe', {
      plugins: [plugin('@acme/probe', { options: { format: config } })],
    }).inspect(),
};

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
      correction: error.correction,
      mark: error.findings.map((finding) => finding.mark),
      rule: error.rule?.identity,
      sentence: error.sentence,
    };
  }
}

const [call, levels, shape] = process.argv.slice(2);

/**
 * Each shape of default, `levels` deep. `shared` lists `levels - 1` lists, each holding the one
 * listed before it, so the walk reaches every one first at level 2 and the deepest path runs
 * through all of them. `cycle` is a nest inside a list that also holds itself, and `indirect` a
 * nest beside an object that holds the list both sit in.
 */
const shapes = {
  cycle: (count) => {
    const list = [nested(count - 1)];
    list.push(list);
    return list;
  },
  indirect: (count) => {
    const inner = { back: undefined };
    const list = [nested(count - 1), inner];
    inner.back = list;
    return list;
  },
  shared: (count) => {
    const chain = [];
    let inner = 'leaf';
    for (let index = 1; index < count; index += 1) {
      inner = [inner];
      chain.push(inner);
    }
    return chain;
  },
  straight: nested,
};

const value = shapes[shape](Number(levels));
console.log(JSON.stringify(outcome(() => declare[call](configOf(call, value)))));
