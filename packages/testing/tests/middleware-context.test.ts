import { plugin } from '@loomcli/core';
import type { ChainOutcome, Middleware } from '@loomcli/core';
import { describe, expect, it, vi } from 'vite-plus/test';

import { middlewareContext } from '../src/index.js';

const dryRun = plugin('test/dry-run', { options: { dryRun: { type: 'boolean' } } });

/** Takes over before the action when --dry-run is set, and continues the chain otherwise. */
const middleware: Middleware<typeof dryRun> = async (context) => {
  if (context.ownOptions.dryRun === true) {
    await context.out.info('Dry run: nothing was changed.');
    return;
  }
  context.view = 'json';
  await context.next();
};

/** The inputs a middleware reads on a Command whose invocation parsed cleanly. */
const inputs = {
  options: { dryRun: false },
  ownOptions: { dryRun: false },
  request: { args: {}, options: {}, passthrough: [] },
  spellings: {},
  view: null,
};

describe('middlewareContext', () => {
  it('a middleware that takes over calls no next', async () => {
    const info = vi.fn(async (_message: string) => {});
    const next = vi.fn(async (): Promise<ChainOutcome> => 'dispatched');
    const context = middlewareContext(middleware, {
      ...inputs,
      next,
      out: { info },
      ownOptions: { dryRun: true },
      spellings: { dryRun: '--dry-run' },
    });
    await middleware(context);
    expect(next).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('Dry run: nothing was changed.');
  });

  it('the context keeps the last view the middleware assigns', async () => {
    const next = vi.fn(async (): Promise<ChainOutcome> => 'dispatched');
    const context = middlewareContext(middleware, { ...inputs, next });
    expect(context.view).toBeNull();
    await middleware(context);
    expect(context.view).toBe('json');
    expect(next).toHaveBeenCalledOnce();
  });

  it('an unstated next rejects with a sentence that shows a stated one', async () => {
    const context = middlewareContext(middleware, inputs);
    await expect(middleware(context)).rejects.toThrow(
      new Error(
        "middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.",
      ),
    );
  });
});
