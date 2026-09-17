import { Application, style } from '@loomcli/core';
import type { Ansi16Color, Ansi256Fallbacks, ColorFallbacks } from '@loomcli/core';
import { loomTheme, theme } from '@loomcli/plugins/theme';
import type { LoomThemeOverrides } from '@loomcli/plugins/theme';

const green: Ansi16Color = 'green';
const fallbacks: ColorFallbacks = { ansi16: green, ansi256: 108 };
const indexed: Ansi256Fallbacks = { ansi16: green };
const overrides = {
  absent: undefined,
  identifier: style.hex('#7A8F7B', fallbacks),
} satisfies LoomThemeOverrides;
const named = loomTheme(overrides);
const bare = theme({ success: style.blue });
const app = new Application('palette', { plugins: [named] }).action(({ out, style: contextual }) =>
  out.render(
    [
      contextual.primary('primary'),
      contextual.dim('dim'),
      contextual.highlight('highlight'),
      contextual.success('success'),
      contextual.warning('warning'),
      contextual.error('error'),
      contextual.info('info'),
      style.rgb(122, 143, 123, fallbacks)('rgb'),
      style.ansi256(108, indexed)('indexed'),
      style.bgHex('#7A8F7B', fallbacks)('bgHex'),
      style.bgRgb(122, 143, 123, fallbacks)('bgRgb'),
      style.bgAnsi256(108, indexed)('bgIndexed'),
    ].join('|'),
    { render: (value) => value },
  ),
);
for (const env of [{}, { TERM: 'xterm-256color' }, { COLORTERM: 'truecolor' }]) {
  await app.run({ host: { argv: [], env }, rendering: { color: 'always', modifiers: 'always' } });
}
await new Application('bare', { plugins: [bare] })
  .action(({ out, style: contextual }) => out.print(contextual.success('bare')))
  .run({ host: { argv: [], env: {} }, rendering: { color: 'always' } });
