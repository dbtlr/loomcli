import type { Out, OptionConfig, PluginOptions } from '@loomcli/core';
import { Application, Command, lanes, plugin } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';
import type { VerboseOptions } from '@loomcli/plugins/verbose';

/** The plugin's marked options, whose counts the action reads typed. */
const fetchit = new Application('fetchit', { plugins: [verbose()] }).action(
  async ({ options, out }) => {
    const louder: number = options.verbose;
    const quieter: number = options.quiet;
    await out.debug('GET https://example.com/records');
    await out.trace('Reusing the open connection.');
    return { louder, quieter };
  },
);

/** An application's own marked options, with short aliases, an alias, and a short-only spelling. */
const own = new Application('own')
  .globalOption('loud', { aliases: ['louder'], short: 'l', type: 'count', verbose: true })
  .globalOption('hush', { quiet: true, short: 'h', shortOnly: true, type: 'count' })
  .action(({ options }) => ({ hushed: options.hush, loud: options.loud }));

/** The plugin's option records are its exported type. */
const marked: [VerboseOptions['verbose']['verbose'], VerboseOptions['quiet']['quiet']] = [
  true,
  true,
];

/** A plugin declares a mark on its own counted option. */
const marking = plugin('@fixture/loud', {
  options: { loud: { type: 'count', verbose: true } },
} satisfies { options: PluginOptions });

/** The debug and trace lanes are declared views, and out writes through them. */
const declared = [lanes.debug, lanes.trace];
const writes: Pick<Out, 'debug' | 'trace'>['debug'] = async () => undefined;

// @ts-expect-error TS2554: The verbose plugin takes no settings.
verbose({});

const counted = { type: 'count', verbose: true } satisfies OptionConfig;
const hushing = { quiet: true, type: 'count' } satisfies OptionConfig;
// @ts-expect-error TS2345: A local option carries no verbose mark.
new Command('bad').option('loud', counted);
// @ts-expect-error TS2345: The root's local option carries no quiet mark either.
new Application('bad').option('hush', hushing);
// @ts-expect-error TS2322: Only a counted option carries the verbose mark.
new Application('bad').globalOption('loud', { type: 'boolean', verbose: true });
// @ts-expect-error TS2345: Only a counted option carries the quiet mark.
new Application('bad').globalOption('hush', { quiet: true, type: 'string' });
// @ts-expect-error TS2322: An option carries at most one of the two marks.
new Application('bad').globalOption('both', { quiet: true, type: 'count', verbose: true });
// @ts-expect-error TS2322: The run settles its verbosity before it reads the environment.
new Application('bad').globalOption('loud', { env: 'LOUD', type: 'count', verbose: true });
// @ts-expect-error TS2322: The quiet option binds no variable either.
new Application('bad').globalOption('hush', { env: 'HUSH', quiet: true, type: 'count' });
// @ts-expect-error TS2322: The mark is true or absent.
new Application('bad').globalOption('loud', { type: 'count', verbose: false });
plugin('@fixture/bad', {
  // @ts-expect-error TS2322: A plugin's marked option binds no variable.
  options: { loud: { env: 'LOUD', type: 'count', verbose: true } },
});
new Application('bad', {
  plugins: [
    plugin('@fixture/hook', {
      onCommandAttach: (command) =>
        // @ts-expect-error TS2322: A hook's option() is local, so it carries no verbose mark.
        command.option('loud', { type: 'count', verbose: true }),
    }),
  ],
});

export { declared, fetchit, marked, marking, own, writes };
