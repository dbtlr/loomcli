import { reportedSpelling } from '@loomcli/core';
import type { CommandNode, OptionGroup, Phrase } from '@loomcli/core';

import { commonPhrase } from './phrases.js';

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

/** The sentence a group states, with the caveat when a member reads piped stdin. */
function groupPhrase(
  group: OptionGroup,
  spelled: (name: string) => string,
  stdin: boolean,
): Phrase {
  switch (group.kind) {
    case 'requires': {
      return commonPhrase(
        'requiresGroup',
        spelled(group.option),
        group.requires.map(spelled),
        stdin,
      );
    }
    case 'exclusive': {
      return commonPhrase('exclusiveGroup', group.options.map(spelled), stdin);
    }
    case 'oneRequired': {
      return commonPhrase('oneRequiredGroup', group.options.map(spelled), stdin);
    }
    default: {
      return commonPhrase('requiredTogetherGroup', group.options.map(spelled), stdin);
    }
  }
}

/**
 * The sentence of each visible option group, in declaration order, as a phrase help says in the
 * run's language. Rules speak about supplied options, independently of their defaults or prepared
 * stdin, so a group that holds a content option that accepts stdin says that piping does not count.
 */
function groupPhrases(command: CommandNode): Phrase[] {
  return visibleOptionGroups(command).map((group) => {
    const members = groupMembers(group);
    const nodes = command.options.filter((option) => members.includes(option.name));
    const spelled = (name: string): string => {
      const option = nodes.find((node) => node.name === name);
      return option === undefined ? name : reportedSpelling(option);
    };
    const stdin = nodes.some((option) => option.type === 'content' && option.stdin);
    return groupPhrase(group, spelled, stdin);
  });
}

/** The plain English sentence of each visible option group, which the man page prints. */
function groupSentences(command: CommandNode): string[] {
  return groupPhrases(command).map((phrase) => phrase.text);
}

export { groupMembers, groupPhrases, groupSentences, visibleOptionGroups };
