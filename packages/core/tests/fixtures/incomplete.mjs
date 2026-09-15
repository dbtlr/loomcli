import { Writable } from 'node:stream';
import { setTimeout as after } from 'node:timers/promises';

import {
  Application,
  Command,
  FatalError,
  incompleteResult,
  InputError,
  override,
} from '@loomcli/core';

const scenario = process.argv[2];

const rows = [{ source: 'one.txt' }, { source: 'two words.txt' }];

/** What one scenario watched: the writes a destination was given, or the rows a source gave. */
const events = [];

/** The caller's own signal, which every cancelling scenario aborts from inside its source. */
const controller = new AbortController();

/** The row view a rows declaration names: one head, one line per row, one tail. */
const list = {
  head: () => 'PATHS\n',
  row: (row, index) => `${index}: ${row.source}\n`,
  tail: () => 'END\n',
};

/** A row view that fails on the second row, so the pieces before it stand. */
const breaking = {
  head: () => 'PATHS\n',
  row: (row, index) => {
    if (index === 1) {
      throw scenario === 'view-row-class'
        ? new InputError('The view refused.', [])
        : new Error('Cannot render the row.');
    }
    return `${index}: ${row.source}\n`;
  },
};

/** The whole view one scenario renders through, which answers once at the end of the source. */
const collected = { render: (all) => `${all.length} rows\n` };

/** A whole view that fails once the source has ended, so nothing of the sequence is written. */
const brokenWhole = {
  render: () => {
    throw new Error('Cannot render the table.');
  },
};

/** A whole view that returns a number, which is no text at all. */
const countedWhole = { render: (all) => all.length };

/** The failure one source raises, whose own code the awaited call reports. */
function sourceFailure() {
  return scenario === 'source-awaited' || scenario === 'source-deferred'
    ? new InputError('The source failed.', [])
    : new FatalError('The source failed.');
}

/** A source that fails after its first row. */
function* failing() {
  yield rows[0];
  throw sourceFailure();
}

/** A source that fails before its first row, so the line reports a sequence of no rows. */
const empty = {
  [Symbol.iterator]: () => ({
    next: () => {
      throw sourceFailure();
    },
  }),
};

/** A source that stops the run and then ends, the sanctioned path of a cancelled action. */
async function* cancelling() {
  yield rows[0];
  controller.abort();
  await after(10);
}

/** A source that stops the run and then throws the reason core aborted with, which is silent. */
async function* echoing() {
  yield rows[0];
  controller.abort();
  await after(10);
  throw controller.signal.reason;
}

/** A source that stops the run and then fails, which is rendered as any other failure is. */
async function* faulting() {
  yield rows[0];
  controller.abort();
  await after(10);
  throw new FatalError('The source failed after the signal.');
}

/** A source that stops the run at its first row and then yields forever. */
async function* endless() {
  yield rows[0];
  controller.abort();
  for (;;) {
    yield rows[1];
  }
}

/** A source that throws `undefined`, which is a thrown value like any other. */
function* nothing() {
  yield rows[0];
  const thrown = undefined;
  throw thrown;
}

/** The gate one source releases as it ends, which the action awaits before it fails. */
let release = () => undefined;
const gate = new Promise((resolve) => {
  release = resolve;
});

/** A source that ends at once and releases the gate as it does, so the action fails after it. */
const ending = {
  [Symbol.iterator]: () => ({
    next: () => {
      release();
      return { done: true, value: undefined };
    },
  }),
};

/** A source whose iterator result refuses to say whether it is done. */
const refusingResult = {
  [Symbol.iterator]: () => ({
    next: () => ({
      get done() {
        throw new FatalError('The source failed.');
      },
      value: undefined,
    }),
  }),
};

/** A source whose cleanup never settles, so a stopped sequence must not await it. */
const unsettling = {
  [Symbol.asyncIterator]: () => ({
    next: async () => {
      await after(40);
      return { done: false, value: rows[0] };
    },
    return: () => new Promise(() => undefined),
  }),
};

/** A slow source that records every request, so a stopped sequence asks it for nothing more. */
async function* watched() {
  for (const row of rows) {
    events.push(`pull:${row.source}`);
    await after(40);
    yield row;
  }
}

/** A destination that fails one write by position, so a sequence stops part way through. */
function failingAt(position) {
  let written = 0;
  return new Writable({
    write(chunk, encoding, callback) {
      written += 1;
      if (written === position) {
        callback(new Error('Output failed.'));
        return;
      }
      events.push(chunk.toString());
      callback();
    },
  });
}

/**
 * A destination that records every text it is given and fails each one, without ending: a stream
 * Node destroyed would answer a later write before core could try it.
 */
function refusing() {
  const stream = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
  stream.write = (text) => {
    events.push(String(text));
    throw new Error('Output failed.');
  };
  return stream;
}

/** The replacements one scenario lists, which reach the incomplete-result line alone. */
function replacements() {
  if (scenario === 'silenced') {
    return [override(incompleteResult, { render: () => '' })];
  }
  if (scenario === 'line-broken-alone') {
    return [
      override(incompleteResult, {
        render: () => {
          throw new Error('Cannot render the line.');
        },
      }),
    ];
  }
  return [];
}

