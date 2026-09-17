import { Command, pad } from '@loomcli/core';
import type { ActionHandler, View } from '@loomcli/core';

const renderer: View<{ name: string }> = {
  render: (data, { style, width }) =>
    `${style.identifier(style.escape(data.name))}:${width(pad(data.name, 8))}`,
};
const action: ActionHandler<typeof command> = ({ out, style }) => {
  out.print(style.hex('#7A8F7B', { ansi16: 'green' }).identifier('known'));
  out.print(style.absent('known without a mapping'));
  // @ts-expect-error TS2551: Detached actions reject unknown contextual token names.
  style.identifer('typo');
  return out.render({ name: 'value' }, renderer);
};
const command = new Command('styled').action(action);
const invalid: View<string> = {
  // @ts-expect-error TS2551: Detached views share the same exact Application vocabulary.
  render: (value, { style }) => style.identifer(value),
};
export { command, renderer, invalid };
