import { Writable } from 'node:stream';

import { Application, Command } from '@loomcli/core';
import type { RowViews } from '@loomcli/core';
import { format, jsonl, jsonlRows } from '@loomcli/plugins/format';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';

/** U+001B, U+009B, and U+007F by code point, so the linter keeps the literal out of the source. */
const controls = `a${String.fromCharCode(27)}b${String.fromCharCode(155)}c${String.fromCharCode(127)}d`;

/** A value whose own `toJSON` decides what `JSON.stringify` sees. */
class Wrapped {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }

  toJSON() {
    return { wrapped: this.value };
  }
}

/** How long a gated source waits for its first line before it gives up and moves on. */
const gateTimeoutMs = 2000;

/** The rows each scenario's source yields. A `throws` source fails after them. */
function* source(scenario: string): Generator {
  switch (scenario) {
    case 'rows': {
      yield { count: 1 };
      yield { count: 2 };
      return;
    }
    case 'map': {
      yield { count: 1 };
      yield { count: 2 };
      return;
    }
    case 'tojson': {
      yield new Wrapped(1);
      yield new Wrapped(2);
      return;
    }
    case 'controls': {
      yield controls;
      return;
    }
    case 'bigint': {
      yield 10n;
      return;
    }
    case 'throws': {
      yield { count: 1 };
      yield { count: 2 };
      throw new Error('source failed');
    }
    default: {
      return;
    }
  }
}

/** The count one row holds. */
function countOf(row: unknown) {
  return z.object({ count: z.number() }).parse(row).count;
}

/** The declared views: the hook adds `jsonlRows()` itself, except where a scenario names one. */
function viewsFor(scenario: string, mode: string): RowViews<unknown> {
  const table = { row: (row: unknown) => `table:${JSON.stringify(row)}\n` };
  if (mode === 'whole') {
    return { jsonl: jsonl(), table };
  }
  if (scenario === 'map') {
    return { jsonl: jsonlRows({ map: countOf }), table };
  }
  return { table };
}

/** A source whose second row waits for the gate, which opens when the first line is written. */
async function* gatedSource(events: string[], gate?: Promise<void>) {
  yield { count: 1 };
  await Promise.race([gate, new Promise((resolve) => setTimeout(resolve, gateTimeoutMs))]);
  events.push('source:finished');
  yield { count: 2 };
}

/** The application: `list` declares rows over the scenario's source. */
function application(scenario: string, mode: string, events: string[], gate?: Promise<void>) {
  const list = new Command('list').rows<unknown>({ views: viewsFor(scenario, mode) });
  return new Application('rows', { plugins: [format()] }).command(
    list.action(({ out }) => {
      if (scenario !== 'gated') {
        return out.results(source(scenario));
      }
      return out.results(gatedSource(events, gate));
    }),
  );
}

/** Runs `list --format jsonl` and returns the process effects; `whole` declares `jsonl()`. */
async function run(scenario: string, mode: 'hook' | 'whole' = 'hook') {
  return await runOnMock(application(scenario, mode, []), {
    argv: ['list', '--format', 'jsonl'],
    release: { build: 'distributed' },
  });
}

/** Runs a gated source and returns the order of its source and stdout events. */
async function runGated() {
  const events: string[] = [];
  const { promise: opened, resolve: open } = Promise.withResolvers<void>();
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      events.push(`write:${String(chunk).trimEnd()}`);
      open();
      done();
    },
  });
  await runOnMock(
    application('gated', 'hook', events, opened),
    { argv: ['list', '--format', 'jsonl'], release: { build: 'distributed' } },
    { stdout },
  );
  return events;
}

/** The declared result `inspect()` publishes for `list`, under the hook or under a whole `jsonl()`. */
function inspectList(mode: 'hook' | 'whole') {
  return application('rows', mode, []).inspect();
}

export { inspectList, run, runGated };
