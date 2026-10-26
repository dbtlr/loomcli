import { Command, FatalError, plugin } from '@loomcli/core';
import type { ActionHandler, Middleware, View } from '@loomcli/core';
import { describe, expect, it, vi } from 'vite-plus/test';

import { actionContext, middlewareContext, viewContext } from '../src/index.js';

/** Renders a value as its own text. */
const plainView: View<string> = { render: (text) => text };

const get = new Command('get')
  .argument('path', { required: true })
  .result<string>({ views: { plain: plainView } });

/** Reads nothing; each test reads the members the rule under test fills. */
const getValue: ActionHandler<typeof get> = () => {};

/** A context with only the inputs stated. */
function bare() {
  return actionContext(getValue, { args: { path: 'name' }, options: {}, provided: {} });
}

const quiet = plugin('test/quiet', {});
const pass: Middleware<typeof quiet> = async ({ next }) => {
  await next();
};

describe('an unstated member', () => {
  it('passes no input through but the ones the test stated', () => {
    const args = { path: 'name' };
    const options = {};
    const provided = {};
    const context = actionContext(getValue, { args, options, provided });
    expect([context.args, context.options, context.provided]).toEqual([args, options, provided]);
    expect(context.args).toBe(args);
    expect('stdin' in context).toBe(false);
  });

  it('that is a function returning nothing does nothing', async () => {
    const context = bare();
    const view: View<string> = { render: vi.fn((text: Readonly<string>) => text) };
    const lanes = ['print', 'info', 'success', 'warn', 'error', 'debug', 'trace'] as const;
    for (const lane of lanes) {
      await expect(context.out[lane]('text')).resolves.toBeUndefined();
    }
    await expect(context.out.render('text', view)).resolves.toBeUndefined();
    await expect(context.out.results('value')).resolves.toBeUndefined();
    expect(view.render).not.toHaveBeenCalled();
    for (const level of ['trace', 'debug', 'info', 'warn', 'error'] as const) {
      expect(context.log[level]('text')).toBeUndefined();
    }
    expect(context.cancel()).toBeUndefined();
    const handler = vi.fn(() => {});
    for (const register of [context.onShutdown, context.onSuspend, context.onResume]) {
      const remove = register(handler);
      expect(remove()).toBeUndefined();
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('out.draw resolves 0', async () => {
    const view: View<string> = { render: vi.fn((text: Readonly<string>) => text) };
    await expect(bare().out.draw('frame', view)).resolves.toBe(0);
    expect(view.render).not.toHaveBeenCalled();
  });

  it('out.region() is a region that is not live and does nothing', async () => {
    const region = bare().out.region({ input: true });
    expect(region.live).toBe(false);
    await expect(region.draw('frame', plainView)).resolves.toBeUndefined();
    expect(region.report({ completed: 1, total: 2 })).toBeUndefined();
    await expect(region.end('failed', 'Stopped')).resolves.toBeUndefined();
    expect(region.closedBy).toBeUndefined();
    expect(region.signal.aborted).toBe(false);
  });

  it('signal never aborts, even after cancel', () => {
    const context = bare();
    context.cancel();
    expect(context.signal.aborted).toBe(false);
  });

  it('out.fatal throws FatalError with the message', () => {
    const { out } = bare();
    expect(() => out.fatal('The store is locked.')).toThrow(FatalError);
    expect(() => out.fatal('The store is locked.')).toThrow('The store is locked.');
  });

  it('next rejects with its sentence', async () => {
    const context = middlewareContext(pass, {
      options: {},
      ownOptions: {},
      request: null,
      spellings: {},
      view: null,
    });
    await expect(context.next()).rejects.toThrow(
      new Error(
        "middlewareContext has no next for this middleware to call. Add next to its values, such as next: async () => 'dispatched'.",
      ),
    );
  });

  it('that is a view measure throws its sentence when called', () => {
    const context = viewContext(plainView, {});
    expect(() => context.width('text')).toThrow(
      new Error('viewContext has no width for this view to call. Add width to its values.'),
    );
  });

  it('that is any other fact throws its sentence when read', () => {
    const context = bare();
    const facts = {
      command: () => context.command,
      graph: () => context.graph,
      host: () => context.host,
      interactive: () => context.interactive,
      passthrough: () => context.passthrough,
      supplied: () => context.supplied,
    };
    for (const [member, read] of Object.entries(facts)) {
      expect(read).toThrow(
        new Error(`actionContext has no ${member}. Add ${member} to its values.`),
      );
    }
    const view = viewContext(plainView, {});
    expect(() => view.columns).toThrow(
      new Error('viewContext has no columns. Add columns to its values.'),
    );
    expect(() => view.background).toThrow(
      new Error('viewContext has no background. Add background to its values.'),
    );
    const middleware = middlewareContext(pass, {
      options: null,
      ownOptions: {},
      request: null,
      spellings: {},
      view: null,
    });
    expect(() => middleware.host).toThrow(
      new Error('middlewareContext has no host. Add host to its values.'),
    );
  });

  it('of out and log is stated member by member', async () => {
    const print = vi.fn(async (_message: string) => {});
    const warn = vi.fn((_message: string) => {});
    const context = actionContext(getValue, {
      args: { path: 'name' },
      log: { warn },
      options: {},
      out: { print },
      provided: {},
    });
    await context.out.print('printed');
    await expect(context.out.info('kept inert')).resolves.toBeUndefined();
    context.log.warn('warned');
    expect(context.log.info('kept inert')).toBeUndefined();
    expect(print).toHaveBeenCalledWith('printed');
    expect(warn).toHaveBeenCalledWith('warned');
  });
});
