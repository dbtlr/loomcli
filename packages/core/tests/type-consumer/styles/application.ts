import { Application, plugin, style } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';

import { command } from './command.js';

const configured = new Application('styles', {
  plugins: [
    plugin('custom/theme', { theme: { absent: undefined, identifier: style.cyan.bold } }),
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

export { app };
