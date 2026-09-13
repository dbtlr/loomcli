import { Command, pad } from '@loomcli/core';
import type { ActionHandler, Renderer } from '@loomcli/core';

const renderer: Renderer<{ name: string }> = {
  render: (data, { style, width }) =>
    `${style.identifier(style.escape(data.name))}:${width(pad(data.name, 8))}`,
};
const action: ActionHandler<typeof command> = ({ out, style }) => {
  out.print(style.identifier('known'));
  out.print(style.absent('known without a mapping'));
  // @ts-expect-error TS2551: Detached actions reject unknown contextual token names.
  style.identifer('typo');
  return out.render({ name: 'value' }, renderer);
};
const command = new Command('styled').action(action);
const invalid: Renderer<string> = {
  // @ts-expect-error TS2551: Detached renderers share the same exact Application vocabulary.
  render: (value, { style }) => style.identifer(value),
};
export { command, renderer, invalid };
