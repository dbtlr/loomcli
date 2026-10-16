import { escapeControlCharacters } from './controls.js';
import { registerRule } from './diagnostic-text.js';
import type { Finding } from './diagnostic-text.js';
import { commandSentence, DeclarationError, quoted } from './errors.js';
import type { InputProblem } from './errors.js';
import { isSupplied, reportedOf, spellingsOf } from './options.js';
import type { OptionValues, SpellingTable } from './options.js';
import type { InputDeclaration } from './validation.js';

/** A relationship over supplied local options, in declaration order. */
interface OptionGroup {
  readonly kind: 'exclusive' | 'oneRequired' | 'requiredTogether';
  readonly options: readonly string[];
}

const groupDeclaration = registerRule('@loomcli/core/option-group', {
  explanation:
    'An option group relates already-declared local options. Its members must be distinct and its rules must permit those options to be used.',
  headline: 'Invalid option group',
});

type Fault = (sentence: string, correction: string) => never;

interface Declaration {
  readonly name: string | null;
  readonly inputs: readonly InputDeclaration[];
  readonly groups: readonly OptionGroup[];
  readonly kind: OptionGroup['kind'];
  readonly names: readonly string[];
}

function checkMembers({ inputs, kind, names, name }: Declaration, fail: Fault): void {
  const subject = commandSentence(name);
  if (names.length < 2) {
    fail(
      `${subject} declares ${kind} with fewer than two options.`,
      'Name at least two local options.',
    );
  }
  const seen = new Set<string>();
  for (const member of names) {
    if (seen.has(member)) {
      fail(`${subject} ${kind} repeats option ${quoted(member)}.`, 'Name each option once.');
    }
    seen.add(member);
    if (!inputs.some((input) => input.kind === 'option' && input.name === member)) {
      fail(
        `${subject} ${kind} names undeclared local option ${quoted(member)}.`,
        'Declare the local option before naming it in a group.',
      );
    }
  }
}

/** Named calls cannot substitute stdin for a required content path. */
function requiresPresence(input: InputDeclaration): boolean {
  if (input.config.type === 'content') {
    return input.config.required === true || (input.config.min ?? 0) > 0;
  }
  return input.config.type === 'string' && Boolean(input.config.required);
}

/** Only pairs involving the new rule need checking; earlier declarations were already checked. */
function checkConflicts(declaration: Declaration, group: OptionGroup, fail: Fault): void {
  const exclusive =
    group.kind === 'exclusive'
      ? [group]
      : declaration.groups.filter((each) => each.kind === 'exclusive');
  const together =
    group.kind === 'requiredTogether'
      ? [group]
      : declaration.groups.filter((each) => each.kind === 'requiredTogether');
  const subject = commandSentence(declaration.name);
  for (const rule of exclusive) {
    const required = declaration.inputs.find(
      (input) =>
        input.kind === 'option' && rule.options.includes(input.name) && requiresPresence(input),
    );
    if (required) {
      fail(
        `${subject} exclusive group contains required option ${quoted(required.name)}.`,
        'Remove the presence requirement or remove the exclusive group.',
      );
    }
    if (
      together.some(
        (other) => rule.options.filter((name) => other.options.includes(name)).length >= 2,
      )
    ) {
      fail(
        `${subject} exclusive and requiredTogether groups share at least two options.`,
        'Remove one of the conflicting group rules.',
      );
    }
  }
}

/** Contradictions are direct pairs, never a transitive constraint solver. */
function declareGroup(declaration: Declaration): OptionGroup {
  const { name, kind, names } = declaration;
  const finding: Finding = { arguments: names, call: kind, path: name === null ? [] : [name] };
  const fail: Fault = (sentence, correction) => {
    throw new DeclarationError(groupDeclaration, { correction, findings: [finding], sentence });
  };
  checkMembers(declaration, fail);
  const group: OptionGroup = Object.freeze({ kind, options: Object.freeze([...names]) });
  checkConflicts(declaration, group, fail);
  return group;
}

interface GroupContext {
  readonly groups: readonly OptionGroup[];
  readonly values: OptionValues;
  readonly table: SpellingTable;
  readonly named: boolean;
  readonly labels: ReadonlyMap<string, string>;
  readonly unanswered: ReadonlySet<string>;
}

/** An unknown configuration answer suppresses only failures whose proof depends on that answer. */
function brokenGroup(group: OptionGroup, context: GroupContext): boolean {
  const supplied = group.options.filter((name) => isSupplied(context.values, name));
  switch (group.kind) {
    case 'exclusive': {
      return supplied.length > 1;
    }
    case 'oneRequired': {
      return supplied.length === 0 && !group.options.some((name) => context.unanswered.has(name));
    }
    case 'requiredTogether': {
      return (
        supplied.length > 0 &&
        group.options.some(
          (name) => !isSupplied(context.values, name) && !context.unanswered.has(name),
        )
      );
    }
    default: {
      const exhaustive: never = group.kind;
      return exhaustive;
    }
  }
}

/** A group has no singular subject, so each sentence states the complete relationship. */
function groupMessage(kind: OptionGroup['kind'], names: readonly string[]): string {
  const members =
    names.length === 2
      ? names.join(' and ')
      : `${names.slice(0, -1).join(', ')}, and ${names.at(-1) ?? ''}`;
  switch (kind) {
    case 'exclusive': {
      return `Options ${members} cannot be used together. Supply only one of them.`;
    }
    case 'oneRequired': {
      return `One of options ${members} is required. Supply at least one of them.`;
    }
    case 'requiredTogether': {
      return `Options ${members} must be supplied together. Supply all of them, or none.`;
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function reportGroup(
  group: OptionGroup,
  context: GroupContext,
): { lines: readonly string[]; problem: InputProblem } {
  const spellings = group.options.map((name) =>
    context.named ? name : reportedOf(spellingsOf(context.table, name), name),
  );
  const described = group.options.map((name, index) => {
    const label = context.labels.get(name);
    return `${quoted(spellings[index])}${label === undefined ? '' : ` (from ${escapeControlCharacters(label)})`}`;
  });
  return {
    lines: [groupMessage(group.kind, described)],
    problem: {
      inputs: group.options.map((name) => ({ global: false, kind: 'option', name })),
      reason: group.kind,
      spellings,
      supplied: group.options.flatMap((name, index) =>
        isSupplied(context.values, name) ? [spellings[index] ?? name] : [],
      ),
    },
  };
}

/** Runs once after the complete individual-input pass, without placing group reports in its ledger. */
function groupReports(
  context: GroupContext,
): { lines: readonly string[]; problem: InputProblem }[] {
  return context.groups
    .filter((group) => brokenGroup(group, context))
    .map((group) => reportGroup(group, context));
}

export type { OptionGroup };
export { declareGroup, groupReports };
