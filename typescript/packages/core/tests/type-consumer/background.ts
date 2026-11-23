import type {
  AdaptiveStyle,
  Background,
  Host,
  HostTerminal,
  OptionConfig,
  ProcessTerminal,
  ViewContext,
} from '@loomcli/core';
import { Application, Command, plugin, processHandle, style } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import type { BackgroundOptions } from '@loomcli/plugins/background';
import { loomTheme, theme } from '@loomcli/plugins/theme';

/**
 * An adaptive entry beside a plain one, in a bare theme and as a Loom theme override, and a custom
 * token named adaptive, which only the exported style's root reserves.
 */
const accent: AdaptiveStyle = style.adaptive({
  dark: style.hex('#C97B36', { ansi16: 'yellow', ansi256: 172 }),
  light: style.hex('#9C5A1E', { ansi16: 'yellow', ansi256: 130 }),
});
const themed = new Application('notes', {
  plugins: [theme({ accent, adaptive: style.cyan, identifier: style.cyan }), background()],
}).action(({ host, options, out }) => {
  const settled: Background | undefined = host.terminal.background;
  const chosen: string | undefined = options.background;
  return out.print(`${settled} ${chosen}`);
});
const overridden = loomTheme({ highlight: accent, identifier: accent });

/** A view reads the settled background from its context. */
const shade = (context: ViewContext): Background | undefined => context.background;

/** A handle's terminal written before the background still compiles: it omits it. */
const terminal: ProcessTerminal = {
  stderr: { columns: 80, isTTY: true, rows: 24 },
  stdin: { isTTY: true },
  stdout: { columns: 80, isTTY: true, rows: 24 },
};
await themed.run({ process: processHandle({ argv: [], terminal }) });
await themed.run({ process: processHandle({ terminal: { ...terminal, background: 'light' } }) });
await themed.run({ rendering: { background: 'dark' } });

/** The application's own marked option, with an alias and a validator. */
const own = new Application('own')
  .globalOption('shade', { aliases: ['tint'], background: true, type: 'string' })
  .action(({ options }) => options.shade);

/** The plugin's option record is its exported type. */
const marked: BackgroundOptions['background']['background'] = true;

/** A plugin declares the mark on its own string option. */
const marking = plugin('@fixture/shade', {
  options: { shade: { background: true, type: 'string' } },
});

const readTerminal = (host: Host): HostTerminal => host.terminal;

function writeBackground(host: Host): void {
  // @ts-expect-error TS2540: The settled background is read-only.
  host.terminal.background = 'light';
}

// @ts-expect-error TS2554: The background plugin takes no settings.
background({});
// @ts-expect-error TS2322: A side is a concrete chain, never a semantic one.
style.adaptive({ dark: style.info, light: style.red });
// @ts-expect-error TS2741: Both sides are required.
style.adaptive({ dark: style.red });
// @ts-expect-error TS2322: A side is a chain, never an adaptive style.
style.adaptive({ dark: accent, light: style.red });
// @ts-expect-error TS2339: A chain carries no adaptive.
style.bold.adaptive({ dark: style.red, light: style.red });
// @ts-expect-error TS2322: The author's background is auto, dark, or light.
await themed.run({ rendering: { background: 'blue' } });

const marking2 = { background: true, type: 'string' } satisfies OptionConfig;
// @ts-expect-error TS2345: A local option carries no background mark.
new Command('bad').option('shade', marking2);
// @ts-expect-error TS2345: Only a string option carries the background mark.
new Application('bad').globalOption('shade', { background: true, type: 'boolean' });
// @ts-expect-error TS2322: A content option carries no background mark.
new Command('bad').option('shade', { background: true, type: 'content' });
// @ts-expect-error TS2345: A counted option carries no background mark.
new Application('bad').globalOption('shade', { background: true, type: 'count' });
// @ts-expect-error TS2322: The marked option takes no short alias.
new Application('bad').globalOption('shade', { background: true, short: 's', type: 'string' });
// @ts-expect-error TS2345: The marked option binds no variable.
new Application('bad').globalOption('shade', { background: true, env: 'SHADE', type: 'string' });
// @ts-expect-error TS2345: The marked option declares no default.
new Application('bad').globalOption('shade', { background: true, default: 'dark', type: 'string' });
// @ts-expect-error TS2345: The marked option declares no implied value.
new Application('bad').globalOption('shade', { background: true, implied: 'dark', type: 'string' });
// @ts-expect-error TS2345: The marked option takes one value.
new Application('bad').globalOption('shade', { background: true, multiple: true, type: 'string' });

export { marked, marking, overridden, own, readTerminal, shade, writeBackground };
