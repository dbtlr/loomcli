import { reportedSpelling } from '@loomcli/core';
import type { CommandNode, OptionGroup } from '@loomcli/core';

/** Two names join with `and` alone. */
const pairMembers = 2;
const listStart = 0;
const lastMember = -1;

/** Every option a group names, in the order its call names them: a requirement's option first. */
function groupMembers(group: OptionGroup): readonly string[] {
  return group.kind === 'requires' ? [group.option, ...group.requires] : group.options;
}

/** A listing never advertises a rule that would reveal a hidden member. */
function visibleOptionGroups(command: CommandNode): CommandNode['optionGroups'] {
  const visible = new Set(
    command.options.filter((option) => !option.hidden).map((option) => option.name),
  );
  return command.optionGroups.filter((group) =>
    groupMembers(group).every((name) => visible.has(name)),
  );
}

/** Spellings joined for a sentence: `a`, `a and b`, or `a, b, and c`. */
function joined(names: readonly string[]): string {
  return names.length <= pairMembers
    ? names.join(' and ')
    : `${names.slice(listStart, lastMember).join(', ')}, and ${names.at(lastMember) ?? ''}`;
}

/** The rule a group over all its members states, without its period. */
function memberRule(
  group: Exclude<OptionGroup, { readonly kind: 'requires' }>,
  spelled: (name: string) => string,
): string {
  const members = joined(group.options.map(spelled));
  const rules = {
    exclusive: `Use at most one of ${members}`,
    oneRequired: `Supply at least one of ${members}`,
    requiredTogether: `Use ${members} together`,
  };
  return rules[group.kind];
}

/** The rule a requirement states, its option and then the options it needs, without its period. */
function requirementRule(
  group: Extract<OptionGroup, { readonly kind: 'requires' }>,
  spelled: (name: string) => string,
): string {
  return `Use ${spelled(group.option)} only with ${joined(group.requires.map(spelled))}`;
}

/**
 * The plain sentence of each visible option group, in declaration order, which help and the man
 * page both print. Rules speak about supplied options, independently of their defaults or prepared
 * stdin, so a group that holds a content option that accepts stdin says that piping does not count.
 */
function groupSentences(command: CommandNode): string[] {
  return visibleOptionGroups(command).map((group) => {
    const members = groupMembers(group);
    const nodes = command.options.filter((option) => members.includes(option.name));
    const spelled = (name: string): string => {
      const option = nodes.find((node) => node.name === name);
      return option === undefined ? name : reportedSpelling(option);
    };
    const rule =
      group.kind === 'requires' ? requirementRule(group, spelled) : memberRule(group, spelled);
    const caveat = nodes.some((option) => option.type === 'content' && option.stdin)
      ? ' (piped stdin does not count)'
      : '';
    return `${rule}${caveat}.`;
  });
}

export { groupMembers, groupSentences, visibleOptionGroups };
