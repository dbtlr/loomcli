import { Command, glyph, pad } from '@loomcli/core';
import type { ActionHandler, Renderer } from '@loomcli/core';

const report: ActionHandler<typeof local> = ({ options, out }) => out.print(String(options.trace));
const local = new Command('local').action(report);

const rendered: Renderer<string> = {
  render: (value, { style, width }) =>
    `${style.identifier(pad(`${glyph.radioOn} ${value}`, 12))}:${width('古🇺🇸')}\n`,
};
const styled = new Command('styled').action(({ out, style }) =>
  out.render(style.identifier('ok'), rendered),
);
export { local, styled };
