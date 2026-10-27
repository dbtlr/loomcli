import type { CommandNode, OptionNode, OptionGroup } from '@loomcli/core';

import { exposed } from './exposure.js';
import { mcpArgument, mcpInput } from './extension.js';

const noMembers = 0;
const nextMember = 1;

type Schema = Readonly<Record<string, unknown>>;

/** Named values can lower to absence; JSON key presence alone cannot describe every option. */
function namedPresence(option: OptionNode): Schema {
  let value: Schema | undefined = undefined;
  if (option.type === 'boolean' && option.polarity !== 'both') {
    value = { const: option.polarity === 'positive' };
  } else if (option.type === 'count') {
    value = { minimum: 1 };
  } else if ((option.type === 'string' || option.type === 'content') && option.multiple) {
    value = { minItems: 1 };
  }
  return {
    required: [option.name],
    ...(value === undefined ? {} : { properties: { [option.name]: value } }),
  };
}

/** The extensions this plugin owns, which bind nothing. */
const ownExtensions: ReadonlySet<string> = new Set([mcpInput.identity, mcpArgument.identity]);

/**
 * Another plugin's extension may include an arbitrary configuration binding, so uncertain
 * requirements stay runtime-only. This plugin's own extensions bind nothing.
 */
function externallyUnbound(option: OptionNode): boolean {
  return (
    option.env.length === noMembers &&
    Object.keys(option.extensions).every((identity) => ownExtensions.has(identity))
  );
}

function constraints(kind: OptionGroup['kind'], options: readonly OptionNode[]): Schema[] {
  const presence = options.map(namedPresence);
  if (kind === 'exclusive') {
    return presence.flatMap((first, index) =>
      presence.slice(index + nextMember).map((second) => ({ not: { allOf: [first, second] } })),
    );
  }
  if (!options.every(externallyUnbound)) {
    return [];
  }
  if (kind === 'oneRequired') {
    return [{ anyOf: presence }];
  }
  return [{ anyOf: [{ not: { anyOf: presence } }, { allOf: presence }] }];
}

export function groupSchemas(command: CommandNode): readonly Schema[] {
  const listed = new Map(command.options.filter(exposed).map((option) => [option.name, option]));
  return command.optionGroups.flatMap((group): Schema[] => {
    const options = group.options.flatMap((name) => {
      const option = listed.get(name);
      return option === undefined ? [] : [option];
    });
    return options.length === group.options.length ? constraints(group.kind, options) : [];
  });
}
