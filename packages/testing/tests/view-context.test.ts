import type { RowView, View } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { viewContext } from '../src/index.js';

const heading: View<string> = {
  render: (title, { columns, width }) =>
    `${title} ${'-'.repeat(Math.max(0, (columns ?? 40) - width(title) - 1))}\n`,
};

const lines: RowView<string> = {
  head: ({ style }) => `${style.bold('Lines')}\n`,
  row: (row, index, { plain }) => `${index + 1}. ${plain(row)}\n`,
};

describe('viewContext', () => {
  it('the view measures with the members the test stated', () => {
    const context = viewContext(heading, { columns: 20, width: (text) => text.length });
    expect(heading.render('Notes', context)).toBe(`Notes ${'-'.repeat(14)}\n`);
  });

  it('a stated columns of undefined is a destination that is not a terminal', () => {
    const context = viewContext(heading, { columns: undefined, width: (text) => text.length });
    expect(heading.render('Notes', context)).toBe(`Notes ${'-'.repeat(34)}\n`);
  });

  it('a row view is called with the context, one function at a time', () => {
    const context = viewContext(lines, { plain: (text) => text });
    expect(lines.head?.(context)).toBe('Lines\n');
    expect(lines.row('first', 0, context)).toBe('1. first\n');
  });

  it('an unstated measure throws a sentence naming the member called', () => {
    const context = viewContext(heading, { columns: 20 });
    expect(() => heading.render('Notes', context)).toThrow(
      new Error('viewContext has no width for this view to call. Add width to its values.'),
    );
    for (const member of ['plain', 'expandTabs'] as const) {
      expect(() => context[member]('text')).toThrow(
        new Error(
          `viewContext has no ${member} for this view to call. Add ${member} to its values.`,
        ),
      );
    }
    expect(() => context.wrap('text', 20)).toThrow(
      new Error('viewContext has no wrap for this view to call. Add wrap to its values.'),
    );
  });
});
