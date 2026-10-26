import { Readable } from 'node:stream';

import { Command, plugin, provider } from '@loomcli/core';
import type {
  ActionHandler,
  FailureHook,
  FailureHookContext,
  Middleware,
  Opener,
  OptionsOf,
  Provider,
  View,
  ViewContext,
} from '@loomcli/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';

import {
  actionContext,
  failureHookContext,
  middlewareContext,
  providerContext,
  viewContext,
} from '../src/index.js';
import type {
  ActionValues,
  FailureHookValues,
  MiddlewareValues,
  ProviderValues,
  ViewValues,
} from '../src/index.js';

interface Pool {
  readonly url: string;
}

declare const openPool: Opener<typeof pool>;
const pool: Provider<'pool', Pool, { token: string | undefined }, 'persistent'> = provider('pool', {
  lifetime: 'persistent',
  load: async () => ({ default: openPool }),
});

const get = new Command('get', { uses: [pool] })
  .argument('path', { required: true })
  .option('limit', { type: 'count' })
  .stdin({ required: true });

/** An extracted handler, typed from its declaration alone. */
const getValue: ActionHandler<typeof get> = async ({ args, out }) => {
  await out.print(args.path);
};

/** The context the handler takes, which the builder returns. */
type GetContext = Parameters<typeof getValue>[0];

const stdin: GetContext['stdin'] = {
  kind: 'stdin',
  name: 'stdin',
  path: undefined,
  stream: () => Readable.from([]),
  text: async () => '',
};
const stated = {
  args: { path: 'name' },
  options: { limit: 0, token: undefined },
  provided: { pool: { url: '' } },
  stdin,
};

const dryRun = plugin('test/dry-run', { options: { dryRun: { type: 'boolean' } } });
const middleware: Middleware<typeof dryRun> = async ({ next }) => {
  await next();
};
const hook: FailureHook = () => undefined;
const open: Opener<typeof pool> = ({ options }) => ({ url: options.token ?? '' });
const heading: View<string> = { render: (title) => title };

describe('the builders infer from the function alone', () => {
  it('actionContext returns the context an extracted ActionHandler takes', () => {
    expectTypeOf(actionContext(getValue, stated)).toEqualTypeOf<GetContext>();
    const values: ActionValues<
      GetContext['args'],
      GetContext['options'],
      unknown,
      Pick<GetContext, 'stdin'>,
      GetContext['provided']
    > = stated;
    expectTypeOf(actionContext(getValue, values)).toEqualTypeOf<GetContext>();
  });

  it('actionContext rejects values that miss a required input', () => {
    expectTypeOf(stated.args).toEqualTypeOf<GetContext['args']>();
    // @ts-expect-error A required argument is stated whole.
    actionContext(getValue, { ...stated, args: {} });
    const { provided: _provided, ...withoutProvided } = stated;
    // @ts-expect-error The provided record is stated, even for a Command that opts in to none.
    actionContext(getValue, withoutProvided);
    const { stdin: _stdin, ...withoutStdin } = stated;
    // @ts-expect-error A required stdin is stated.
    actionContext(getValue, withoutStdin);
    const { token: _token, ...withoutToken } = stated.options;
    // @ts-expect-error A key typed with undefined is written out.
    actionContext(getValue, { ...stated, options: withoutToken });
  });

  it('actionContext rejects a key the context does not have, and infers nothing from values', () => {
    expectTypeOf(stated.options).toExtend<GetContext['options']>();
    // @ts-expect-error An argument the declaration does not have is an excess key.
    actionContext(getValue, { ...stated, args: { other: '', path: 'name' } });
    // @ts-expect-error A value of the wrong type is not read as a new type parameter.
    actionContext(getValue, { ...stated, options: { limit: 'many', token: undefined } });
  });

  it('middlewareContext returns the context the middleware takes', () => {
    const context = middlewareContext(middleware, {
      options: null,
      ownOptions: {},
      request: null,
      spellings: {},
      view: null,
    });
    expectTypeOf(context).toEqualTypeOf<Parameters<typeof middleware>[0]>();
    const values: MiddlewareValues<OptionsOf<typeof dryRun>> = {
      options: null,
      ownOptions: {},
      request: null,
      spellings: {},
      view: null,
    };
    expectTypeOf(middlewareContext(middleware, values)).toEqualTypeOf<
      Parameters<typeof middleware>[0]
    >();
    // @ts-expect-error The view input is stated whole.
    middlewareContext(middleware, { options: null, ownOptions: {}, request: null, spellings: {} });
  });

  it('failureHookContext returns the context a hook takes second', () => {
    const values: FailureHookValues = {
      application: 'notes',
      invokedBy: 'argv',
      mediaType: undefined,
      path: [],
      view: undefined,
    };
    expectTypeOf(failureHookContext(hook, values)).toEqualTypeOf<FailureHookContext>();
    // @ts-expect-error The view and mediaType facts are written out.
    failureHookContext(hook, { application: 'notes', invokedBy: 'argv', path: [] });
  });

  it('providerContext returns the context the opener takes', () => {
    const context = providerContext(open, { options: { token: undefined }, provided: {} });
    expectTypeOf(context).toEqualTypeOf<Parameters<typeof open>[0]>();
    const values: ProviderValues<{ token: string | undefined }, {}> = {
      options: { token: undefined },
      provided: {},
    };
    expectTypeOf(providerContext(open, values)).toEqualTypeOf<Parameters<typeof open>[0]>();
    // @ts-expect-error A global option the provider does not read is an excess key.
    providerContext(open, { options: { other: '', token: undefined }, provided: {} });
    // @ts-expect-error The opener's globals are stated whole.
    providerContext(open, { options: {}, provided: {} });
  });

  it('viewContext returns a ViewContext for a view or a row view', () => {
    expectTypeOf(viewContext(heading, {})).toEqualTypeOf<ViewContext>();
    expectTypeOf<ViewValues>().toEqualTypeOf<{
      readonly background?: ViewContext['background'];
      readonly columns?: ViewContext['columns'];
      readonly expandTabs?: ViewContext['expandTabs'];
      readonly plain?: ViewContext['plain'];
      readonly style?: ViewContext['style'];
      readonly width?: ViewContext['width'];
      readonly wrap?: ViewContext['wrap'];
    }>();
    // @ts-expect-error A member the view context does not have is an excess key.
    viewContext(heading, { rows: 24 });
  });

  it('viewContext takes a view over any data, a string or a number', () => {
    const count: View<number> = { render: (value) => String(value) };
    expectTypeOf(viewContext(count, {})).toEqualTypeOf<ViewContext>();
    expectTypeOf(viewContext({ render: (text: string) => text }, {})).toEqualTypeOf<ViewContext>();
    expectTypeOf(
      viewContext({ render: (value: number) => String(value) }, {}),
    ).toEqualTypeOf<ViewContext>();
  });
});
