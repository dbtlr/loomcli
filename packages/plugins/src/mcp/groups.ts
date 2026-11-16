import type { CommandNode, OptionNode, OptionGroup } from '@loomcli/core';

import { groupMembers } from '../option-groups.js';
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
 * The named values with which one member claims its exclusive group. A Boolean claims only off its
 * absent value, `true` unless it is `negative`, because one at its absent value neither wins the
 * group nor conflicts.
 */
function namedClaim(option: OptionNode): Schema {
  if (option.type !== 'boolean') {
    return namedPresence(option);
  }
  const claim = option.polarity !== 'negative';
  return { properties: { [option.name]: { const: claim } }, required: [option.name] };
}

/** Whether every named value supplies the option: a scalar string or content option. */
function scalarValue(option: OptionNode): boolean {
  return (option.type === 'string' || option.type === 'content') && !option.multiple;
}

/**
 * A requirement's constraint. Where property presence states each side, it is JSON Schema's
 * `dependentRequired`: the option is a scalar string or content option, and each needed option is
 * one too or a Boolean of `both` polarity, whose named `false` still supplies it. Otherwise a named
 * value can lower to absence or leave a Boolean option at its absent value, which triggers
 * nothing, so the constraint reads the option's claim, the one an exclusive group reads, and each
 * needed option's presence through named values.
 */
function requirementConstraint(option: OptionNode, needed: readonly OptionNode[]): Schema {
  if (
    scalarValue(option) &&
    needed.every(
      (each) => scalarValue(each) || (each.type === 'boolean' && each.polarity === 'both'),
    )
  ) {
    return { dependentRequired: { [option.name]: needed.map(({ name }) => name) } };
  }
  return { anyOf: [{ not: namedClaim(option) }, { allOf: needed.map(namedPresence) }] };
}

/**
 * The constraints of one requirement. An excluded option is never supplied in a call, so its
 * requirement constrains nothing. One that excludes a needed option is a build fault, and one with
 * a hidden, control, or externally bound member stays a rule the run checks alone.
 */
function requirementSchemas(members: readonly OptionNode[]): Schema[] {
  const [option, ...needed] = members;
  if (option === undefined || !members.every(exposed) || !members.every(externallyUnbound)) {
    return [];
  }
  return [requirementConstraint(option, needed)];
}

function constraints(
  kind: Exclude<OptionGroup['kind'], 'requires'>,
  options: readonly OptionNode[],
): Schema[] {
  if (kind === 'exclusive') {
    const claims = options.map(namedClaim);
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
 * which the build-fault hook rejects. A requirement follows `requirementSchemas`.
 */
export function groupSchemas(command: CommandNode): readonly Schema[] {
  const declared = new Map(command.options.map((option) => [option.name, option]));
  return command.optionGroups.flatMap((group): Schema[] => {
    const members = groupMembers(group).flatMap((name) => {
      const option = declared.get(name);
      return option === undefined ? [] : [option];
    });
    if (group.kind === 'requires') {
      return requirementSchemas(members);
    }
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
