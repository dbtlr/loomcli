import { Application } from '@loomcli/core';
import { json, jsonl } from '@loomcli/plugins/format/views';

const [scenario, color] = process.argv.slice(2);

/** A value whose own `toJSON` decides what JSON.stringify sees, unrelated to its other keys. */
class Wrapped {
  constructor(value) {
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

const scenarios = {
  'json-array': () => json(),
  'json-empty-array': () => json(),
  'json-map': () => json({ map: (data) => data.kept }),
  'json-object': () => json(),
  'json-tojson': () => json(),
  'json-undefined': () => json(),
  'jsonl-array': () => jsonl(),
  'jsonl-bigint': () => jsonl(),
  'jsonl-controls': () => jsonl(),
  'jsonl-empty-array': () => jsonl(),
  'jsonl-map': () => jsonl({ map: (rows) => rows.map((row) => row.count) }),
  'jsonl-non-array': () => jsonl(),
  'jsonl-tojson': () => jsonl(),
};

const values = {
  'json-array': [1, 2, 3],
  'json-empty-array': [],
  'json-map': { discarded: 'x', kept: { count: 2 } },
  'json-object': { count: 1, name: 'a' },
  'json-tojson': new Wrapped(5),
  'json-undefined': undefined,
  'jsonl-array': [{ count: 1 }, { count: 2 }],
  'jsonl-bigint': 10n,
  'jsonl-controls': controls,
  'jsonl-empty-array': [],
  'jsonl-map': [{ count: 1 }, { count: 2 }],
  'jsonl-non-array': { count: 1 },
  'jsonl-tojson': [new Wrapped(1), new Wrapped(2)],
};

const view = scenarios[scenario]();
const value = values[scenario];

const app = new Application('format-views', {
  rendering: color === undefined ? {} : { color },
}).action(({ out }) => out.render(value, view));

const code = await app.run({ host: { argv: [] } });
process.stdout.write(`resolved:${String(code)}\n`);
