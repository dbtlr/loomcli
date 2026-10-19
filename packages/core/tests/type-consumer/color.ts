import type { OptionConfig, PluginOptions } from '@loomcli/core';
import { Application, Command, plugin } from '@loomcli/core';
import { color } from '@loomcli/plugins/color';
import type { ColorOptions } from '@loomcli/plugins/color';

/** The application's own marked option, in each polarity, with an alias. */
const notes = new Application('notes', { plugins: [color()] })
  .globalOption('paint', { aliases: ['tint'], color: true, polarity: 'both', type: 'boolean' })
  .globalOption('dark', { color: true, type: 'boolean' })
  .action(({ options }) => {
    const chosen: boolean = options.color;
    const own: boolean = options.paint;
    return { chosen, own };
  });

/** The plugin's option record is its exported type. */
const declared: ColorOptions['color']['color'] = true;

/** A plugin declares the mark on its own global option. */
const marking = plugin('@fixture/paint', {
  options: { paint: { color: true, polarity: 'negative', type: 'boolean' } },
} satisfies { options: PluginOptions });

// @ts-expect-error TS2554: The color plugin takes no settings.
color({});

const marked = { color: true, type: 'boolean' } satisfies OptionConfig;
// @ts-expect-error TS2345: A local option carries no color mark.
new Command('bad').option('paint', marked);
// @ts-expect-error TS2345: The root's local option carries no color mark either.
new Application('bad').option('paint', marked);
// @ts-expect-error TS2345: Only a Boolean option carries the color mark.
new Application('bad').globalOption('paint', { color: true, type: 'string' });
// @ts-expect-error TS2345: A counted option carries no color mark.
new Application('bad').globalOption('paint', { color: true, type: 'count' });
// @ts-expect-error TS2322: The mark is true or absent.
new Application('bad').globalOption('paint', { color: false, type: 'boolean' });
// @ts-expect-error TS2322: The run reads its color before short groups.
new Application('bad').globalOption('paint', { color: true, short: 'p', type: 'boolean' });
// @ts-expect-error TS2345: A short-only option has no long spelling to read.
new Application('bad').globalOption('paint', { color: true, shortOnly: true, type: 'boolean' });
// @ts-expect-error TS2345: NO_COLOR and FORCE_COLOR speak for the environment.
new Application('bad').globalOption('paint', { color: true, env: 'PAINT', type: 'boolean' });
plugin('@fixture/bad', {
  // @ts-expect-error TS2322: A plugin's marked option declares no short alias.
  options: { paint: { color: true, short: 'p', type: 'boolean' } },
});
plugin('@fixture/bad', {
  // @ts-expect-error TS2322: A plugin's marked option binds no variable.
  options: { paint: { color: true, env: 'PAINT', type: 'boolean' } },
});

// @ts-expect-error TS2345: Only a Boolean option carries the interaction mark.
new Application('bad').globalOption('input', { interaction: true, type: 'string' });
// @ts-expect-error TS2345: A counted option carries no interaction mark.
new Application('bad').globalOption('input', { interaction: true, type: 'count' });
plugin('@fixture/bad', {
  // @ts-expect-error TS2322: A plugin's string option carries no interaction mark.
  options: { input: { interaction: true, type: 'string' } },
});

export { declared, marking, notes };