/** What each scenario declares: a sequence under one of the two view shapes. */
const declarations = {
  'action-fails': 'row',
  'action-fails-render': 'none',
  'after-resolved': 'row',
  'cancel-row': 'row',
  'cancel-whole': 'whole',
  'cancelled-echo': 'row',
  'cancelled-echo-unawaited': 'row',
  'cancelled-fault': 'row',
  'cancelled-returns': 'row',
  'cleanup-hangs': 'row',
  'done-throws': 'row',
  'line-broken-alone': 'row',
  'not-iterable': 'row',
  root: 'row',
  silenced: 'row',
  'source-awaited': 'row',
  'source-deferred': 'row',
  'stderr-failed': 'row',
  'tail-after-action-fails': 'row',
  'undefined-throw': 'row',
  'view-row': 'row',
  'view-row-class': 'row',
  'whole-cancelled': 'whole',
  'whole-non-string': 'whole',
  'whole-source': 'whole',
  'whole-view': 'whole',
  wrapped: 'row',
  'write-fails': 'row',
  'zero-rows': 'row',
};

/** The view one scenario's declaration names, which decides the shape the writer takes. */
function views() {
  if (declarations[scenario] === 'whole') {
    if (scenario === 'whole-view') {
      return { table: brokenWhole };
    }
    return { table: scenario === 'whole-non-string' ? countedWhole : collected };
  }
  return { list: scenario === 'view-row' || scenario === 'view-row-class' ? breaking : list };
}

async function act({ out }) {
  switch (scenario) {
    case 'root':
    case 'source-awaited':
    case 'whole-source': {
      await out.results(failing());
      break;
    }
    case 'stderr-failed': {
      // The action's print reaches stderr on a result Command and fails there.
      // The line below therefore meets a destination that has failed already.
      await out.print('first').catch(() => undefined);
      await after(5);
      await out.results(failing());
      break;
    }
    case 'silenced':
    case 'source-deferred': {
      out.results(failing());
      break;
    }
    case 'zero-rows': {
      await out.results(empty);
      break;
    }
    case 'cancel-row':
    case 'cancel-whole': {
      // The source aborts at its first row and then yields forever, so core must stop asking.
      await out.results(endless());
      break;
    }
    case 'undefined-throw': {
      await out.results(nothing());
      break;
    }
    case 'not-iterable': {
      // The types reject this value, so a JavaScript author alone reaches the fault it raises.
      await out.results(7);
      break;
    }
    case 'done-throws': {
      out.results(refusingResult);
      break;
    }
    case 'cleanup-hangs': {
      // The source's cleanup never settles, so awaiting it would pin the destination's tail.
      out.results(unsettling);
      throw new FatalError('The action failed.');
    }
    case 'tail-after-action-fails': {
      // The source ends, and the action fails before the closing piece could be written.
      // The two ticks put the failure past the writer's last look at the source and no further.
      out.results(ending);
      await gate;
      await Promise.resolve();
      await Promise.resolve();
      throw new FatalError('The action failed.');
    }
    case 'view-row':
    case 'view-row-class':
    case 'whole-non-string':
    case 'whole-view': {
      await out.results(rows);
      break;
    }
    case 'write-fails': {
      await out.results(rows);
      break;
    }
    case 'cancelled-returns':
    case 'line-broken-alone':
    case 'whole-cancelled': {
      await out.results(cancelling());
      break;
    }
    case 'cancelled-echo': {
      await out.results(echoing());
      break;
    }
    case 'cancelled-echo-unawaited': {
      // The call is not awaited, so the echo reaches the run only as a deferred stop.
      out.results(echoing());
      break;
    }
    case 'cancelled-fault': {
      await out.results(faulting());
      break;
    }
    case 'action-fails': {
      // The sequence is still pending here, so the action's own failure is what stops it.
      out.results(watched());
      throw new FatalError('The action failed.');
    }
    case 'action-fails-render': {
      // The same stop reaches a sequence the action issued through out.render.
      out.render(watched(), list);
      throw new FatalError('The action failed.');
    }
    case 'after-resolved': {
      await out.results(rows);
      throw new FatalError('The action failed.');
    }
    case 'wrapped': {
      try {
        await out.results(failing());
      } catch (error) {
        throw new Error('The action could not finish.', { cause: error });
      }
      break;
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

/** The Command one scenario routes to, declared over the view shape it names, or plain. */
function routed() {
  const command = new Command('count');
  return declarations[scenario] === 'none'
    ? command.action(act)
    : command.rows({ views: views() }).action(act);
}

/** The root answers one scenario itself; every other routes to a named child. */
function build() {
  const options = { views: replacements() };
  return scenario === 'root'
    ? new Application('incomplete', options).rows({ views: views() }).action(act)
    : new Application('incomplete', options).command(routed());
}

/** The destination one scenario writes its result to, or the process stream every other uses. */
function stdout() {
  return scenario === 'write-fails' ? failingAt(3) : process.stdout;
}

/** The stream one scenario's diagnostics reach, which one of them refuses every write on. */
function stderr() {
  return scenario === 'stderr-failed' ? refusing() : process.stderr;
}

const code = await build().run({
  host: { argv: scenario === 'root' ? [] : ['count'], stderr: stderr(), stdout: stdout() },
  signal: controller.signal,
});
if (scenario === 'action-fails' || scenario === 'action-fails-render') {
  process.stdout.write(`requests:${events.length}\n`);
} else if (events.length > 0) {
  process.stdout.write(`${JSON.stringify(events)}\n`);
}
process.stdout.write(`resolved:${code}\n`);
