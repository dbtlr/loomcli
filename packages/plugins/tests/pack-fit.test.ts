/*
 * The pack's layout views fit a narrow terminal (docs/plugins/pack-views.md). Each case runs a tiny
 * Application in this process on a mock terminal 30 columns wide, renders one view over content
 * wider than that, and measures every line the run wrote with core's own `width`. The views'
 * branches and content are unit-tested through viewContext in each view's own suite.
 */
import { Application, width } from '@loomcli/core';
import type { Out } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { box } from '../src/box.js';
import { heading } from '../src/heading.js';
import { list } from '../src/list.js';
import { prose } from '../src/prose.js';
import { records } from '../src/records.js';
import { rule } from '../src/rule.js';
import { table } from '../src/table.js';

/** The terminal width every case fits. */
const columns = 30;

const sentence =
  'Three services rolled out to the staging cluster, and one health check is still warming up.';
const tasks = [
  { name: 'build', note: 'compiles every package and bundles the examples' },
  { name: 'check', note: 'runs the formatter, the linter, and the type checker' },
];

/** What a run that renders through `draw` wrote to stdout on a mock terminal `columns` wide. */
async function drawn(draw: (out: Out) => Promise<void>): Promise<string> {
  const application = new Application('fit', { description: 'Render one pack view.' }).action(
    async ({ out }) => draw(out),
  );
  const mock = mockProcess({ argv: [], terminal: { columns, rows: 24 } });
  await application.run({ process: mock });
  expect(mock.stderr.text).toBe('');
  expect(mock.stdout.text).not.toBe('');
  return mock.stdout.text;
}

/** The width of each line of the output, as core measures written text. */
function lineWidths(output: string): number[] {
  return output.split('\n').map((line) => width(line));
}

test('a table fits a narrow terminal', async () => {
  const widths = lineWidths(await drawn((out) => out.render(tasks, table())));
  for (const each of widths) {
    expect(each).toBeLessThanOrEqual(columns);
  }
});

test('records fit a narrow terminal', async () => {
  const widths = lineWidths(
    await drawn((out) => out.render(tasks, records({ identifier: 'name' }))),
  );
  for (const each of widths) {
    expect(each).toBeLessThanOrEqual(columns);
  }
});

test('a box fits a narrow terminal', async () => {
  const widths = lineWidths(await drawn((out) => out.render(sentence, box({ title: 'Summary' }))));
  for (const each of widths) {
    expect(each).toBeLessThanOrEqual(columns);
  }
});

test('a heading fits a narrow terminal', async () => {
  const widths = lineWidths(await drawn((out) => out.render(sentence, heading())));
  for (const each of widths) {
    expect(each).toBeLessThanOrEqual(columns);
  }
});

test('a list fits a narrow terminal', async () => {
  const items = [sentence, sentence];
  const widths = lineWidths(
    await drawn((out) => out.render(items, list<string>({ ordered: true }))),
  );
  for (const each of widths) {
    expect(each).toBeLessThanOrEqual(columns);
  }
});

test('prose fits a narrow terminal', async () => {
  const widths = lineWidths(await drawn((out) => out.render(sentence, prose())));
  for (const each of widths) {
    expect(each).toBeLessThanOrEqual(columns);
  }
});

test('a rule fits a narrow terminal', async () => {
  const widths = lineWidths(await drawn((out) => out.render('Twenty-seven characters ok', rule())));
  for (const each of widths) {
    expect(each).toBeLessThanOrEqual(columns);
  }
});
