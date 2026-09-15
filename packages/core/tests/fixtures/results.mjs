import { Writable } from 'node:stream';
import { setTimeout as after } from 'node:timers/promises';

import {
  Application,
  Command,
  FatalError,
  InternalError,
  lanes,
  override,
  plugin,
  ResultError,
  style,
} from '@loomcli/core';

const scenario = process.argv[2];

const rows = [{ source: 'one.txt' }, { source: 'two words.txt' }];

/** What one scenario watched: every write its own destination completed, in order. */
const events = [];

/** The row view a rows declaration names: one head, one line per row, one tail. */
const list = {
  head: () => 'PATHS\n',
  row: (row, index) => `${index}: ${row.source}\n`,
  tail: () => 'END\n',
};

/** The whole view over the collected rows, which renders once at the end of the source. */
const collected = { render: (all) => `${all.length} rows\n` };

/** The whole view of a value result. */
const table = { render: ({ total }) => `total ${total}\n` };

/** The same rows from a synchronous source. */
function* walk() {
  yield* rows;
}

/** The same rows from an asynchronous source, one microtask apart. */
async function* streamed() {
  for (const row of rows) {
    await Promise.resolve();
    yield row;
  }
}

/** A slow source, so an unawaited result is still pending when the action returns. */
async function* delayed() {
  for (const row of rows) {
    await after(40);
    yield row;
  }
}

/** A destination that records what reached it, so one capture reads both streams in order. */
function capture() {
  return new Writable({
    write(chunk, encoding, callback) {
      events.push(chunk.toString());
      callback();
    },
  });
}

/** The one destination the ordering scenario gives both streams. */
const shared = scenario === 'order' ? capture() : undefined;

/** What each scenario declares: one value, a sequence under either view shape, or nothing. */
const declarations = {
  array: 'row',
  async: 'row',
  'empty-row': 'row',
  'empty-whole': 'whole',
  'failure-first': 'value',
  'internal-override': 'value',
  'middleware-no-dispatch': 'value',
  'middleware-print': 'value',
  'middleware-results': 'value',
  missing: 'value',
  'missing-root': 'value',
  order: 'row',
  'override-scope': 'none',
  plain: 'none',
  redirect: 'value',
  repeated: 'value',
  'repeated-awaited': 'value',
  'result-override': 'value',
  sync: 'row',
  unawaited: 'row',
  undeclared: 'none',
  value: 'value',
  whole: 'whole',
};

/** Everything the action of one scenario writes, beside the result it emits. */
async function beside(out) {
  await out.print(style.red('plain'));
  await out.render('rendered\n', { render: (text) => text });
  await out.render(rows, list);
  await out.render('laned\n', lanes.print);
}

async function act({ out }) {
  switch (scenario) {
    case 'value': {
      await out.results({ total: 3 });
      break;
    }
    case 'array': {
      await out.results(rows);
      break;
    }
    case 'sync': {
      await out.results(walk());
      break;
    }
    case 'async': {
      await out.results(streamed());
      break;
    }
    case 'whole': {
      await out.results(streamed());
      break;
    }
    case 'empty-row':
    case 'empty-whole': {
      await out.results([]);
      break;
    }
    case 'order': {
      await out.results(rows);
      await out.info('done');
      break;
    }
    case 'unawaited': {
      // The action returns at once, so the rows arrive only because the result is open output.
      out.results(delayed());
      break;
    }
    case 'redirect': {
      await beside(out);
      await out.results({ total: 1 });
      break;
    }
    case 'plain': {
      await beside(out);
      break;
    }
    case 'middleware-print':
    case 'middleware-results': {
      await out.results({ total: 1 });
      break;
    }
    case 'repeated': {
      await out.results({ total: 1 });
      out.results({ total: 2 });
      break;
    }
    case 'repeated-awaited': {
      await out.results({ total: 1 });
      await out.results({ total: 2 });
      break;
    }
    case 'undeclared': {
      out.results({ total: 1 });
      break;
    }
    case 'override-scope': {
      throw new Error('the action failed');
    }
    case 'failure-first': {
      throw new FatalError('The failure came first.');
    }
    case 'internal-override':
    case 'result-override':
    case 'missing':
    case 'missing-root':
    case 'middleware-no-dispatch': {
      break;
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

/** The middleware one scenario installs, which writes through the channel every middleware has. */
async function middleware({ next, out }) {
  if (scenario === 'middleware-no-dispatch') {
    return;
  }
  if (scenario === 'middleware-results') {
    out.results({ total: 9 });
  }
  await out.print('before');
  await next();
  await out.print('after');
}

/** The plugins one scenario installs, which is one always-on middleware or none. */
function plugins() {
  const installed = ['middleware-no-dispatch', 'middleware-print', 'middleware-results'];
  return installed.includes(scenario)
    ? [
        plugin('@fixture/wrapper', {
          middleware: { activate: 'always', load: () => ({ default: middleware }) },
        }),
      ]
    : [];
}

/** The overrides one scenario lists, which reach a results-lane fault by class. */
function views() {
  const branded = override(InternalError, {
    render: (failure) => `branded:${failure.message}\n`,
  });
  if (scenario === 'internal-override') {
    return [branded];
  }
  if (scenario === 'result-override' || scenario === 'override-scope') {
    return [
      branded,
      override(ResultError, {
        render: (failure) =>
          `result:${failure.kind}:${failure.path.join(' ')}:${String(failure.cause)}\n`,
      }),
    ];
  }
  return [];
}

/** The Command one scenario routes to, declared as the unit the scenario names. */
function routed() {
  const declared = declarations[scenario];
  if (declared === 'none') {
    return new Command('plain').action(act);
  }
  const command = new Command('count');
  const withResult =
    declared === 'value'
      ? command.result({ views: { table } })
      : command.rows({ views: declared === 'row' ? { list } : { collected } });
  return withResult.action(act);
}

/** The root answers one scenario itself; every other routes to a named child. */
function build() {
  const options = { plugins: plugins(), views: views() };
  return scenario === 'missing-root'
    ? new Application('results', options).result({ views: { table } }).action(act)
    : new Application('results', options).command(routed());
}

/** The routed tokens one scenario supplies, which name the Command it declared. */
function argv() {
  if (scenario === 'missing-root') {
    return [];
  }
  return declarations[scenario] === 'none' ? ['plain'] : ['count'];
}

const code = await build().run({
  host: {
    argv: argv(),
    env: { TERM: 'linux' },
    platform: 'linux',
    stderr: shared ?? process.stderr,
    stdout: shared ?? process.stdout,
    terminal: {
      stderr: { isTTY: true },
      stdin: { isTTY: false },
      stdout: { isTTY: false },
    },
  },
});
if (events.length > 0) {
  process.stdout.write(`${JSON.stringify(events)}\n`);
}
process.stdout.write(`resolved:${code}\n`);
