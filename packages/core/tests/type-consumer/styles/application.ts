import { Application, plugin, style } from '@loomcli/core';
import type {
  Ansi16Color,
  Ansi256Fallbacks,
  ColorFallbacks,
  ConcreteStyle,
  EnvironmentOf,
} from '@loomcli/core';
import { loomTheme } from '@loomcli/plugins/theme';
import type { LoomThemeOverrides } from '@loomcli/plugins/theme';

import { command } from './command.js';

const configured = new Application('styles', {
  plugins: [
    loomTheme({ absent: undefined, identifier: style.cyan.bold } satisfies LoomThemeOverrides),
    plugin('ordinary', {}),
  ],
});
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}
const app = configured.command(command);

// @ts-expect-error TS2339: Imported style remains independent of the Application vocabulary.
style.identifier('wrong');
// @ts-expect-error TS2322: A semantic token cannot enter a concrete theme mapping.
plugin('recursive', { theme: { identifier: style.info.bold } });
// @ts-expect-error TS2322: A concrete helper name cannot be shadowed by a token.
plugin('reserved', { theme: { red: style.cyan } });
// @ts-expect-error TS2322: Callable members cannot be shadowed by a token.
plugin('reserved-callable', { theme: { bind: style.cyan } });
// @ts-expect-error TS2322: Object members cannot be shadowed by a token.
plugin('reserved-object', { theme: { valueOf: style.cyan } });
// @ts-expect-error TS2322: Applied text cannot enter an unapplied theme mapping.
plugin('applied', { theme: { identifier: style.cyan('text') } });
// @ts-expect-error TS2345: Helpers accept text without coercion.
style.red(12);
// @ts-expect-error TS2322: Rendering policies take one setting rather than per-stream settings.
new Application('invalid', { rendering: { color: { stdout: 'always' } } });

const name: Ansi16Color = 'green';
const fallbacks: ColorFallbacks = { ansi16: name, ansi256: 108 };
const indexed: Ansi256Fallbacks = { ansi16: name };
const concrete: ConcreteStyle = style
  .hex('#7A8F7B', fallbacks)
  .bgRgb(1, 2, 3, fallbacks)
  .ansi256(108, indexed);
style.bgHex('#7A8F7B', { ansi16: undefined, ansi256: undefined });
style.bgAnsi256(108, undefined);
style.rgb(1, 2, 3, undefined);
// @ts-expect-error TS2820: ANSI-16 uses foreground names even for backgrounds.
style.bgHex('#7A8F7B', { ansi16: 'bgGreen' });
// @ts-expect-error TS2353: Indexed helpers accept no ANSI-256 fallback.
style.ansi256(108, { ansi256: 100 });
// @ts-expect-error TS2353: Unknown fallback fields fail compilation.
style.hex('#7A8F7B', { depth: 16 });
// @ts-expect-error TS2322: Indices are numeric.
style.rgb(1, 2, 3, { ansi256: '108' });
// @ts-expect-error TS2322: A fallback helper preserves the semantic-chain restriction.
const semantic: ConcreteStyle = style.info.hex('#7A8F7B', fallbacks);
// @ts-expect-error TS2345: Array callback indices are not fallback options.
['#7A8F7B'].map(style.hex);
['#7A8F7B'].map((value) => style.hex(value));
// @ts-expect-error TS2322: Named theme overrides cannot reference tokens through a helper.
loomTheme({ identifier: style.info.hex('#7A8F7B', fallbacks) });
export { app, concrete, semantic };
