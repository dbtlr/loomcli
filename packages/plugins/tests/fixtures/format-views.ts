import { Application, InternalError, override } from '@loomcli/core';
import type { View } from '@loomcli/core';
import { json, jsonl } from '@loomcli/plugins/format/views';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args: string[] = [], env: Record<string, string | undefined> = {}) {
  const [scenario, color] = args;

  /** A value whose own `toJSON` decides what JSON.stringify sees, unrelated to its other keys. */
  class Wrapped {
    readonly value: unknown;
    readonly ignored: () => undefined;
    constructor(value: unknown) {
      this.value = value;
      this.ignored = () => undefined;
    }

    toJSON() {
      return { wrapped: this.value };
    }
  }

  // Decimal code points avoid a lowercase-versus-uppercase hex fight between the formatter and the linter.
  // 27 is U+001B, 155 is U+009B, 127 is U+007F.
  const controls = `a${String.fromCharCode(27)}b${String.fromCharCode(155)}c${String.fromCharCode(127)}d`;

  const scenarios: Record<string, () => View<unknown>> = {
    'json-array': () => json(),
    'json-empty-array': () => json(),
    'json-map': () => json({ map: (data) => z.object({ kept: z.unknown() }).parse(data).kept }),
    'json-object': () => json(),
    'json-tojson': () => json(),
    'json-undefined': () => json(),
    'jsonl-array': () => jsonl(),
    'jsonl-bigint': () => jsonl(),
    'jsonl-bigint-cause': () => jsonl(),
    'jsonl-controls': () => jsonl(),
    'jsonl-empty-array': () => jsonl(),
    'jsonl-map': () =>
      jsonl({
        map: (rows) =>
          z
            .array(z.object({ count: z.number() }))
            .parse(rows)
            .map((row) => row.count),
      }),
    'jsonl-non-array': () => jsonl(),
    'jsonl-tojson': () => jsonl(),
  };

  const values: Record<string, unknown> = {
    'json-array': [1, 2, 3],
    'json-empty-array': [],
    'json-map': { discarded: 'x', kept: { count: 2 } },
    'json-object': { count: 1, name: 'a' },
    'json-tojson': new Wrapped(5),
    'json-undefined': undefined,
    'jsonl-array': [{ count: 1 }, { count: 2 }],
    'jsonl-bigint': 10n,
    'jsonl-bigint-cause': 10n,
    'jsonl-controls': controls,
    'jsonl-empty-array': [],
    'jsonl-map': [{ count: 1 }, { count: 2 }],
    'jsonl-non-array': { count: 1 },
    'jsonl-tojson': [new Wrapped(1), new Wrapped(2)],
  };

  const factory = scenarios[scenario ?? ''];
  if (factory === undefined) {
    throw new Error(`Unknown fixture scenario: ${scenario}`);
  }
  const view = factory();

  const value = values[scenario ?? ''];

  // The internal failure wraps the error the view threw, so its cause is the view's own cause.
  const causeView = override(InternalError, {
    render: (failure) => {
      if (!(failure.cause instanceof Error) || !(failure.cause.cause instanceof Error)) {
        throw new Error('The fixture expects a nested Error cause.');
      }
      return `cause: ${failure.cause.cause.constructor.name}\n`;
    },
  });

  const app = new Application('format-views', {
    description: 'The format-views application.',
    rendering:
      color === undefined ? {} : { color: z.enum(['auto', 'always', 'never']).parse(color) },
    views: scenario === 'jsonl-bigint-cause' ? [causeView] : [],
  }).action(({ out }) => out.render(value, view));

  // A test that reads a defect's own sentence runs the fixture as a development build.
  const release = {
    build: z
      .enum(['source', 'development', 'distributed'])
      .parse(env.FIXTURE_BUILD ?? 'distributed'),
  };

  return await runOnMock(
    app,
    { argv: [], release },
    {
      afterRun: (mock) => mock.stdout.write(`resolved:${String(mock.exitCode)}\n`),
    },
  );
}

export { run };
