import { Application, Command, plugin, provider } from '@loomcli/core';
import type {
  ActionHandler,
  Opener,
  PluginOptionValues,
  PluginOptions,
  Provider,
  ProviderContext,
} from '@loomcli/core';

// A database package: its plugin declares the option, and its providers read it.
interface Pool {
  end(): Promise<void>;
  query(sql: string): Promise<readonly string[]>;
}
interface Session {
  find(id: string): Promise<string>;
}
const databaseOptions = { 'database-url': { type: 'string' } } satisfies PluginOptions;
type DatabaseOptions = typeof databaseOptions;
const database = plugin('consumer/database', { options: databaseOptions });

declare const openPool: Opener<typeof pool>;
declare const openSession: Opener<typeof session>;

const pool: Provider<'pool', Pool, PluginOptionValues<DatabaseOptions>, 'persistent'> = provider(
  'pool',
  {
    close: (value) => value.end(),
    lifetime: 'persistent',
    load: async () => ({ default: openPool }),
  },
);
const session: Provider<
  'session',
  Session,
  { token: string | undefined },
  'ephemeral',
  [typeof pool]
> = provider('session', { load: async () => ({ default: openSession }), uses: [pool] });

// The opener reads the globals its declaration states and the values of the providers it uses.
const opened: Opener<typeof session> = async (context) => {
  const token: string | undefined = context.options.token;
  const rows: readonly string[] = await context.provided.pool.query(token ?? '');
  // @ts-expect-error TS7053: An opener reads only the globals its own declaration states.
  void context.options['database-url'];
  // @ts-expect-error TS2339: A provider's opener reads no value of a provider it does not use.
  void context.provided.session;
  return { find: async (id) => `${id}${rows.join('')}` };
};
type SessionContext = ProviderContext<{ token: string | undefined }, { readonly pool: Pool }>;

declare const openBare: Opener<Provider<'bare', Pool, {}, 'persistent'>>;
// @ts-expect-error TS2345: A persistent annotation needs its lifetime stated.
const unstated: Provider<'bare', Pool, {}, 'persistent'> = provider('bare', {
  load: async () => ({ default: openBare }),
});
declare const openNamed: Opener<Provider<'named', number>>;
// @ts-expect-error TS2345: A name that differs from the annotation's is rejected.
const misnamed: Provider<'named', number> = provider('names', {
  load: async () => ({ default: openNamed }),
});
type Unused = Provider<
  'session',
  Session,
  { token: string | undefined },
  'ephemeral',
  [typeof pool]
>;
// @ts-expect-error TS2345: An annotation that lists providers needs uses.
const unused: Unused = provider('session', { load: async () => ({ default: openSession }) });
declare const openCache: Opener<typeof cache>;
const cache: Provider<'cache', string, {}, 'persistent', [typeof session]> = provider('cache', {
  lifetime: 'persistent',
  load: async () => ({ default: openCache }),
  // @ts-expect-error TS2322: A persistent provider cannot use an ephemeral one.
  uses: [session],
});
const wrongValue: Provider<'plain', number> = provider('plain', {
  // @ts-expect-error TS2322: The opener must return the annotation's value.
  load: async () => ({ default: () => 'one' }),
});

// The action reads each listed value under provided, typed, and its options include their globals.
const get = new Command('get', { uses: [session] })
  .argument('id', { required: true })
  .action(async ({ args, options, provided }) => {
    const url: string | undefined = options['database-url'];
    const token: string | undefined = options.token;
    const found: string = await provided.session.find(args.id);
    // @ts-expect-error TS2339: A provider a listed one uses is built and not provided.
    void provided.pool;
    return [url, token, found];
  });
const plain = new Command('plain').action(({ provided }) => {
  const empty: {} = provided;
  // @ts-expect-error TS2339: A Command that opts in to nothing reads no value.
  void provided.session;
  return empty;
});
const handler: ActionHandler<typeof get> = async ({ provided }) => provided.session.find('1');

// A library group holding an opting-in Command compiles, and its requirement passes up.
const db = new Command('db').command(
  new Command('migrate', { uses: [pool] }).action(() => undefined),
);
const library = new Command('tools').command(db).command(plain);

// A shared list typed as an array still carries what its providers' own providers read.
const databaseProviders = [session];
const shared = new Command('shared', { uses: databaseProviders }).action(({ provided }) =>
  provided.session.find('1'),
);
// @ts-expect-error TS2345: The pool's option reaches the requirement through an array list.
new Application('consumer').globalOption('token', { type: 'string' }).command(shared);

// The Application that declares every option attaches them, wherever the Command sits.
const complete = new Application('consumer', { plugins: [database] })
  .globalOption('token', { type: 'string' })
  .command(get)
  .command(library)
  .command(shared);

// @ts-expect-error TS2345: An Application that lacks the session's token option cannot attach it.
new Application('consumer', { plugins: [database] }).command(get);
// @ts-expect-error TS2345: The requirement reached the group through its child.
new Application('consumer').globalOption('token', { type: 'string' }).command(db);

// Two different providers with one name in a closure are rejected at the opt-in.
declare const impostor: Provider<'pool', number>;
declare const audit: Provider<'audit', number, {}, 'ephemeral', [typeof impostor]>;
// @ts-expect-error TS2322: Two providers named pool reach this list.
new Command('clash', { uses: [session, audit] });
// One provider reached twice is one provider.
const diamond = new Command('diamond', { uses: [session, pool] }).action(({ provided }) =>
  provided.pool.end(),
);

// The Application's uses covers its root action, checked once globalOption() closes.
const root = new Application('consumer', { plugins: [database], uses: [pool] }).action(
  ({ provided }) => provided.pool.end(),
);
// @ts-expect-error TS2345: The root's provider reads an option this Application does not declare.
new Application('consumer', { uses: [pool] }).action(() => undefined);

// A plugin's Commands may require that plugin's own options, and no other.
const migrations = plugin('consumer/migrations', {
  commands: [new Command('migrate', { uses: [pool] }).action(() => undefined)],
  options: databaseOptions,
});
const stray = new Command('migrate', { uses: [pool] }).action(() => undefined);
// @ts-expect-error TS2322: A plugin cannot ship a Command that requires another plugin's option.
plugin('consumer/stray', { commands: [stray] });

export type { SessionContext };
export {
  opened,
  handler,
  library,
  complete,
  diamond,
  root,
  migrations,
  unstated,
  misnamed,
  unused,
  cache,
  wrongValue,
};
