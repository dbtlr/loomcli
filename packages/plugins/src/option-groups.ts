import type { CommandNode } from '@loomcli/core';

/** A listing never advertises a rule that would reveal a hidden member. */
export function visibleOptionGroups(command: CommandNode): CommandNode['optionGroups'] {
  const visible = new Set(
    command.options.filter((option) => !option.hidden).map((option) => option.name),
  );
  return command.optionGroups.filter((group) => group.options.every((name) => visible.has(name)));
}
