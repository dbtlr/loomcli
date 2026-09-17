import { Writable } from 'node:stream';
import { setTimeout as after } from 'node:timers/promises';

import { Application, Command, FatalError, incompleteResult, override } from '@loomcli/core';

const scenario = process.argv[2];

const rows = [{ source: 'one.txt' }, { source: 'two words.txt' }];

/** What each scenario watched: the writes a destination completed and the rows a source gave. */
const events = [];

/** The caller's own signal, which one scenario aborts from inside its source. */
const controller = new AbortController();

/** The row view every scenario renders through: one head, one line per row, one tail. */
const list = {
  head: () => 'PATHS\n',
  row: (row, index) => `${index}: ${row.source}\n`,
  tail: () => 'END\n',
};

/** A row view whose tail makes the completed row count observable. */
const withCountedTail = {
  row: (row, index) => `${index}: ${row.source}\n`,
  tail: (count) => `COUNT:${count}\n`,
};

/** A row view that fails on the second row, so the pieces before it stand. */
const breaking = {
  head: () => 'PATHS\n',
  row: (row, index) => {
    if (index === 1) {
      throw new Error('Cannot render the row.');
    }
    return `${index}: ${row.source}\n`;
  },
};

/** A row view that returns a number, which is no text at all. */
const counted = { head: () => 'PATHS\n', row: (row, index) => index };

/** A source that records each request, so a test reads what core asked for and when. */
function* recorded() {
  for (const row of rows) {
    events.push(`pull:${row.source}`);
    yield row;
  }
  events.push('pull:end');
}

/** The same rows from an asynchronous source, one microtask apart. */
async function* streamed() {
  for (const row of rows) {
    await Promise.resolve();
    yield row;
  }
}

/** A slow source, so an unawaited sequence is still pending when the action returns. */
async function* delayed() {
  for (const row of rows) {
    await after(40);
    yield row;
  }
}

/** A source that fails after its first row. */
function* failing() {
  yield rows[0];
  throw new FatalError('The source failed.');
}

/** A source that stops the run and then ends, the sanctioned path of a cancelled action. */
async function* cancelling() {
  yield rows[0];
  controller.abort();
  await after(10);
}

/** A destination that reports each completed write and holds every callback for five ms. */
function slowly() {
  return new Writable({
    write(chunk, encoding, callback) {
      setTimeout(() => {
        events.push(`wrote:${chunk.toString()}`);
        callback();
      }, 5);
    },
  });
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

/** The replacements one scenario lists, which reach the incomplete-result line alone. */
function replacements() {
  if (scenario === 'silenced') {
    return [override(incompleteResult, { render: () => '' })];
  }
  if (scenario === 'line-broken') {
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

/** The destination one scenario writes its result to, or the process stream every other uses. */
function stdout() {
  if (scenario === 'back-pressure') {
    return slowly();
  }
  if (scenario === 'write-fails') {
    return failingAt(3);
  }
  return process.stdout;
}

async function act({ out }) {
  switch (scenario) {
    case 'sync': {
      await out.render(rows, list);
      break;
    }
    case 'async': {
      await out.render(streamed(), list);
      break;
    }
    case 'empty': {
      await out.render([], list);
      break;
    }
    case 'counted-tail': {
      await out.render(rows, withCountedTail);
      break;
    }
    case 'back-pressure': {
      await out.render(recorded(), list);
      break;
    }
    case 'order': {
      out.render(streamed(), list);
      out.print('after');
      break;
    }
    case 'open': {
      // The action returns at once, so the rows arrive only because the sequence is open output.
      out.render(delayed(), list);
      break;
    }
    case 'root':
    case 'line-broken':
    case 'source-awaited': {
      await out.render(failing(), list);
      break;
    }
    case 'silenced':
    case 'source-deferred': {
      out.render(failing(), list);
      break;
    }
    case 'row-broken': {
      out.render(rows, breaking);
      break;
    }
    case 'row-non-string': {
      out.render(rows, counted);
      break;
    }
    case 'write-fails': {
      out.render(rows, list);
      break;
    }
    case 'cancelled': {
      await out.render(cancelling(), list);
      break;
    }
    case 'both-shapes': {
      out.render(rows, { render: () => 'whole\n', row: () => 'row\n' });
      break;
    }
    case 'no-shape': {
      out.render(rows, {});
      break;
    }
    case 'null-view': {
      // The dispatch reads the value inside the guard, so no call throws where it was written.
      out.render(rows, null);
      out.print('after');
      break;
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

/** The root Command answers one scenario; every other routes to a named child. */
function build() {
  const views = replacements();
  return scenario === 'root'
    ? new Application('rows', { views }).action(act)
    : new Application('rows', { views }).command(new Command('count').action(act));
}

const code = await build().run({
  host: { argv: scenario === 'root' ? [] : ['count'], stdout: stdout() },
  signal: controller.signal,
});
if (events.length > 0) {
  process.stdout.write(`${JSON.stringify(events)}\n`);
}
process.stdout.write(`resolved:${code}\n`);
