import type { CommandNode, OptionNode, OptionGroup } from '@loomcli/core';

import { excluded, exposed } from './exposure.js';
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

/**
 * The named values with which one member claims its exclusive group, or `undefined` for a member no
 * call can claim through. A Boolean claims only as `true`, because a false one neither wins the group
 * nor conflicts, so a `negative` Boolean, which every call supplies as false or not at all, claims
 * through none.
 */
function namedClaim(option: OptionNode): Schema | undefined {
  if (option.type !== 'boolean') {
    return namedPresence(option);
  }
  if (option.polarity === 'negative') {
    return undefined;
  }
  return { properties: { [option.name]: { const: true } }, required: [option.name] };
}

function constraints(kind: OptionGroup['kind'], options: readonly OptionNode[]): Schema[] {
  if (kind === 'exclusive') {
    const claims = options.flatMap((option) => namedClaim(option) ?? []);
    return claims.flatMap((first, index) =>
      claims.slice(index + nextMember).map((second) => ({ not: { allOf: [first, second] } })),
    );
  }
  const presence = options.map(namedPresence);
  if (!options.every(externallyUnbound)) {
    return [];
  }
  if (kind === 'oneRequired') {
    return [{ anyOf: presence }];
  }
  return [{ anyOf: [{ not: { anyOf: presence } }, { allOf: presence }] }];
}

/**
 * The constraints a tool's schema states for the Command's option groups. An excluded member is
 * never supplied in a call, so a group constrains the members the tool lists. A group that also
 * holds a hidden or control member, which a call may still fill from the server's sources, stays a
 * rule the run checks alone, and so does a `requiredTogether` group that excludes some members,
 * which the build-fault hook rejects.
 */
export function groupSchemas(command: CommandNode): readonly Schema[] {
  const declared = new Map(command.options.map((option) => [option.name, option]));
  return command.optionGroups.flatMap((group): Schema[] => {
    const members = group.options.flatMap((name) => {
      const option = declared.get(name);
      return option === undefined ? [] : [option];
    });
    const listed = members.filter((option) => !excluded(option));
    const partial = listed.length !== members.length;
    if (
      listed.length === noMembers ||
      !listed.every(exposed) ||
      (partial && group.kind === 'requiredTogether')
    ) {
      return [];
    }
    return constraints(group.kind, listed);
  });
}
