import { Application, Command, DeclarationError, diagnosticRule, plugin } from '@loomcli/core';

// Prints what check(), run(), or inspect() answers for one declaration, from source or a bundle.
const [scenario, mode] = process.argv.slice(2);

/** A validator whose JSON Schema converter throws, which a development build reports. */
function unconvertible(reason) {
  return {
    '~standard': {
      jsonSchema: {
        input: () => {
          throw new Error(reason);
        },
        output: () => ({}),
      },
      validate: (value) => ({ value }),
      vendor: 'probe',
      version: 1,
    },
  };
}

/** A validator that accepts a string of digits alone. */
const digits = {
  '~standard': {
    validate: (value) =>
      typeof value === 'string' && /^\d+$/u.test(value)
        ? { value }
        : { issues: [{ message: 'Use a whole number.' }] },
    vendor: 'probe',
    version: 1,
  },
};

const shared = diagnosticRule('@fixture/judge/shared-name', {
  explanation: 'Each Command answers to a name of its own.',
  headline: 'Shared name',
});

/** Every graph each hook received, in the order the hooks ran. */
const received = [];

/** A plugin whose hook rejects every graph it judges. */
const rejecting = plugin('@fixture/judge', {
  onGraphBuilt: (graph) => {
    received.push(graph);
    throw new DeclarationError(shared, { sentence: 'The graph shares a name.' });
  },
});

/** A plugin whose hook accepts every graph, installed after the one that rejects. */
const accepting = plugin('@fixture/accept', {
  onGraphBuilt: (graph) => {
    received.push(graph);
  },
});

/** A plugin whose hook breaks with a foreign error. */
const breaking = plugin('@fixture/break', {
  onGraphBuilt: () => {
    throw new TypeError('The hook broke.');
  },
});

const declarations = {
  // A hook that breaks with a foreign error.
  'broken-hook': () =>
    new Application('probe', { description: 'Probe the checks.', plugins: [breaking] }).action(
      ({ out }) => out.print('ran'),
    ),
  // A root with neither children nor an action, which ends the build.
  'build-fault': () =>
    new Application('probe', { description: 'Probe the checks.', plugins: [accepting] }),
  // A declared default its validator rejects, which only a run validates.
  defaults: () =>
    new Application('probe', { description: 'Probe the checks.' })
      .option('limit', {
        default: 'x',
        description: 'The limit.',
        type: 'string',
        validate: digits,
      })
      .action(({ out }) => out.print('ran')),
  // Two failing converters, an undescribed option, and a hook that rejects the graph.
  faults: () =>
    new Application('probe', { description: 'Probe the checks.', plugins: [rejecting, accepting] })
      .globalOption('level', {
        description: 'The level.',
        type: 'string',
        validate: unconvertible('No level schema.'),
      })
      .command(
        new Command('get', { description: 'Get one value.' })
          .option('limit', {
            description: 'The limit.',
            type: 'string',
            validate: unconvertible('No limit schema.'),
          })
          .option('quiet', { type: 'boolean' })
          .action(({ out }) => out.print('ran')),
      ),
};

const app = declarations[scenario]();
if (mode === 'run') {
  process.exitCode = await app.run({ host: { argv: scenario === 'faults' ? ['get'] : [] } });
} else if (mode === 'inspect') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ rule: error.rule?.identity, sentence: error.sentence })}\n`,
    );
  }
} else {
  const faults = app.check();
  const [graph] = received;
  process.stdout.write(
    `${JSON.stringify({
      faults: faults.map((fault) => ({
        // The message holds the whole Developer Diagnostic, which opens with the rule's banner.
        banner: fault.message.split('\n')[0],
        declaration: fault instanceof DeclarationError,
        rule: fault.rule?.identity,
        sentence: fault.sentence,
      })),
      // Every hook received one frozen graph, in which each failed converter's schema reads null.
      hooks: {
        calls: received.length,
        frozen: graph === undefined ? null : Object.isFrozen(graph),
        same: received.every((each) => each === graph),
        schemas:
          graph === undefined
            ? null
            : [graph.globals[0]?.schema, graph.root.children[0]?.options[0]?.schema],
      },
      list: Array.isArray(faults),
    })}\n`,
  );
}
