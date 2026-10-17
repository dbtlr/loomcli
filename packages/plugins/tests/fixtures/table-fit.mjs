import { Application, nowrap } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

/**
 * One table or records render per entry of `widths`, on a host whose stdout width is read live: a
 * number is a terminal that wide, 'unreported' is a terminal that reports no width, and null is a
 * pipe. The input is JSON in argv[2]: { view, config, rows, widths, env?, stream?, rendering? }. A
 * `format` in a config is the name of one of the formatters below, because JSON carries no
 * functions. With `stream`, one records row prints per width, and the width changes before the
 * source yields the row.
 */
const input = JSON.parse(process.argv[2]);

const formats = {
  lines: (value) => `${String(value)}\nsecond line`,
  // An OSC 8 hyperlink and, under sgr, a raw SGR color, embedded as an author's own bytes.
  link: (value) => `\u001B]8;;https://example.com\u001B\\${String(value)}\u001B]8;;\u001B\\`,
  nowrap: (value) => nowrap(String(value)),
  red: (value, _row, { style }) => style.red(String(value)),
  sgr: (value) => `\u001B[31m${String(value)}\u001B[39m`,
};

/** A config entry with its named formatter swapped for the function. */
function entry(item) {
  return typeof item === 'string' || item.format === undefined
    ? item
    : { ...item, format: formats[item.format] };
}

/** The view's config, with each named formatter swapped for its function. */
function configured() {
  if (input.view === 'records') {
    const { fields, identifier } = input.config;
    return { identifier, ...(fields === undefined ? {} : { fields: fields.map(entry) }) };
  }
  const { columns } = input.config;
  return columns === undefined ? {} : { columns: columns.map(entry) };
}

const config = configured();
const view = input.view === 'records' ? records(config) : table(config);

let current = input.widths[0];
const output = {
  get columns() {
    return typeof current === 'number' ? current : undefined;
  },
  isTTY: input.widths[0] !== null,
  rows: 24,
};

async function* streamed() {
  for (const [index, row] of input.rows.entries()) {
    current = input.widths[index];
    yield row;
  }
}

await new Application('table-fit', { description: 'Render rows at a live width.' })
  .action(async ({ out }) => {
    if (input.stream) {
      await out.render(streamed(), view);
      return;
    }
    for (const [index, width] of input.widths.entries()) {
      current = width;
      if (index > 0) {
        await out.print('--');
      }
      await out.render(input.rows, view);
    }
  })
  .run({
    host: {
      argv: [],
      env: input.env ?? {},
      platform: 'linux',
      release: { build: 'distributed' },
      terminal: { stderr: { isTTY: false }, stdin: { isTTY: false }, stdout: output },
    },
    rendering: input.rendering ?? { color: 'never', modifiers: 'never' },
  });
