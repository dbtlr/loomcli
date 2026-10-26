/*
 * A first-party function called alone through the @loomcli/testing builders (ADR-0110): the format
 * plugin's middleware, the help plugin's `onFailure` hook, and a pack view. No Application runs.
 */
import { FatalError, UnknownCommandError, glyph } from '@loomcli/core';
import { failureHookContext, middlewareContext, viewContext } from '@loomcli/testing';
import { describe, expect, it, vi } from 'vite-plus/test';

import middleware from '../src/format/middleware.js';
import { helpHint } from '../src/help/hint.js';
import { rule } from '../src/rule.js';

/** One column per line glyph and per other character, the measure a terminal would give. */
const columnsOf = (text: string): number => text.replaceAll(glyph.line, '-').length;

/** A middleware context whose `--format` option holds `selected`, and whose view is `view`. */
function formatContext(selected: unknown, view: string | null) {
  return middlewareContext(middleware, {
    next: vi.fn(async (): Promise<'dispatched'> => 'dispatched'),
    options: {},
    ownOptions: { format: selected },
    request: { args: {}, options: {}, passthrough: [] },
    spellings: {},
    view,
  });
}

describe('the format middleware through middlewareContext', () => {
  it('copies a supplied --format into the view and dispatches', async () => {
    const context = formatContext('json', 'plain');
    await middleware(context);
    expect(context.view).toBe('json');
    expect(context.next).toHaveBeenCalledOnce();
  });

  it('leaves the view alone when --format is not supplied', async () => {
    const context = formatContext(undefined, 'plain');
    await middleware(context);
    expect(context.view).toBe('plain');
  });

  it('leaves a null view alone, as a Command with no result has none', async () => {
    const context = formatContext('json', null);
    await middleware(context);
    expect(context.view).toBeNull();
  });
});

describe('the help plugin hint through failureHookContext', () => {
  const failure = new UnknownCommandError('lsit', ['list']);
  const facts = { application: 'notes', mediaType: undefined, view: undefined } as const;

  it('points a usage error at the routed Command help page', () => {
    const context = failureHookContext(helpHint, { ...facts, invokedBy: 'argv', path: ['db'] });
    expect(helpHint(failure, context)).toBe('Run "notes db --help" to see the usage.');
  });

  it('gives no hint to an invocation by name', () => {
    const context = failureHookContext(helpHint, { ...facts, invokedBy: 'name', path: ['db'] });
    expect(helpHint(failure, context)).toBeUndefined();
  });

  it('gives no hint to a failure that is not a usage error', () => {
    const context = failureHookContext(helpHint, { ...facts, invokedBy: 'argv', path: [] });
    expect(helpHint(new FatalError('broken'), context)).toBeUndefined();
  });
});

describe('the rule view through viewContext', () => {
  const view = rule();

  it('draws a bare line across the stated columns for a blank text', () => {
    const context = viewContext(view, {
      columns: 10,
      plain: (text) => text.trim(),
      width: columnsOf,
    });
    expect(view.render('', context)).toBe(`${glyph.line.repeat(10)}\n`);
  });

  it('draws a label between a lead and a tail at the stated width', () => {
    const context = viewContext(view, {
      columns: 20,
      expandTabs: (text) => text,
      plain: (text) => text,
      width: columnsOf,
      wrap: (text) => text,
    });
    expect(view.render('Notes', context)).toBe(
      `${glyph.line.repeat(2)} Notes ${glyph.line.repeat(20 - 9)}\n`,
    );
  });

  it('asks the style for dim, which the unstated style answers unchanged', () => {
    const context = viewContext(view, { columns: 6, plain: (text) => text, width: columnsOf });
    vi.spyOn(context.style, 'dim');
    view.render('', context);
    expect(context.style.dim).toHaveBeenCalledWith(glyph.line.repeat(6));
  });
});
