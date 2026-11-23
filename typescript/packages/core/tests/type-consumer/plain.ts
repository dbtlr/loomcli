import type { OptionConfig, PluginOptions } from '@loomcli/core';
import { Application, Command, plugin } from '@loomcli/core';
import { plain } from '@loomcli/plugins/plain';
import type { PlainOptions } from '@loomcli/plugins/plain';

/** The plugin's marked option, whose value the action reads typed. */
const notes = new Application('notes', { plugins: [plain()] }).action(({ options }) => {
  const typed: boolean = options.plain;
  return { typed };
});

/** An application's own marked option with an alias. */
const accessible = new Application('accessible')
  .globalOption('accessible', { aliases: ['screen-reader'], plain: true, type: 'boolean' })
  .action(({ options }) => {
    const own: boolean = options.accessible;
    return { own };
  });

/** The plugin's option record is its exported type. */
const declared: PlainOptions['plain']['plain'] = true;

/** A plugin declares the mark on its own global option. */
const marking = plugin('@fixture/plain', {
  options: { flat: { plain: true, polarity: 'positive', type: 'boolean' } },
} satisfies { options: PluginOptions });

// @ts-expect-error TS2554: The plain plugin takes no settings.
plain({});

const marked = { plain: true, type: 'boolean' } satisfies OptionConfig;
// @ts-expect-error TS2345: A local option carries no plain mark.
new Command('bad').option('flat', marked);
// @ts-expect-error TS2345: The root's local option carries no plain mark either.
new Application('bad').option('flat', marked);
// @ts-expect-error TS2345: Only a Boolean option carries the plain mark.
new Application('bad').globalOption('flat', { plain: true, type: 'string' });
// @ts-expect-error TS2345: A counted option carries no plain mark.
new Application('bad').globalOption('flat', { plain: true, type: 'count' });
// @ts-expect-error TS2322: The mark is true or absent.
new Application('bad').globalOption('flat', { plain: false, type: 'boolean' });
// @ts-expect-error TS2345: Nothing turns the switch off, so no negative spelling.
new Application('bad').globalOption('flat', { plain: true, polarity: 'negative', type: 'boolean' });
// @ts-expect-error TS2345: Nor both polarities.
new Application('bad').globalOption('flat', { plain: true, polarity: 'both', type: 'boolean' });
// @ts-expect-error TS2322: The run reads the switch before short groups.
new Application('bad').globalOption('flat', { plain: true, short: 'p', type: 'boolean' });
// @ts-expect-error TS2345: A short-only option has no long spelling to read.
new Application('bad').globalOption('flat', { plain: true, shortOnly: true, type: 'boolean' });
// @ts-expect-error TS2322: ACCESSIBLE speaks for the environment.
new Application('bad').globalOption('flat', { env: 'FLAT', plain: true, type: 'boolean' });
// @ts-expect-error TS2322: The plain mark and the color mark are two options.
new Application('bad').globalOption('flat', { color: true, plain: true, type: 'boolean' });
plugin('@fixture/bad', {
  // @ts-expect-error TS2322: A plugin's marked option declares no short alias.
  options: { flat: { plain: true, short: 'p', type: 'boolean' } },
});
plugin('@fixture/bad', {
  // @ts-expect-error TS2322: A plugin's marked option binds no variable.
  options: { flat: { env: 'FLAT', plain: true, type: 'boolean' } },
});

export { accessible, declared, marking, notes };
