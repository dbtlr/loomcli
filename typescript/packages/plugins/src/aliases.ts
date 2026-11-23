import type { OptionNode } from '@loomcli/core';

/**
 * The long spellings one alias of an option gains, in the order its polarity generates them, as
 * core's spelling table holds them: the positive form, then `--no-<alias>` for a Boolean option
 * with a negative form. A `negative` Boolean option's alias has the negative form alone. Help names
 * a visible alias by the first, and completion offers each.
 */
function aliasSpellings(option: OptionNode, alias: string): string[] {
  if (option.type !== 'boolean') {
    return [`--${alias}`];
  }
  return [
    ...(option.polarity === 'negative' ? [] : [`--${alias}`]),
    ...(option.polarity === 'positive' ? [] : [`--no-${alias}`]),
  ];
}

export { aliasSpellings };
