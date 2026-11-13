import { Application, lanes, plugin } from '@loomcli/core';
import type { RowView, View } from '@loomcli/core';

/** A view over a string, which any semantic method takes after its message. */
const framed: View<string> = { render: (message) => `[${message}]\n` };
/** A view over a number, which no semantic method takes. */
const counted: View<number> = { render: (count) => String(count) };
/** A row view over strings, which no semantic method takes. */
const rows: RowView<string> = { row: (line) => `${line}\n` };

/** Each semantic method takes an optional view over its message, and only a whole view over a string. */
new Application('messages').action(async ({ out }) => {
  await out.print('data', framed);
  await out.info('Building', framed);
  await out.success('Built', framed);
  await out.warn('Stale', lanes.error);
  await out.error('Failed', framed);
  await out.debug('Detail', lanes.warn);
  await out.trace('Finer', framed);
  await out.info('Plain');
  // @ts-expect-error TS2379: A message's view reads a string.
  await out.info('Building', counted);
  // @ts-expect-error TS2379: A message's view is a whole view, never a row view.
  await out.warn('Stale', rows);
  // @ts-expect-error TS2345: The message itself is a string.
  await out.info(3, counted);
});

/** The warn an onEnvironment hook receives takes the same view. */
plugin('fixture/environment-view', {
  onEnvironment: async ({ out }) => {
    await out.warn('Using defaults', framed);
    // @ts-expect-error TS2379: A message's view reads a string.
    await out.warn('Using defaults', counted);
    return {};
  },
});
